import { google, type gmail_v1 } from "googleapis";
import { requireGoogle } from "./auth.js";

export interface MailSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  labels: string[];
}

export interface MailMessage extends MailSummary {
  body: string;
}

async function gmail(): Promise<gmail_v1.Gmail> {
  return google.gmail({ version: "v1", auth: await requireGoogle() });
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

function summarise(msg: gmail_v1.Schema$Message): MailSummary {
  return {
    id: msg.id ?? "",
    threadId: msg.threadId ?? "",
    from: header(msg, "From"),
    to: header(msg, "To"),
    subject: header(msg, "Subject"),
    date: header(msg, "Date"),
    snippet: msg.snippet ?? "",
    labels: msg.labelIds ?? [],
  };
}

function decodeBody(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  }
  if (part.parts) {
    for (const p of part.parts) {
      const t = decodeBody(p);
      if (t) return t;
    }
  }
  if (part.mimeType === "text/html" && part.body?.data) {
    return Buffer.from(part.body.data, "base64url")
      .toString("utf8")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/\s+/g, " ")
      .trim();
  }
  return "";
}

/** Gmail search syntax, e.g. "is:unread newer_than:2d". */
export async function searchMail(query: string, max = 15): Promise<MailSummary[]> {
  const g = await gmail();
  const list = await g.users.messages.list({ userId: "me", q: query, maxResults: Math.min(max, 50) });
  const ids = list.data.messages ?? [];
  const out: MailSummary[] = [];
  for (const m of ids) {
    if (!m.id) continue;
    const full = await g.users.messages.get({
      userId: "me",
      id: m.id,
      format: "metadata",
      metadataHeaders: ["From", "To", "Subject", "Date"],
    });
    out.push(summarise(full.data));
  }
  return out;
}

export async function readMessage(id: string, maxChars = 6000): Promise<MailMessage> {
  const g = await gmail();
  const full = await g.users.messages.get({ userId: "me", id, format: "full" });
  const body = decodeBody(full.data.payload).slice(0, maxChars);
  return { ...summarise(full.data), body };
}

export async function readThread(threadId: string, maxCharsPerMessage = 3000): Promise<MailMessage[]> {
  const g = await gmail();
  const t = await g.users.threads.get({ userId: "me", id: threadId, format: "full" });
  return (t.data.messages ?? []).map((m) => ({
    ...summarise(m),
    body: decodeBody(m.payload).slice(0, maxCharsPerMessage),
  }));
}

/** Threads where the last message is from me and nobody replied. */
export async function sentWithoutReply(olderThanDays: number, max = 20): Promise<MailSummary[]> {
  const g = await gmail();
  const list = await g.users.messages.list({
    userId: "me",
    q: `in:sent older_than:${olderThanDays}d newer_than:${olderThanDays + 14}d -category:promotions`,
    maxResults: 40,
  });
  const seen = new Set<string>();
  const out: MailSummary[] = [];
  for (const m of list.data.messages ?? []) {
    if (!m.threadId || seen.has(m.threadId)) continue;
    seen.add(m.threadId);
    const t = await g.users.threads.get({ userId: "me", id: m.threadId, format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] });
    const msgs = t.data.messages ?? [];
    const last = msgs[msgs.length - 1];
    if (!last) continue;
    const lastIsMine = (last.labelIds ?? []).includes("SENT");
    if (lastIsMine) out.push(summarise(last));
    if (out.length >= max) break;
  }
  return out;
}

function encodeMime(parts: { to: string; subject: string; body: string; inReplyTo?: string; references?: string; threadId?: string }): string {
  const lines = [
    `To: ${parts.to}`,
    `Subject: ${parts.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
  ];
  if (parts.inReplyTo) lines.push(`In-Reply-To: ${parts.inReplyTo}`);
  if (parts.references) lines.push(`References: ${parts.references}`);
  const raw = `${lines.join("\r\n")}\r\n\r\n${parts.body}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export interface OutgoingMail {
  to: string;
  subject: string;
  body: string;
  /** Reply into an existing thread. */
  threadId?: string;
}

async function replyHeaders(threadId?: string): Promise<{ inReplyTo?: string; references?: string }> {
  if (!threadId) return {};
  const g = await gmail();
  const t = await g.users.threads.get({ userId: "me", id: threadId, format: "metadata", metadataHeaders: ["Message-ID", "References"] });
  const last = (t.data.messages ?? []).at(-1);
  if (!last) return {};
  const msgId = header(last, "Message-ID");
  const refs = header(last, "References");
  return { inReplyTo: msgId || undefined, references: [refs, msgId].filter(Boolean).join(" ") || undefined };
}

/** Draft only. Nothing leaves the account. */
export async function createDraft(mail: OutgoingMail): Promise<string> {
  const g = await gmail();
  const extra = await replyHeaders(mail.threadId);
  const res = await g.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: encodeMime({ ...mail, ...extra }), threadId: mail.threadId } },
  });
  return res.data.id ?? "";
}

/** Sends. Only ever called by the approval gate after the owner tapped Approve. */
export async function sendMail(mail: OutgoingMail): Promise<string> {
  const g = await gmail();
  const extra = await replyHeaders(mail.threadId);
  const res = await g.users.messages.send({
    userId: "me",
    requestBody: { raw: encodeMime({ ...mail, ...extra }), threadId: mail.threadId },
  });
  return res.data.id ?? "";
}

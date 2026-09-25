/**
 * Inbox triage: sort what arrived into buckets, then do something different
 * with each one. Classification runs off headers and snippets, which are
 * cheap; full bodies are read only for the few that earn a draft.
 */
import { config } from "../config.js";
import { db } from "../db/supabase.js";
import { searchMail } from "../google/gmail.js";

export interface Bucket {
  name: string;
  matches: string;
  action: string;
}

/** Owner-neutral buckets. The owner can add their own by telling the assistant. */
export const BUCKETS: Bucket[] = [
  {
    name: "urgent",
    matches: "a person is waiting on the owner today, or something breaks or costs money if ignored today",
    action:
      "one line on who wants what and by when, then the deadline in plain words",
  },
  {
    name: "reply",
    matches: "a real person wants an answer, but nothing breaks if it waits a day or two",
    action: "one line: who, and the single question they are actually asking",
  },
  {
    name: "money",
    matches: "an invoice, bill, payment, refund, subscription renewal or price change",
    action: "the amount, who it is from, and the date it is due or charged",
  },
  {
    name: "calendar",
    matches:
      "a date, time, flight, delivery, appointment, booking or deadline that may not be on the calendar yet",
    action:
      "check the calendar for it, and if it is genuinely missing, propose a create_event for it",
  },
  {
    name: "noise",
    matches: "newsletters, marketing, notifications, receipts for things already dealt with, automated mail",
    action: "count them, name at most two senders, and move on",
  },
];

export function triageInstructions(autoDraftUrgent: boolean): string {
  const buckets = BUCKETS.map((b) => `- ${b.name}: ${b.matches}\n  Report as: ${b.action}`).join("\n");
  return `Sort the mail into these buckets. Every message lands in exactly one. When torn, pick the more demanding bucket.

${buckets}

How to work, in this order:
1. Use gmail_search to list the mail. Classify from the sender, subject and snippet alone: that is usually enough and it is far cheaper than opening each one.
2. Open a body with gmail_read only when you cannot classify it, or when you are about to draft a reply to it.
3. ${
    autoDraftUrgent
      ? "For the urgent bucket only, and for at most three messages, propose a create_draft reply. Keep each draft short and in the language of the thread. A draft is saved in Gmail, not sent, and the owner still approves it."
      : "Do not draft anything unless the owner asks."
  }
4. For the calendar bucket, check the calendar first. Only propose an event when it is really missing.
5. Honour any bucket preferences the owner has saved in memory, including buckets they invented.

Writing the report: lead with urgent, then reply, then money, then calendar. Noise gets one line at the end. Name people, not message ids. If a bucket is empty, leave it out entirely. No headers, no markdown, no bullet characters. If nothing arrived worth mentioning, say so in one line.`;
}

/** Ids already triaged, so a second run does not repeat itself. */
export async function untriaged(query: string, max = 40): Promise<{ ids: string[]; keys: string[] }> {
  const mail = await searchMail(query, max);
  const keys = mail.map((m) => `triage:${m.id}`);
  if (keys.length === 0) return { ids: [], keys: [] };
  const { data } = await db().from("assistant_notified").select("key").in("key", keys);
  const seen = new Set((data ?? []).map((r) => r.key as string));
  const fresh = mail.filter((m) => !seen.has(`triage:${m.id}`));
  return { ids: fresh.map((m) => m.id), keys: fresh.map((m) => `triage:${m.id}`) };
}

export const TRIAGE_QUERY = "newer_than:1d in:inbox -in:chats";

export function triageTask(count: number): string {
  const c = config();
  return `Inbox triage. ${count} messages arrived in the last day that you have not sorted yet. Search with: ${TRIAGE_QUERY}

${triageInstructions(c.TRIAGE_AUTODRAFT)}`;
}

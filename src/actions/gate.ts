/**
 * Principle 4: read freely, act with approval.
 *
 * The model never calls sendMail / createEvent / deleteEvent directly. It
 * proposes an action; the proposal is stored with its exact payload and the
 * owner gets Approve / Reject buttons in Telegram. Only a tap executes it.
 * There is deliberately no "always allow".
 */
import { z } from "zod";
import { db } from "../db/supabase.js";
import { audit } from "../audit/log.js";
import { config } from "../config.js";
import { sendMail, createDraft } from "../google/gmail.js";
import { createEvent, deleteEvent } from "../google/calendar.js";

export const ActionSchemas = {
  send_email: z.object({
    to: z.string().min(3),
    subject: z.string().min(1),
    body: z.string().min(1),
    threadId: z.string().optional(),
  }),
  create_draft: z.object({
    to: z.string().min(3),
    subject: z.string().min(1),
    body: z.string().min(1),
    threadId: z.string().optional(),
  }),
  create_event: z.object({
    title: z.string().min(1),
    startIso: z.string().min(10),
    endIso: z.string().min(10),
    location: z.string().optional(),
    description: z.string().optional(),
    attendees: z.array(z.string()).optional(),
  }),
  delete_event: z.object({
    eventId: z.string().min(1),
    title: z.string().optional(),
  }),
} as const;

export type ActionType = keyof typeof ActionSchemas;
export const ACTION_TYPES = Object.keys(ActionSchemas) as ActionType[];

export interface Approval {
  id: string;
  action_type: ActionType;
  summary: string;
  payload: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "expired" | "executed" | "failed";
  telegram_message_id: number | null;
  result: string | null;
  created_at: string;
  expires_at: string;
}

export function describeAction(type: ActionType, payload: Record<string, unknown>): string {
  switch (type) {
    case "send_email":
      return `Send email to ${payload.to}\nSubject: ${payload.subject}\n\n${String(payload.body).slice(0, 1500)}`;
    case "create_draft":
      return `Save a Gmail draft to ${payload.to}\nSubject: ${payload.subject}\n\n${String(payload.body).slice(0, 1500)}`;
    case "create_event":
      return `Create calendar event "${payload.title}"\n${payload.startIso} to ${payload.endIso}${payload.location ? `\nAt: ${payload.location}` : ""}${Array.isArray(payload.attendees) && payload.attendees.length ? `\nInvite: ${payload.attendees.join(", ")}` : ""}`;
    case "delete_event":
      return `Delete calendar event ${payload.title ? `"${payload.title}" ` : ""}(${payload.eventId})`;
  }
}

/** Creates a pending approval. Validates the payload against the schema first. */
export async function propose(type: ActionType, rawPayload: unknown, reason: string): Promise<Approval> {
  const schema = ActionSchemas[type];
  const parsed = schema.safeParse(rawPayload);
  if (!parsed.success) {
    throw new Error(`Invalid ${type} payload: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const payload = parsed.data as Record<string, unknown>;
  const expires = new Date(Date.now() + config().APPROVAL_TTL_HOURS * 3600_000).toISOString();
  const summary = describeAction(type, payload);
  const { data, error } = await db()
    .from("assistant_approvals")
    .insert({ action_type: type, summary, payload, expires_at: expires })
    .select()
    .single();
  if (error) throw new Error(`Could not store proposal: ${error.message}`);
  await audit("approval", "assistant", { event: "proposed", id: data.id, type, reason, payload });
  return data as Approval;
}

export async function attachMessageId(id: string, telegramMessageId: number): Promise<void> {
  await db().from("assistant_approvals").update({ telegram_message_id: telegramMessageId }).eq("id", id);
}

export async function getApproval(id: string): Promise<Approval | null> {
  const { data } = await db().from("assistant_approvals").select("*").eq("id", id).maybeSingle();
  return (data as Approval) ?? null;
}

export async function listPending(): Promise<Approval[]> {
  const { data } = await db()
    .from("assistant_approvals")
    .select("*")
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true });
  return (data ?? []) as Approval[];
}

export async function expireStale(): Promise<number> {
  const { data } = await db()
    .from("assistant_approvals")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString())
    .select("id");
  const n = data?.length ?? 0;
  if (n > 0) await audit("approval", "system", { event: "expired", count: n });
  return n;
}

export async function reject(id: string): Promise<Approval | null> {
  const { data } = await db()
    .from("assistant_approvals")
    .update({ status: "rejected", decided_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "pending")
    .select()
    .maybeSingle();
  if (data) await audit("approval", "owner", { event: "rejected", id });
  return (data as Approval) ?? null;
}

async function execute(a: Approval): Promise<string> {
  const p = a.payload as never;
  switch (a.action_type) {
    case "send_email": {
      const id = await sendMail(p);
      return `Email sent (id ${id}).`;
    }
    case "create_draft": {
      const id = await createDraft(p);
      return `Draft saved in Gmail (id ${id}).`;
    }
    case "create_event": {
      const ev = await createEvent(p);
      return `Event created: ${ev.title} on ${ev.start}${ev.htmlLink ? `\n${ev.htmlLink}` : ""}`;
    }
    case "delete_event": {
      await deleteEvent((a.payload as { eventId: string }).eventId);
      return "Event deleted.";
    }
  }
}

/**
 * Approve and execute in one step. The status flip from pending to approved is
 * conditional, so a double tap cannot run an action twice.
 */
export async function approveAndExecute(id: string): Promise<{ ok: boolean; message: string }> {
  const now = new Date().toISOString();
  const { data: claimed } = await db()
    .from("assistant_approvals")
    .update({ status: "approved", decided_at: now })
    .eq("id", id)
    .eq("status", "pending")
    .gt("expires_at", now)
    .select()
    .maybeSingle();
  if (!claimed) {
    const current = await getApproval(id);
    return { ok: false, message: current ? `This request is already ${current.status}.` : "Unknown request." };
  }
  const a = claimed as Approval;
  await audit("approval", "owner", { event: "approved", id, type: a.action_type });
  try {
    const result = await execute(a);
    await db().from("assistant_approvals").update({ status: "executed", executed_at: new Date().toISOString(), result }).eq("id", id);
    await audit("action", "assistant", { event: "executed", id, type: a.action_type, result });
    return { ok: true, message: result };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db().from("assistant_approvals").update({ status: "failed", result: msg }).eq("id", id);
    await audit("error", "system", { where: "execute", id, type: a.action_type, message: msg });
    return { ok: false, message: `Approved, but it failed: ${msg}` };
  }
}

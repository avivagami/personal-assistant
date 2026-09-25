/**
 * The assistant's own clock. Every N minutes it looks at new mail and the
 * next hour of calendar and asks the model whether anything deserves a text.
 * It holds nothing between runs except the ids it already mentioned.
 */
import { config } from "../config.js";
import { db } from "../db/supabase.js";
import { audit } from "../audit/log.js";
import { runAgent } from "../agent/run.js";
import { appendChat } from "../agent/history.js";
import { googleClient } from "../google/auth.js";
import { searchMail } from "../google/gmail.js";
import { listEvents } from "../google/calendar.js";
import { notifyOwner, postApproval } from "../telegram/bot.js";
import { expireStale } from "../actions/gate.js";
import { purgeOldRows } from "../audit/log.js";
import { TRIAGE_QUERY, triageInstructions as triageInstructionsFor, triageTask, untriaged } from "./triage.js";

const NOTHING = "NOTHING_TO_REPORT";

async function alreadyNotified(keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const { data } = await db().from("assistant_notified").select("key").in("key", keys);
  return new Set((data ?? []).map((r) => r.key as string));
}

async function markNotified(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db().from("assistant_notified").upsert(keys.map((key) => ({ key })), { onConflict: "key" });
}

async function deliver(task: string, label: string, keys: string[]): Promise<void> {
  const c = config();
  const result = await runAgent({
    input: task,
    onProposal: postApproval,
    effort: "low",
    model: c.ANTHROPIC_MODEL_PROACTIVE ?? c.ANTHROPIC_MODEL,
    purpose: label,
  });
  const text = result.text.trim();
  await audit("proactive", "assistant", { label, keys, said: text !== NOTHING && !text.includes(NOTHING), tools: result.toolCalls.map((t) => t.name) });
  await markNotified(keys);
  if (!text || text.includes(NOTHING)) return;
  await notifyOwner(text);
  await appendChat("assistant", text);
}

/** Every N minutes. */
export async function periodicCheck(): Promise<void> {
  const c = config();
  await expireStale();
  if (!(await googleClient())) return;

  const minutes = c.PROACTIVE_INTERVAL_MINUTES;
  const mail = await searchMail(`newer_than:1h -category:promotions -category:social -category:updates`, 20);
  const now = new Date();
  const events = await listEvents(now.toISOString(), new Date(now.getTime() + 65 * 60_000).toISOString(), 10);

  const keys = [...mail.map((m) => `gmail:${m.id}`), ...events.map((e) => `cal:${e.id}`)];
  const seen = await alreadyNotified(keys);
  const newMail = mail.filter((m) => !seen.has(`gmail:${m.id}`));
  const newEvents = events.filter((e) => !seen.has(`cal:${e.id}`));
  if (newMail.length === 0 && newEvents.length === 0) return;

  const task = `Proactive check (runs every ${minutes} minutes, nobody asked a question). Decide if anything here deserves a short text to the owner right now: an email that clearly needs a reply or a decision today, or an event starting within the hour that they may have forgotten. Ignore newsletters, receipts, notifications and routine mail. Do not propose any action. If nothing is worth interrupting for, reply with exactly ${NOTHING}. Otherwise write the text, two or three sentences at most.

New email ids to look at: ${newMail.map((m) => m.id).join(", ") || "none"}
Upcoming event ids: ${newEvents.map((e) => e.id).join(", ") || "none"}
Use gmail_read / calendar_list to look at them.`;

  await deliver(task, "periodic", [...newMail.map((m) => `gmail:${m.id}`), ...newEvents.map((e) => `cal:${e.id}`)]);
}

/** Weekday morning: the day ahead, then the inbox sorted into buckets. */
export async function morningBrief(): Promise<void> {
  if (!(await googleClient())) return;
  const c = config();
  const { ids, keys } = await untriaged(TRIAGE_QUERY);
  const task = `Morning brief. Write one message with two parts, in this order.

Part one, the day ahead. Call weather_today first and open with a single weather line, mentioning rain or an unusual temperature only when it would change what the owner wears or carries. Then today's calendar in order with times. Then open follow-ups from memory that are due today or overdue.

Part two, the inbox. ${
    ids.length === 0
      ? "Nothing new arrived overnight, so say that in a few words and stop."
      : `${ids.length} messages arrived since you last looked. Search with: ${TRIAGE_QUERY}\n\n${triageInstructionsFor(c.TRIAGE_AUTODRAFT)}`
  }

Separate the two parts with a blank line. Keep the whole thing short enough to read standing up.`;
  await deliver(task, "morning_brief", keys);
}

/** On demand, and whenever the owner asks what is in the inbox. */
export async function inboxTriage(): Promise<string> {
  if (!(await googleClient())) return "Google is not connected. Send /connect first.";
  const { ids, keys } = await untriaged(TRIAGE_QUERY);
  if (ids.length === 0) return "Nothing new since I last sorted the inbox.";
  const result = await runAgent({
    input: triageTask(ids.length),
    onProposal: postApproval,
    effort: "low",
    model: config().ANTHROPIC_MODEL_PROACTIVE,
    purpose: "triage",
  });
  await markNotified(keys);
  await appendChat("assistant", result.text);
  await audit("proactive", "assistant", { label: "triage_on_demand", count: ids.length });
  return result.text;
}

/** Late afternoon: threads the owner sent that got no reply. */
export async function droppedThreads(): Promise<void> {
  if (!(await googleClient())) return;
  const task = `Dropped threads check. Use gmail_sent_without_reply for 3 days. For each thread that plausibly still needs an answer (skip receipts, one-way notes, thanks), propose a create_draft with a short, polite nudge in the thread's language, replying in the same thread. Then tell the owner how many nudges are waiting for approval. If there are none, reply with exactly ${NOTHING}.`;
  await deliver(task, "dropped_threads", []);
}

export async function housekeeping(): Promise<void> {
  const c = config();
  await purgeOldRows(c.AUDIT_RETENTION_DAYS, c.CHAT_RETENTION_DAYS);
  await expireStale();
}

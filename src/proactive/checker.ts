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
  const result = await runAgent({ input: task, onProposal: postApproval, effort: "low" });
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

/** Weekday morning. */
export async function morningBrief(): Promise<void> {
  if (!(await googleClient())) return;
  const task = `Morning brief. Write today's brief for the owner: today's calendar in order with times, unanswered emails older than 2 days that still seem to need a reply, and open follow-ups from memory that are due today or overdue. Keep it to what matters. No headers. If there is genuinely nothing, say so in one line. Do not propose actions.`;
  await deliver(task, "morning_brief", []);
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

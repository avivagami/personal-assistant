import { db } from "../db/supabase.js";

export type AuditKind = "message_in" | "message_out" | "tool_call" | "approval" | "action" | "proactive" | "error";
export type Actor = "owner" | "assistant" | "system";

/** Every tool call, approval and message lands here. Never throws. */
export async function audit(kind: AuditKind, actor: Actor, detail: Record<string, unknown>): Promise<void> {
  try {
    const { error } = await db().from("assistant_audit_log").insert({ kind, actor, detail });
    if (error) console.error("[audit] insert failed:", error.message);
  } catch (e) {
    console.error("[audit] failed:", e);
  }
}

export async function recentAudit(limit = 20) {
  const { data } = await db()
    .from("assistant_audit_log")
    .select("at, kind, actor, detail")
    .order("at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

export async function purgeOldRows(auditDays: number, chatDays: number): Promise<void> {
  const cutoffAudit = new Date(Date.now() - auditDays * 86400_000).toISOString();
  const cutoffChat = new Date(Date.now() - chatDays * 86400_000).toISOString();
  await db().from("assistant_audit_log").delete().lt("at", cutoffAudit);
  await db().from("assistant_chat_messages").delete().lt("at", cutoffChat);
  await db().from("assistant_notified").delete().lt("at", cutoffChat);
}

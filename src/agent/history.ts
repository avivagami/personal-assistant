import type Anthropic from "@anthropic-ai/sdk";
import { db } from "../db/supabase.js";

type Msg = Anthropic.Beta.BetaMessageParam;

export async function appendChat(role: "user" | "assistant", content: string): Promise<void> {
  if (!content.trim()) return;
  await db().from("assistant_chat_messages").insert({ role, content });
}

/** Last N turns as plain text, oldest first, starting with a user turn. */
export async function recentHistory(limit = 24): Promise<Msg[]> {
  const { data } = await db()
    .from("assistant_chat_messages")
    .select("role, content")
    .order("at", { ascending: false })
    .limit(limit);
  const rows = (data ?? []).reverse() as { role: "user" | "assistant"; content: string }[];
  while (rows.length && rows[0].role !== "user") rows.shift();
  return rows.map((r) => ({ role: r.role, content: r.content }));
}

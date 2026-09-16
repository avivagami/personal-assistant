import { db } from "../db/supabase.js";
import { audit } from "../audit/log.js";

export type MemoryKind = "fact" | "preference" | "followup";

export interface Memory {
  id: string;
  kind: MemoryKind;
  content: string;
  due_at: string | null;
  done_at: string | null;
  source: string;
  created_at: string;
}

export async function remember(kind: MemoryKind, content: string, opts: { dueAt?: string; source?: "user" | "assistant" } = {}): Promise<Memory> {
  const { data, error } = await db()
    .from("assistant_memories")
    .insert({ kind, content, due_at: opts.dueAt ?? null, source: opts.source ?? "assistant" })
    .select()
    .single();
  if (error) throw new Error(`Could not save memory: ${error.message}`);
  await audit("action", "assistant", { action: "memory_saved", kind, content });
  return data as Memory;
}

export async function listMemories(includeDone = false): Promise<Memory[]> {
  let q = db().from("assistant_memories").select("*").order("created_at", { ascending: true });
  if (!includeDone) q = q.is("done_at", null);
  const { data, error } = await q;
  if (error) throw new Error(`Could not list memories: ${error.message}`);
  return (data ?? []) as Memory[];
}

export async function completeFollowup(id: string): Promise<boolean> {
  const { data, error } = await db()
    .from("assistant_memories")
    .update({ done_at: new Date().toISOString() })
    .eq("id", id)
    .is("done_at", null)
    .select("id");
  if (error) throw new Error(`Could not complete follow-up: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

export async function deleteMemory(id: string): Promise<boolean> {
  const { data, error } = await db().from("assistant_memories").delete().eq("id", id).select("id");
  if (error) throw new Error(`Could not delete memory: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** /forget: truncates the memory store and chat history. Returns row counts removed. */
export async function forgetEverything(): Promise<{ memories: number; chat: number; notified: number }> {
  const count = async (table: string) => {
    const { count } = await db().from(table).select("*", { count: "exact", head: true });
    return count ?? 0;
  };
  const before = { memories: await count("assistant_memories"), chat: await count("assistant_chat_messages"), notified: await count("assistant_notified") };
  // Filter is required by supabase-js for delete; these match every row.
  await db().from("assistant_memories").delete().not("id", "is", null);
  await db().from("assistant_chat_messages").delete().gt("id", 0);
  await db().from("assistant_notified").delete().not("key", "is", null);
  await audit("action", "owner", { action: "forget_everything", removed: before });
  return before;
}

/** Compact text block for the system prompt. */
export async function memoryContext(): Promise<string> {
  const mems = await listMemories(false);
  if (mems.length === 0) return "(nothing remembered yet)";
  return mems
    .map((m) => {
      const due = m.due_at ? ` (due ${m.due_at.slice(0, 10)})` : "";
      return `- [${m.kind}] ${m.content}${due} {id:${m.id.slice(0, 8)}}`;
    })
    .join("\n");
}

export async function resolveMemoryId(shortId: string): Promise<string | null> {
  const mems = await listMemories(true);
  const match = mems.find((m) => m.id === shortId || m.id.startsWith(shortId));
  return match?.id ?? null;
}

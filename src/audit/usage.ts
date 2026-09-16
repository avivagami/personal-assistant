/**
 * Token accounting per model call, so cost is measured rather than guessed.
 * Prices are USD per million tokens (input, cache write 1h, cache read, output).
 */
import { db } from "../db/supabase.js";
import type { Usage } from "../agent/run.js";

const PRICES: Record<string, [number, number, number, number]> = {
  "claude-opus-5": [5, 10, 0.5, 25],
  "claude-sonnet-5": [2, 4, 0.2, 10],
  "claude-haiku-4-5": [1, 2, 0.1, 5],
  "claude-opus-4-8": [5, 10, 0.5, 25],
};

export function estimateUsd(model: string, u: Usage): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5"];
  return (u.input * p[0] + u.cacheWrite * p[1] + u.cacheRead * p[2] + u.output * p[3]) / 1_000_000;
}

export async function recordUsage(model: string, purpose: string, u: Usage): Promise<void> {
  try {
    await db().from("assistant_usage").insert({
      model,
      purpose,
      requests: u.requests,
      input_tokens: u.input,
      cache_write_tokens: u.cacheWrite,
      cache_read_tokens: u.cacheRead,
      output_tokens: u.output,
      usd: estimateUsd(model, u),
    });
  } catch (e) {
    console.error("[usage] insert failed:", e);
  }
}

interface Row { purpose: string; requests: number; input_tokens: number; cache_write_tokens: number; cache_read_tokens: number; output_tokens: number; usd: number; at: string }

async function since(iso: string): Promise<Row[]> {
  const { data } = await db().from("assistant_usage").select("*").gte("at", iso);
  return (data ?? []) as Row[];
}

export async function costReport(): Promise<string> {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const month = await since(monthStart.toISOString());
  const today = month.filter((r) => r.at >= dayStart.toISOString());
  const sum = (rows: Row[]) => rows.reduce((a, r) => a + Number(r.usd), 0);
  const byPurpose = new Map<string, { usd: number; runs: number }>();
  for (const r of month) {
    const e = byPurpose.get(r.purpose) ?? { usd: 0, runs: 0 };
    e.usd += Number(r.usd); e.runs += 1; byPurpose.set(r.purpose, e);
  }
  const allIn = month.reduce((a, r) => a + r.input_tokens + r.cache_write_tokens + r.cache_read_tokens, 0);
  const cached = month.reduce((a, r) => a + r.cache_read_tokens, 0);
  const hit = allIn ? Math.round((cached / allIn) * 100) : 0;
  const lines = [
    `Today: $${sum(today).toFixed(2)} (${today.length} runs)`,
    `This month: $${sum(month).toFixed(2)} (${month.length} runs), cache hit ${hit}%`,
    ...[...byPurpose.entries()].sort((a, b) => b[1].usd - a[1].usd).map(([k, v]) => `  ${k}: $${v.usd.toFixed(2)} over ${v.runs} runs`),
  ];
  return lines.join("\n");
}

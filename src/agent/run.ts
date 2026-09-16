import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config.js";
import { audit } from "../audit/log.js";
import { TOOLS, runTool, type ToolContext } from "./tools.js";
import { stableSystemPrompt, volatileSystemPrompt } from "./prompt.js";
import { realBackend, type ToolBackend } from "./backend.js";
import { connectedEmail } from "../google/auth.js";
import type { Approval } from "../actions/gate.js";
import { recordUsage } from "../audit/usage.js";

type Msg = Anthropic.Beta.BetaMessageParam;

let client: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: config().ANTHROPIC_API_KEY });
  return client;
}

export interface RunOptions {
  /** Prior turns, oldest first. */
  history?: Msg[];
  /** The new user message (or a system-generated task for proactive runs). */
  input: string;
  backend?: ToolBackend;
  onProposal?: (a: Approval) => Promise<void> | void;
  /** Overrides for tests. */
  connectedEmailOverride?: string | null;
  effort?: "low" | "medium" | "high";
  maxIterations?: number;
  /** Model override, e.g. a cheaper one for unattended checks. */
  model?: string;
  /** Label for the usage log: "chat", "periodic", "morning_brief", ... */
  purpose?: string;
}

export interface Usage {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  requests: number;
}

export interface RunResult {
  text: string;
  usage: Usage;
  toolCalls: { name: string; input: unknown; ok: boolean }[];
  proposals: Approval[];
  stopReason: string | null;
}

/**
 * One agent turn: manual tool loop over the Messages API. The model reads
 * freely; every write is routed through propose_action and the approval gate.
 */
export async function runAgent(opts: RunOptions): Promise<RunResult> {
  const c = config();
  const backend = opts.backend ?? realBackend;
  const proposals: Approval[] = [];
  const ctx: ToolContext = {
    backend,
    onProposal: async (a) => {
      proposals.push(a);
      await opts.onProposal?.(a);
    },
  };

  const email = opts.connectedEmailOverride !== undefined ? opts.connectedEmailOverride : await connectedEmail();
  const nowIso = new Date().toLocaleString("sv-SE", { timeZone: c.TIMEZONE }).replace(" ", "T");
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    // 1-hour cache: turns are minutes apart while a human reads and replies, so a
    // 5-minute cache would expire between most turns and re-bill the whole prefix.
    { type: "text", text: stableSystemPrompt(c.OWNER_NAME, c.TIMEZONE), cache_control: { type: "ephemeral", ttl: "1h" } },
    { type: "text", text: volatileSystemPrompt(nowIso, await backend.memoryContext(), email) },
  ];

  const messages: Msg[] = [...(opts.history ?? []), { role: "user", content: opts.input }];
  const toolCalls: RunResult["toolCalls"] = [];
  const maxIter = opts.maxIterations ?? 12;
  let finalText = "";
  let stopReason: string | null = null;
  const usage: Usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, requests: 0 };
  const model = opts.model ?? c.ANTHROPIC_MODEL;

  for (let iter = 0; iter < maxIter; iter++) {
    const response = await anthropic().beta.messages.create({
      model,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Auto-cache the growing conversation tail inside the tool loop.
      cache_control: { type: "ephemeral" },
      thinking: { type: "adaptive" },
      output_config: { effort: opts.effort ?? "medium" },
      system,
      tools: TOOLS,
      messages,
    });
    stopReason = response.stop_reason;
    usage.requests += 1;
    usage.input += response.usage.input_tokens;
    usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
    usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
    usage.output += response.usage.output_tokens;

    if (response.stop_reason === "refusal") {
      finalText = "I can't help with that one.";
      break;
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }

    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");

    if (toolUses.length === 0 || response.stop_reason === "max_tokens") {
      finalText = text || finalText;
      if (response.stop_reason === "max_tokens") finalText += "\n(I ran out of room; ask me to continue.)";
      break;
    }

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      try {
        const out = await runTool(tu.name, tu.input, ctx);
        toolCalls.push({ name: tu.name, input: tu.input, ok: true });
        await audit("tool_call", "assistant", { tool: tu.name, input: tu.input, ok: true });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toolCalls.push({ name: tu.name, input: tu.input, ok: false });
        await audit("tool_call", "assistant", { tool: tu.name, input: tu.input, ok: false, error: msg });
        results.push({ type: "tool_result", tool_use_id: tu.id, content: `Error: ${msg}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }

  if (!finalText) finalText = "I did the reading but ran out of steps before answering. Ask me again more narrowly.";
  await recordUsage(model, opts.purpose ?? "chat", usage);
  return { text: finalText, usage, toolCalls, proposals, stopReason };
}

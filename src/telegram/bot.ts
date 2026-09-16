import { Bot, InlineKeyboard, type Context } from "grammy";
import { config } from "../config.js";
import { audit, recentAudit } from "../audit/log.js";
import { runAgent } from "../agent/run.js";
import { appendChat, recentHistory } from "../agent/history.js";
import { authUrl, connectWithCode, connectedEmail, disconnect, extractCode } from "../google/auth.js";
import { forgetEverything, listMemories } from "../memory/store.js";
import { approveAndExecute, attachMessageId, getApproval, listPending, reject, type Approval } from "../actions/gate.js";

let bot: Bot | undefined;

export function telegram(): Bot {
  if (!bot) throw new Error("Bot not started");
  return bot;
}

function isOwner(ctx: Context): boolean {
  return ctx.from?.id === config().TELEGRAM_OWNER_ID;
}

/** Telegram caps messages at 4096 chars. */
async function say(chatId: number, text: string): Promise<void> {
  const chunks = text.match(/[\s\S]{1,3900}/g) ?? [text];
  for (const c of chunks) await telegram().api.sendMessage(chatId, c, { link_preview_options: { is_disabled: true } });
}

export async function notifyOwner(text: string): Promise<void> {
  await say(config().TELEGRAM_OWNER_ID, text);
  await audit("message_out", "assistant", { proactive: true, text });
}

/** Posts a proposal with Approve / Reject buttons. */
export async function postApproval(a: Approval): Promise<void> {
  const kb = new InlineKeyboard().text("✅ Approve", `approve:${a.id}`).text("❌ Reject", `reject:${a.id}`);
  const expires = new Date(a.expires_at).toLocaleString("en-GB", { timeZone: config().TIMEZONE, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
  const msg = await telegram().api.sendMessage(
    config().TELEGRAM_OWNER_ID,
    `Waiting for your approval (expires ${expires}):\n\n${a.summary}`,
    { reply_markup: kb, link_preview_options: { is_disabled: true } },
  );
  await attachMessageId(a.id, msg.message_id);
}

const HELP = `I read your Gmail, Calendar and Drive live and act only after you tap Approve.

/connect - link your Google account
/disconnect - revoke the Google token and delete it
/status - what is connected
/pending - proposals waiting for your tap
/memory - what I remember
/forget - erase memory and chat history
/audit - last 20 things I did
/help - this

Or just text me. "What did I not reply to?", "Book lunch with Dana Thursday 13:00", "Remind me to call the bank Friday".`;

export async function startBot(): Promise<Bot> {
  const c = config();
  bot = new Bot(c.TELEGRAM_BOT_TOKEN);

  // Owner-only. Anyone else gets silence, and an audit row.
  bot.use(async (ctx, next) => {
    if (!isOwner(ctx)) {
      await audit("error", "system", { where: "telegram", event: "non_owner_message", from: ctx.from?.id });
      return;
    }
    await next();
  });

  bot.command(["start", "help"], (ctx) => ctx.reply(HELP));

  bot.command("connect", async (ctx) => {
    const existing = await connectedEmail();
    if (existing) return ctx.reply(`Already connected as ${existing}. Send /disconnect first to switch accounts.`);
    await ctx.reply(
      `1. Open this link and choose your Google account:\n${authUrl()}\n\n2. After you approve, the browser will land on a page that does not load (localhost). That is expected.\n\n3. Copy the whole address from the address bar and paste it here.`,
      { link_preview_options: { is_disabled: true } },
    );
  });

  bot.command("disconnect", async (ctx) => {
    const r = await disconnect();
    await ctx.reply(
      r.revokedAtGoogle
        ? "Google token revoked at Google and deleted here. I can no longer read anything."
        : `Deleted the token here${r.deletedLocally ? "" : " (delete failed, check logs)"}, but Google did not confirm revocation. Also remove the app at https://myaccount.google.com/permissions to be sure.`,
    );
  });

  bot.command("status", async (ctx) => {
    const email = await connectedEmail();
    const pending = await listPending();
    const mems = await listMemories();
    await ctx.reply(
      `Google: ${email ?? "not connected"}\nPending approvals: ${pending.length}\nMemories: ${mems.length}\nModel: ${c.ANTHROPIC_MODEL}\nProactive checks: ${c.PROACTIVE_ENABLED ? `every ${c.PROACTIVE_INTERVAL_MINUTES} min` : "off"}`,
    );
  });

  bot.command("pending", async (ctx) => {
    const pending = await listPending();
    if (pending.length === 0) return ctx.reply("Nothing waiting for you.");
    for (const a of pending) await postApproval(a);
  });

  bot.command("memory", async (ctx) => {
    const mems = await listMemories();
    if (mems.length === 0) return ctx.reply("I remember nothing yet.");
    const lines = mems.map((m) => `• [${m.kind}] ${m.content}${m.due_at ? ` (due ${m.due_at.slice(0, 10)})` : ""}`);
    await ctx.reply(lines.join("\n"));
  });

  bot.command("forget", async (ctx) => {
    const kb = new InlineKeyboard().text("Yes, erase everything", "forget:confirm").text("Cancel", "forget:cancel");
    await ctx.reply("Erase all memories, follow-ups and chat history? The audit log and the Google connection stay.", { reply_markup: kb });
  });

  bot.command("audit", async (ctx) => {
    const rows = await recentAudit(20);
    if (rows.length === 0) return ctx.reply("Audit log is empty.");
    const lines = rows.map((r) => {
      const t = new Date(r.at).toLocaleString("en-GB", { timeZone: c.TIMEZONE, hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" });
      const d = r.detail as Record<string, unknown>;
      const what = d.tool ?? d.action ?? d.event ?? d.where ?? "";
      return `${t} ${r.kind}/${r.actor} ${what}`;
    });
    await ctx.reply(lines.join("\n"));
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    const [kind, id] = data.split(":");
    if (kind === "forget") {
      if (id === "confirm") {
        const r = await forgetEverything();
        await ctx.editMessageText(`Erased ${r.memories} memories and ${r.chat} chat messages.`);
      } else {
        await ctx.editMessageText("Cancelled. Nothing erased.");
      }
      return ctx.answerCallbackQuery();
    }
    if (kind === "approve" || kind === "reject") {
      const a = await getApproval(id);
      if (!a) {
        await ctx.answerCallbackQuery({ text: "Unknown request." });
        return;
      }
      if (kind === "reject") {
        const r = await reject(id);
        await ctx.editMessageText(`${r ? "Rejected" : `Already ${a.status}`}:\n\n${a.summary}`);
        return ctx.answerCallbackQuery({ text: r ? "Rejected" : "No change" });
      }
      const result = await approveAndExecute(id);
      await ctx.editMessageText(`${result.ok ? "Done" : "Not done"}: ${result.message}\n\n${a.summary}`);
      return ctx.answerCallbackQuery({ text: result.ok ? "Done" : "Failed" });
    }
    await ctx.answerCallbackQuery();
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message.text.trim();
    const chatId = ctx.chat.id;

    // Pasted OAuth redirect URL or code.
    if (text.includes("oauth/callback") || text.startsWith("4/")) {
      const code = extractCode(text);
      if (!code) return ctx.reply("I could not find the code in that. Paste the full address from the browser.");
      try {
        const email = await connectWithCode(code);
        return ctx.reply(`Connected to ${email}. Try: what did I not reply to?`);
      } catch (e) {
        return ctx.reply(`Google connection failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await audit("message_in", "owner", { text });
    await ctx.replyWithChatAction("typing");
    const typing = setInterval(() => ctx.replyWithChatAction("typing").catch(() => {}), 4500);
    try {
      const history = await recentHistory();
      await appendChat("user", text);
      const result = await runAgent({ history, input: text, onProposal: postApproval });
      await appendChat("assistant", result.text);
      await audit("message_out", "assistant", { text: result.text, tools: result.toolCalls.map((t) => t.name), proposals: result.proposals.length });
      await say(chatId, result.text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await audit("error", "system", { where: "agent", message: msg });
      await say(chatId, `Something went wrong: ${msg}`);
    } finally {
      clearInterval(typing);
    }
  });

  bot.catch((err) => {
    console.error("[telegram]", err.error);
    void audit("error", "system", { where: "telegram", message: String(err.error) });
  });

  await bot.api.setMyCommands([
    { command: "help", description: "What I can do" },
    { command: "connect", description: "Link Google" },
    { command: "disconnect", description: "Revoke Google" },
    { command: "status", description: "What is connected" },
    { command: "pending", description: "Approvals waiting" },
    { command: "memory", description: "What I remember" },
    { command: "forget", description: "Erase memory" },
    { command: "audit", description: "Recent activity" },
  ]);

  // Long polling: nothing inbound reaches the server. No webhook, no open port.
  void bot.start({ onStart: (me) => console.log(`[telegram] @${me.username} is listening`) });
  return bot;
}

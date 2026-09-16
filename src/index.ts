import "dotenv/config";
import { config } from "./config.js";
import { startBot } from "./telegram/bot.js";
import { startScheduler } from "./proactive/scheduler.js";
import { db } from "./db/supabase.js";

async function main(): Promise<void> {
  const c = config();
  // Fail fast if the database is not reachable or the migration was not applied.
  const { error } = await db().from("assistant_audit_log").select("id", { head: true, count: "exact" });
  if (error) throw new Error(`Supabase check failed: ${error.message}. Did you run the migration in supabase/migrations?`);

  await startBot();
  startScheduler();
  console.log(`[assistant] up. owner=${c.TELEGRAM_OWNER_ID} model=${c.ANTHROPIC_MODEL} tz=${c.TIMEZONE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

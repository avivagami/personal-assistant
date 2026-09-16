import { config } from "../config.js";
import { audit } from "../audit/log.js";
import { droppedThreads, housekeeping, morningBrief, periodicCheck } from "./checker.js";

function localHM(d: Date): { hm: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: config().TIMEZONE, hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { hm: `${get("hour")}:${get("minute")}`, weekday: days.indexOf(get("weekday")) };
}

function guarded(name: string, fn: () => Promise<void>): () => Promise<void> {
  let running = false;
  return async () => {
    if (running) return;
    running = true;
    try {
      await fn();
    } catch (e) {
      console.error(`[scheduler] ${name} failed:`, e);
      await audit("error", "system", { where: name, message: e instanceof Error ? e.message : String(e) });
    } finally {
      running = false;
    }
  };
}

export function startScheduler(): void {
  const c = config();
  if (!c.PROACTIVE_ENABLED) {
    console.log("[scheduler] proactive checks disabled");
    return;
  }
  const periodic = guarded("periodicCheck", periodicCheck);
  const brief = guarded("morningBrief", morningBrief);
  const dropped = guarded("droppedThreads", droppedThreads);
  const clean = guarded("housekeeping", housekeeping);

  setInterval(periodic, c.PROACTIVE_INTERVAL_MINUTES * 60_000);

  // Minute ticker for the fixed-time jobs. Fires once per matching minute.
  let lastMinute = "";
  setInterval(async () => {
    const { hm, weekday } = localHM(new Date());
    if (hm === lastMinute) return;
    lastMinute = hm;
    const weekdayIL = weekday >= 0 && weekday <= 4; // Sunday to Thursday
    if (hm === c.MORNING_BRIEF_TIME && weekdayIL) await brief();
    if (hm === c.DROPPED_THREADS_TIME && weekdayIL) await dropped();
    if (hm === "03:30") await clean();
  }, 20_000);

  console.log(`[scheduler] periodic every ${c.PROACTIVE_INTERVAL_MINUTES} min, brief ${c.MORNING_BRIEF_TIME}, dropped threads ${c.DROPPED_THREADS_TIME} (${c.TIMEZONE})`);
}

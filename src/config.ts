import { z } from "zod";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(10),
  TELEGRAM_OWNER_ID: z.coerce.number().int().positive(),
  ANTHROPIC_API_KEY: z.string().min(10),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  // Model for the unattended proactive checks (15-minute glance, brief, nudges).
  // Defaults to the main model. Set to claude-haiku-4-5 or claude-sonnet-5 to cut cost.
  ANTHROPIC_MODEL_PROACTIVE: z.string().default("claude-sonnet-5"),
  // The identity the browser uses on booking forms. Never the owner's passwords.
  BOOKING_NAME: z.string().default("Aviv"),
  BOOKING_PHONE: z.string().default(""),
  BOOKING_EMAIL: z.string().default(""),
  // Path to a Chromium binary when not using the bundled one (local dev only).
  CHROMIUM_PATH: z.string().optional(),
  // Weather for the morning brief. Defaults to Tel Aviv.
  WEATHER_LAT: z.coerce.number().default(32.0853),
  WEATHER_LON: z.coerce.number().default(34.7818),
  WEATHER_PLACE: z.string().default("Tel Aviv"),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  GOOGLE_CLIENT_ID: z.string().min(5),
  GOOGLE_CLIENT_SECRET: z.string().min(5),
  // 32 random bytes, base64. Encrypts OAuth tokens at rest in Supabase.
  TOKEN_ENCRYPTION_KEY: z.string().min(40),
  TIMEZONE: z
    .string()
    .default("Asia/Jerusalem")
    .refine(isValidTimeZone, { message: 'not a real timezone. Use one like "Asia/Jerusalem" or "Europe/London"' }),
  OWNER_NAME: z.string().default("Aviv"),
  // Proactive checks
  PROACTIVE_ENABLED: z.coerce.boolean().default(true),
  PROACTIVE_INTERVAL_MINUTES: z.coerce.number().int().min(5).default(15),
  MORNING_BRIEF_TIME: z.string().regex(/^\d{2}:\d{2}$/).default("07:30"),
  // Draft replies for the urgent bucket during triage (at most three).
  TRIAGE_AUTODRAFT: z.coerce.boolean().default(true),
  DROPPED_THREADS_TIME: z.string().regex(/^\d{2}:\d{2}$/).default("17:00"),
  // Retention (days)
  AUDIT_RETENTION_DAYS: z.coerce.number().int().default(90),
  CHAT_RETENTION_DAYS: z.coerce.number().int().default(30),
  APPROVAL_TTL_HOURS: z.coerce.number().int().default(24),
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function config(): Config {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Missing or invalid environment variables:\n${problems}\nSee .env.example`);
  }
  cached = parsed.data;
  return cached;
}

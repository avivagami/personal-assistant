# Personal assistant

A personal assistant you text on Telegram. It reads your Gmail, Google
Calendar and Drive live, follows up on things you dropped, drafts and books
things for you, and remembers what you told it. Your data stays in your own
Google account and your own Supabase project. Nothing is mirrored.

Built from [PLAN.md](docs/PLAN.md). This is Tier 1.

## What it does

- **Reads freely.** Search mail, read threads, list the calendar, search Drive.
- **Acts with approval.** Sending, drafting, creating or deleting an event
  creates a proposal with Approve / Reject buttons. Nothing runs until you
  tap. No "always allow". Proposals expire after 24 hours.
- **Treats email as data.** Every email body, subject, sender, calendar note
  and file name reaches the model inside an `UNTRUSTED_CONTENT` envelope with
  a standing rule that instructions inside it are reported, not followed.
  `npm run test:injection` runs the Alex Cohen phishing experiment.
- **Remembers little.** Facts, preferences and open follow-ups in Supabase.
  `/memory` lists them, `/forget` truncates them.
- **Revoke means gone.** `/disconnect` revokes the token at Google and deletes
  the encrypted copy.
- **Audits everything.** Every message, tool call, proposal and approval in
  one table, purged after 90 days.
- **Proactive.** Morning brief on weekdays, dropped-thread nudges at 17:00,
  and a 15-minute glance at new mail and the next hour of calendar.

## Layout

```
src/
  index.ts              boot
  config.ts             environment variables, validated
  telegram/bot.ts       commands, approval buttons, owner-only guard
  agent/run.ts          the Claude tool loop
  agent/tools.ts        what the model can call
  agent/prompt.ts       the system prompt
  agent/untrusted.ts    the envelope for outside content
  actions/gate.ts       proposals, approval, execution
  google/               OAuth (encrypted, revocable), Gmail, Calendar, Drive
  memory/store.ts       facts, preferences, follow-ups, /forget
  audit/log.ts          the audit table and purge
  proactive/            periodic check, morning brief, dropped threads
supabase/migrations/    the six assistant_* tables
scripts/injection-test.ts   the phishing experiment
docs/SETUP.md           step by step, no coding
```

## Running

See [docs/SETUP.md](docs/SETUP.md). In short: fill in `.env`, then
`docker compose up -d --build` on a small server.

For development: `npm install`, `npm run dev`. Checks: `npm run typecheck`,
`npm test`, and with an API key `npm run test:injection`.

## What is deliberately not here yet

- Browser sandbox for bookings on websites (plan week 5).
- Phone calls (Tier 2).
- Screen or audio capture from your devices (never).

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
- **Knows who people are.** Looks up names in your Google Contacts before
  addressing an email, so "email Dana" reaches the right Dana. Read-only,
  fetched live, never stored.
- **Weather in the brief.** From a free service with no account and no key.
- **Remembers little.** Facts, preferences and open follow-ups in Supabase.
  `/memory` lists them, `/forget` truncates them.
- **Revoke means gone.** `/disconnect` revokes the token at Google and deletes
  the encrypted copy.
- **Audits everything.** Every message, tool call, proposal and approval in
  one table, purged after 90 days.
- **Sorts the inbox.** Overnight mail is triaged into urgent, reply, money,
  calendar and noise, each handled differently: urgent gets a drafted reply,
  money gets the amount and due date, a date that is missing from the calendar
  gets proposed as an event. Part of the morning brief, or `/triage` any time.
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
  browser/session.ts    the private browser: snapshots with refs, actions, screenshots
  actions/gate.ts       proposals, approval, execution
  google/               OAuth (encrypted, revocable), Gmail, Calendar, Drive
  memory/store.ts       facts, preferences, follow-ups, /forget
  audit/log.ts          the audit table and purge
  proactive/            periodic check, morning brief, inbox triage, dropped threads
supabase/migrations/    the six assistant_* tables
scripts/injection-test.ts   the phishing experiment
docs/SETUP.md           step by step, no coding
```

## Running

See [docs/SETUP.md](docs/SETUP.md). In short: fill in `.env`, then
`docker compose up -d --build` on a small server.

For development: `npm install`, `npm run dev`. Checks: `npm run typecheck`,
`npm test`, and with an API key `npm run test:injection`.

- **Does things on websites.** A private Chromium on the server, fresh for
  every task, that the model drives by reading pages as numbered elements
  (no screenshots to the model, which keeps it cheap). Any final button
  (book, confirm, pay, send) is refused in code and routed through the
  approval gate with a screenshot for you. Cards are never entered.

## What is deliberately not here yet

- Phone calls (Tier 2).
- Screen or audio capture from your devices (never).

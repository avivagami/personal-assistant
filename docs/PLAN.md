# A personal assistant like Instinct, without handing over my life

Plan written 16 Sep 2026. Owner: Aviva. Builder: Claude.

The goal is an assistant I can text that reads my email and calendar, follows
up on things I dropped, books and cancels things for me, and remembers what I
told it - the Instinct experience - where **my data stays in my own accounts
and my own database**, and no startup holds a copy of my inbox.

---

## 1. What Instinct actually is

Instinct (Spear Street Technology, San Francisco, founded April 2026 by
ex-Sierra researcher Noah Shinn) is an invite-only assistant with no app. You
text it (iMessage, WhatsApp, SMS) or call it. Behind the conversation it runs
on a **persistent cloud computer of its own**, holding your credentials, and
uses a browser and phone the way a human assistant would. It connects to
email, messaging, calendar, screen, audio and location.

What early users praise:

- It acts, not just answers: books the restaurant, negotiates a bill, cancels
  subscriptions, fills forms, sends email on your behalf.
- It is proactive: follows up on threads you dropped, texts you first,
  arranges the airport ride.
- It has strong memory across weeks.
- Email integration and browser use are the standout features.

Raised $250M at $2.5B (Aug 2026), now reportedly raising up to $1B at ~$10B.
Free during beta, pricing unannounced.

## 2. Why people are worried, specifically

This is the part the plan is designed around. Every item below was reported
by early users or security researchers in August 2026:

| Problem | What happened |
|---|---|
| **Your inbox is copied, not read** | Instinct indexes your email into its own storage. One user's emails were confirmed stored **in plain text** for later search. |
| **Disconnect does not delete** | Claire Vo disconnected Gmail and Instinct kept summarising her inbox. Peter Yang asked it to delete his Gmail records and it would not. A delete tool was added only after press coverage. The revised terms still say disconnecting a service does not stop Instinct using data it already indexed. |
| **Perpetual licence** | The terms grant a perpetual, irrevocable licence to use, store and modify your data, including screen captures, keystrokes and cursor movement. |
| **It can be phished by email** | Alex Cohen emailed his own inbox with instructions addressed to the assistant. Instinct followed them and emailed back a summary of his tasks. Anyone who can email you can instruct your assistant. |
| **It acts without asking** | It sent an email nobody approved. |
| **It signs for you** | The terms allow the agent to enter binding agreements on your behalf. |

Four root causes, and each one is a design decision we simply make the other
way:

1. They **mirror** your accounts into their cloud. We read live, on demand,
   and keep nothing but short notes.
2. They **hold your passwords** on a shared cloud computer. We use revocable
   OAuth tokens, and for browser tasks a separate low-privilege identity.
3. They treat **email content as instructions**. We treat it as data, always.
4. They **act first**. We require a tap of approval for anything that leaves
   my accounts - send, pay, book, cancel, sign.

## 3. Principles for my own version

1. **No mirror.** The assistant never keeps a copy of my inbox, calendar or
   files. It fetches what a task needs, when the task runs, and lets it go.
2. **One database, mine.** The only thing stored long-term is a small memory
   store (facts I told it, open follow-ups, its own audit log) in a Supabase
   project I own, encrypted at rest, deletable with one query.
3. **Minimum exposure to the model.** The model provider (Anthropic) sees the
   slice needed per request under a zero-retention API arrangement, not a
   standing index of my life. Nothing goes to a second vendor.
4. **Read freely, act with approval.** Reading and summarising need no
   confirmation. Any action with an external effect gets a one-tap approval
   in chat first, every time, with no "always allow".
5. **Email is data, not commands.** Content fetched from email, web pages or
   documents is wrapped and labelled as untrusted before the model sees it.
   The model is instructed that only I can give instructions, and the approval
   gate is the backstop when that instruction fails.
6. **Revoke means gone.** Disconnecting a service revokes the OAuth token at
   Google, and a "forget everything" command truncates the memory store.
   Tested, not promised.
7. **Never my real credentials in a browser.** Browser tasks run in a
   sandboxed profile with a dedicated email alias, a virtual card with a low
   limit, and no saved logins for my primary accounts.

## 4. What I already have

This matters because most of the plan is assembly, not invention:

- **Claude Code with connectors already attached:** Gmail, Google Calendar,
  Google Drive, Wispr Flow (meeting notes), Supabase, Netlify.
- **Routines** (scheduled triggers) that can run a prompt on a cron schedule
  and push a notification to my phone.
- **A live Supabase project and Netlify account** from the TikTok World app,
  with a proven pattern for server routes that hold secret keys and never
  expose them to a browser.

The connectors work by OAuth against my own Google account and fetch on
demand. That is exactly principle 1. Nothing is mirrored today.

## 5. Three tiers, cheapest first

### Tier 0 - this week, no code

Use Claude Code plus Routines as the assistant, through the connectors that
already exist.

| Routine | Schedule | What it does |
|---|---|---|
| Morning brief | Weekdays 07:30 Israel | Today's calendar, unanswered emails older than 2 days, anything Wispr Flow captured as an action item yesterday. Push to phone. |
| Dropped threads | Daily 17:00 | Emails I sent that got no reply in 3 business days, drafted nudges waiting for my approval as Gmail drafts. |
| Calendar gaps | Daily 07:00 | Emails containing dates, flights or bookings that are not on the calendar. Proposes events; creates nothing until I say yes. |
| Subscription audit | Monthly | Recurring charges found in receipts, with cancel links, no cancellation performed. |

Data: nothing stored except what the Routine writes as a Google Doc in my own
Drive. Drafts land in my Gmail drafts folder, so "approval" is me pressing
send. The one thing to check before relying on this is my Anthropic account's
data settings, so that connector content is not used for training.

What Tier 0 cannot do: text me from a phone number, act on a website, or run
mid-conversation. It is a scheduled assistant, not a live one.

### Tier 1 - the real assistant on my own always-on computer

Instinct's "persistent cloud computer" is a good idea badly placed. The
problem was never that a machine runs 24/7. The problem is that it is
*their* machine, holding a copy of *my* inbox under *their* terms. So we run
the same thing on a machine I rent in my own name.

**The machine:** one small virtual server (Hetzner, Falkenstein, EU, roughly
5 to 10 euro a month) with full-disk encryption, SSH key login only, and a
firewall that accepts nothing inbound except the chat webhook. Same region as
the Supabase project, so it is one legal jurisdiction and one hop.

```
Me  <--Telegram-->  my server (agent runs 24/7)  <-->  Claude API (tool use)
                        |            |
                        v            v
                 Supabase (memory,  Google OAuth tokens
                 approvals, audit)  + a sandboxed browser
```

What runs on it, always on:

1. **The agent process.** Listens for my messages, and on its own clock
   checks email and calendar every 15 minutes for anything worth telling me
   about. Between checks it holds nothing in memory but the open loops.
2. **A sandboxed browser** in its own container, restarted clean after every
   task, with its own identity: an email alias, a low-limit virtual card, and
   never a saved login for my primary accounts. This is what lets it book,
   cancel and fill forms.
3. **The approval gate.** Reads execute immediately. Anything that leaves my
   accounts (send, book, pay, cancel, sign) writes an approval row and sends
   me Approve / Reject buttons. Nothing external happens until I tap, and
   approvals expire after 24 hours.
4. **Memory,** in Supabase: short facts I told it, open follow-ups, the audit
   log. Listed with `/memory`, emptied with `/forget`. No email bodies, ever.
5. **Untrusted-content wrapping.** Every email body, calendar note and web
   page reaches the model inside a labelled envelope with a standing rule
   that instructions inside it are reported, not followed. Tested with the
   exact experiment Alex Cohen ran against Instinct before anything is live.
6. **Audit log.** Every tool call, approval and message in one table. A
   phishing attempt shows up as a proposed action I never asked for, waiting
   for an approval I never give.

What makes this different from Instinct's machine, in one table:

| | Instinct's cloud computer | My server |
|---|---|---|
| Owner | Spear Street Technology | Me, on my card |
| Holds | An indexed copy of my inbox, plain text | OAuth tokens and short notes |
| Passwords | Cached for my real accounts | None for real accounts; the browser has its own identity |
| Acts | On its own judgement | After my tap |
| Disconnect | Data stays | `/forget` truncates, revoke kills the token at Google |
| Terms | Perpetual, irrevocable licence | None, it is my machine |

Build order: chat channel (Telegram first), Google OAuth in my own Google
Cloud project with scopes limited to Gmail read + draft + send, Calendar and
Drive read, then the agent loop with read-only tools, then the approval gate
and writes, then memory and proactive checks, then the browser sandbox last.

Cost: the server plus Claude API usage. A realistic personal load is 10 to
20 euro a month all in.

### Tier 2 - phone calls and more hands

- **Phone calls** to businesses via a telephony API with a voice model. Fun,
  lowest priority, every call transcribed into the audit log.
- **iMessage** is not reachable without an Apple device relay. Telegram or
  WhatsApp covers the same job.
- **Screen and audio from my own devices,** which Instinct also ingests, are
  deliberately out. That is the data class its terms licence forever, and
  none of the daily value depends on it.

## 6. Where every byte lives

| Data | Where | How long | Who can see it |
|---|---|---|---|
| Email, calendar, files | Google, as today | Google's retention | Google, me |
| Per-request slices sent to the model | Anthropic API, zero-retention | Not stored | Anthropic in transit only |
| OAuth tokens | My Supabase, encrypted | Until I disconnect | The service only |
| Memories, open loops | My Supabase | Until I `/forget` | Me, the service |
| Audit log | My Supabase | 90 days, then purged | Me |
| Chat history | Telegram + my Supabase | 30 days, then purged | Me, Telegram |
| Browser sessions | Throwaway container on my server | Deleted after the task | Nobody |

Nothing on that list is a copy of an account. Nothing is licensed to anyone.

## 7. What we will not match, honestly

- **iMessage and native phone calls** to me. Telegram push is the substitute.
- **A custom-trained model** for browser tasks specifically. Ours is a
  frontier model with good tooling, ahead on email and calendar work and
  behind on messy websites.

## 8. Roadmap

| Week | Deliverable | Done when |
|---|---|---|
| 1 | Tier 0 routines live | Morning brief arrives on my phone three days running |
| 2 | Server up, Telegram bot + Google OAuth + read-only tools | I can ask "what did I not reply to?" and get a correct answer |
| 3 | Approval gate + drafts + calendar writes + memory | A nudge email goes out only after I tap Approve; `/forget` empties the store |
| 4 | 24/7 proactive checks + audit log + injection test | Cohen's phishing experiment produces a flagged proposal, not an action |
| 5 | Sandboxed browser with its own identity | A restaurant booking end to end with screenshot approvals |
| Later | Tier 2 phone calls | A call transcript lands in the audit log |

## 9. Decisions to make before week 2

1. **Telegram or WhatsApp** for the chat channel. Telegram is faster to build
   and has better buttons. WhatsApp keeps everything on one app.
2. **Which Google account(s)** the assistant sees. Personal only, or work too.
3. **Which card and email alias** the browser identity gets. A virtual card
   with a small limit is the whole safety margin for booking and buying.

---

Sources for section 1 and 2: TechCrunch (24 Aug 2026), Captain Compliance,
Vellum's Instinct breakdown, CellCog, ecorpit's terms analysis, explainx.ai
on the Claire Vo disconnect incident, and DEV Community's write-up of the
unapproved email.

# Setup guide (no coding needed)

Total time: about an hour the first time. You need a phone with Telegram, a
laptop with a browser, and a card for the server.

There are five accounts to prepare, then one server to start. Everything you
collect goes into one file called `.env`. Copy `.env.example` to `.env` and fill
it in as you go.

---

## 1. Telegram bot (5 minutes)

1. In Telegram, open **@BotFather** and send `/newbot`.
2. Give it a name (for example "Aviv's assistant") and a username ending in `bot`.
3. BotFather replies with a token like `123456789:AAH...`. That is `TELEGRAM_BOT_TOKEN`.
4. Open **@userinfobot** and press Start. It shows your numeric id. That is `TELEGRAM_OWNER_ID`.

Only that id can talk to the bot. Anyone else is ignored and logged.

## 2. Anthropic API key (5 minutes)

1. Go to https://console.anthropic.com, create an API key.
2. That is `ANTHROPIC_API_KEY`.
3. Under Settings, check the data retention policy for your organisation. The
   plan calls for zero-retention where available. The model in use is
   `claude-opus-5`, which is the current recommended default and eligible for
   zero-retention arrangements.

## 3. Supabase (already done)

The assistant has its own Supabase project, **personal-assistant**, in
Frankfurt (eu-central-1), separate from anything else. The six tables are
already created and locked with row-level security.

1. Open https://supabase.com/dashboard and choose the project **personal-assistant**.
2. **Project Settings → API Keys**.
3. `Project URL` is `SUPABASE_URL`: https://ywvgmeqxdwprtwitsdig.supabase.co
4. `service_role` secret is `SUPABASE_SERVICE_ROLE_KEY`. This key only ever
   lives on your server, never in a browser or in Git.

If you ever want to start over, create a new project in the **Frankfurt (eu-central-1)**
region and paste the contents of `supabase/migrations/001_assistant_init.sql`
into the SQL editor.

## 4. Google OAuth client (15 minutes)

This is what lets the assistant read your Gmail and Calendar with a token you
can revoke, instead of a password.

1. Go to https://console.cloud.google.com and create a new project called
   "Personal assistant".
2. **APIs & Services → Library**: enable **Gmail API**, **Google Calendar API**,
   **Google Drive API**, and **People API** (the last one is for contacts).
3. **APIs & Services → OAuth consent screen**: choose External, fill in the app
   name and your email. Under **Test users**, add your own Gmail address.
   (Leave the app in "Testing"; you are the only user.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
   Application type: **Desktop app**. Name it anything.
5. Copy the **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`.

Scopes requested by the assistant, and nothing more: Gmail read, compose
(drafts), send; Calendar read and events; Drive read only; Contacts read only;
your email address.

If you already connected before contacts were added, send `/disconnect` and
then `/connect` once, so the new permission is included.

Note: apps in "Testing" mode have refresh tokens that expire after 7 days
unless you publish the app. Publishing an app that only you use is fine and
does not require Google review for these scopes as long as you keep it
unlisted. If you see "connection expired" after a week, publish the app in the
consent screen page and run `/connect` once more.

## 5. Encryption key (1 minute)

On any Mac or Linux terminal run:

    openssl rand -base64 32

Paste the output into `TOKEN_ENCRYPTION_KEY`. This encrypts your Google token
before it is stored. Lose it and you simply run `/connect` again.

---

## 6. The server (20 minutes)

1. Create a Hetzner Cloud account (https://www.hetzner.com/cloud), add a
   payment method.
2. Create a server: location **Falkenstein**, image **Ubuntu 24.04**, type
   **CX22** (about 4 euro a month). Under SSH keys, add your laptop's public
   key (on a Mac: `cat ~/.ssh/id_ed25519.pub`, create one with
   `ssh-keygen -t ed25519` if it is empty).
3. Note the server's IP address.

On your laptop, in a terminal:

    ssh root@YOUR_SERVER_IP

Then paste this one line. It installs everything, asks you for each value,
and starts the bot:

    curl -fsSL https://raw.githubusercontent.com/avivagami/personal-assistant/claude/ready-to-code-okjjiy/scripts/install.sh | bash

When it prints "Running", you are done. If you ever need to change a value,
run the same line again and answer "n" to keeping the existing settings.

Disk encryption: Hetzner does not encrypt disks by default. The only secrets on
this disk are the `.env` file and Docker images. Your Google token is stored
encrypted in Supabase, not on the server. If you want the extra layer, pick
"Encrypted" when creating the volume, or keep the server minimal as above.

---

## 7. First conversation

In Telegram, open your bot:

1. `/start`
2. `/connect` and follow the three steps. The last step is pasting a long
   `localhost` address back into the chat. That is normal.
3. Ask: **what did I not reply to?**

## Daily use

- Text it anything. Reads happen immediately.
- When it wants to send, draft, book or cancel, you get **Approve / Reject**
  buttons. Nothing happens until you tap Approve. Requests expire after 24 hours.
- Weekdays 07:30 it sends a morning brief. 17:00 it prepares nudge drafts for
  threads nobody answered, each one waiting for your tap.
- Every 15 minutes it glances at new mail and the next hour of calendar and
  texts you only if something matters.

## Commands

| Command | What it does |
|---|---|
| `/status` | What is connected, how many approvals are waiting |
| `/pending` | Re-sends every waiting approval with buttons |
| `/memory` | Everything it remembers |
| `/forget` | Erases memories and chat history (asks first) |
| `/disconnect` | Revokes the Google token at Google and deletes it |
| `/audit` | Last 20 actions |

## Updating

The server checks GitHub once an hour and rebuilds itself when there is a
new version. To turn that on (one time):

    ssh root@YOUR_SERVER_IP
    bash /opt/assistant/scripts/enable-auto-update.sh

To update right now instead of waiting:

    bash /opt/assistant/scripts/auto-update.sh

Update history is in `/var/log/assistant-update.log`.

## Turning it off

    docker compose down

Then `/disconnect` in Telegram (or remove the app at
https://myaccount.google.com/permissions) and, if you want, delete the
`assistant_*` tables in Supabase. That is everything.

-- Personal assistant: the only long-term storage.
-- No email bodies, no calendar copies. Tokens are encrypted by the app
-- before they reach this database.

create table if not exists assistant_oauth_tokens (
  provider      text primary key,            -- 'google'
  encrypted     text not null,               -- AES-256-GCM blob (refresh token + scopes)
  account_email text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists assistant_memories (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('fact', 'preference', 'followup')),
  content    text not null,
  due_at     timestamptz,                    -- for followups
  done_at    timestamptz,
  source     text not null default 'user',   -- who created it: 'user' or 'assistant'
  created_at timestamptz not null default now()
);
create index if not exists assistant_memories_open_idx
  on assistant_memories (kind, done_at) where done_at is null;

create table if not exists assistant_approvals (
  id           uuid primary key default gen_random_uuid(),
  action_type  text not null,                -- 'send_email', 'create_event', ...
  summary      text not null,                -- one line shown on the button
  payload      jsonb not null,               -- exact arguments that will run
  status       text not null default 'pending'
               check (status in ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  telegram_message_id bigint,
  result       text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  decided_at   timestamptz,
  executed_at  timestamptz
);
create index if not exists assistant_approvals_status_idx on assistant_approvals (status, expires_at);

create table if not exists assistant_audit_log (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  kind       text not null,                  -- 'message_in', 'message_out', 'tool_call', 'approval', 'action', 'proactive', 'error'
  actor      text not null,                  -- 'owner', 'assistant', 'system'
  detail     jsonb not null default '{}'::jsonb
);
create index if not exists assistant_audit_log_at_idx on assistant_audit_log (at);

create table if not exists assistant_chat_messages (
  id         bigint generated always as identity primary key,
  at         timestamptz not null default now(),
  role       text not null check (role in ('user', 'assistant')),
  content    text not null
);
create index if not exists assistant_chat_messages_at_idx on assistant_chat_messages (at);

-- Things the proactive checker has already told the owner about, so it never
-- repeats itself. Only ids, never content.
create table if not exists assistant_notified (
  key        text primary key,               -- e.g. 'gmail:<message id>' or 'cal:<event id>'
  at         timestamptz not null default now()
);

-- Lock the tables down. The service role bypasses RLS; nothing else gets in.
alter table assistant_oauth_tokens  enable row level security;
alter table assistant_memories      enable row level security;
alter table assistant_approvals     enable row level security;
alter table assistant_audit_log     enable row level security;
alter table assistant_chat_messages enable row level security;
alter table assistant_notified      enable row level security;

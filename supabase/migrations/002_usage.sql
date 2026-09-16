create table if not exists assistant_usage (
  id                 bigint generated always as identity primary key,
  at                 timestamptz not null default now(),
  model              text not null,
  purpose            text not null,
  requests           int not null,
  input_tokens       int not null,
  cache_write_tokens int not null,
  cache_read_tokens  int not null,
  output_tokens      int not null,
  usd                numeric(10,5) not null
);
create index if not exists assistant_usage_at_idx on assistant_usage (at);
alter table assistant_usage enable row level security;

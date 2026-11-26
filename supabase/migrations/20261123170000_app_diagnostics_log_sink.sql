create table if not exists public.app_diagnostics (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  client_id text not null check (char_length(client_id) between 16 and 64),
  platform text not null check (platform in ('web','android')),
  level text not null check (level in ('error','warn','info')),
  event text not null check (char_length(event) between 1 and 80),
  message text not null check (char_length(message) <= 1000),
  stack text not null default '' check (char_length(stack) <= 1600),
  app_version text not null default '' check (char_length(app_version) <= 32),
  app_commit text not null default '' check (char_length(app_commit) <= 40),
  page text not null default '' check (char_length(page) <= 180),
  user_agent text not null default '' check (char_length(user_agent) <= 240)
);
create index if not exists app_diagnostics_created_at_idx on public.app_diagnostics(created_at desc);
create index if not exists app_diagnostics_event_idx on public.app_diagnostics(event, created_at desc);
alter table public.app_diagnostics enable row level security;
revoke all on public.app_diagnostics from anon, authenticated;
grant all on public.app_diagnostics to service_role;

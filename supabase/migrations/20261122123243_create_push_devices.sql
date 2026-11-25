create table if not exists public.push_devices (
  token text primary key
    check (char_length(token) between 32 and 4096),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null default 'android'
    check (platform in ('android')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_devices_user_enabled_idx
  on public.push_devices (user_id, enabled);

alter table public.push_devices enable row level security;
revoke all on table public.push_devices from anon, authenticated;
grant all on table public.push_devices to service_role;

comment on table public.push_devices is
  'Tokens FCM por aparelho; acesso exclusivo ao service_role e Edge Functions.';

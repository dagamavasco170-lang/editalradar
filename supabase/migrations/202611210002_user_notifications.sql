-- Adiciona o histórico de notificações à sincronização por conta.
-- A política RLS existente em public.user_data continua protegendo esta coluna.
alter table public.user_data
  add column if not exists notifications jsonb not null default '[]'::jsonb;

comment on column public.user_data.notifications is
  'Histórico de notificações do EditalRadar, sincronizado entre dispositivos da mesma conta.';

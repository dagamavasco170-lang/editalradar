-- Dados pessoais do EditalRadar. Execute no SQL Editor do Supabase.
-- Cada conta só pode ler e modificar a própria linha.
create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  favorites integer[] not null default '{}',
  alerts jsonb not null default '[]'::jsonb,
  tasks jsonb not null default '[false, false, false, false]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

do $
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_data' and policyname='Users can read their own EditalRadar data') then
    create policy "Users can read their own EditalRadar data"
      on public.user_data for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_data' and policyname='Users can insert their own EditalRadar data') then
    create policy "Users can insert their own EditalRadar data"
      on public.user_data for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='user_data' and policyname='Users can update their own EditalRadar data') then
    create policy "Users can update their own EditalRadar data"
      on public.user_data for update to authenticated
      using ((select auth.uid()) = user_id)
      with check ((select auth.uid()) = user_id);
  end if;
end
$;

grant select, insert, update on public.user_data to authenticated;

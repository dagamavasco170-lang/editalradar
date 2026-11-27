-- Persiste o domínio estimado dos conceitos por conta autenticada.
-- O RLS existente em public.user_data continua restringindo cada linha ao próprio usuário.
alter table public.user_data
  add column if not exists concept_mastery jsonb not null default '{}'::jsonb;

alter table public.user_data
  drop constraint if exists user_data_concept_mastery_is_object;

alter table public.user_data
  add constraint user_data_concept_mastery_is_object
  check (jsonb_typeof(concept_mastery) = 'object');

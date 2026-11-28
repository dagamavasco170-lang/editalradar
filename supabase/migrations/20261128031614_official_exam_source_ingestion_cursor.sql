alter table public.study_exam_sources
  add column if not exists last_ingested_at timestamptz,
  add column if not exists last_ingested_run uuid references public.study_exam_ingestion_runs(id) on delete set null;

create index if not exists study_exam_sources_ingestion_cursor_idx
  on public.study_exam_sources(last_ingested_at asc nulls first, exam_year desc)
  where published = true;

grant select, update on public.study_exam_sources to service_role;

comment on column public.study_exam_sources.last_ingested_at is
  'Data da última verificação pelo worker oficial; permite distribuir os ciclos entre as fontes cadastradas.';
comment on column public.study_exam_sources.last_ingested_run is
  'Execução mais recente do worker que verificou esta fonte.';

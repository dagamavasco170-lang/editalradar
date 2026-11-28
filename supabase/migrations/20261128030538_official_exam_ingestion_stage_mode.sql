-- Permite pré-cadastro privado de questões sem publicação automática.
alter table public.study_exam_ingestion_runs
  drop constraint if exists study_exam_ingestion_runs_mode_check;

alter table public.study_exam_ingestion_runs
  add constraint study_exam_ingestion_runs_mode_check
    check (mode in ('dry-run','stage','publish'));

alter table public.study_exam_ingestion_runs
  add column if not exists staged_count integer not null default 0
    check (staged_count >= 0);

comment on column public.study_exam_ingestion_runs.staged_count is
  'Questões extraídas e gravadas em fila privada de revisão, sem publicação no banco público.';

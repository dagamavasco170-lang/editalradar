-- Índices para cobrir chaves estrangeiras e filtros recorrentes do catálogo de provas.
create index if not exists contest_discoveries_reviewed_by_idx on public.contest_discoveries(reviewed_by);
create index if not exists contest_discoveries_published_catalog_id_idx on public.contest_discoveries(published_catalog_id);
create index if not exists study_questions_created_by_idx on public.study_questions(created_by);
create index if not exists study_question_answers_created_by_idx on public.study_question_answers(created_by);
create index if not exists study_exam_sources_created_by_idx on public.study_exam_sources(created_by);

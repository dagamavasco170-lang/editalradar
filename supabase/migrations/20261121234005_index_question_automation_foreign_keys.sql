-- Índices para as novas chaves estrangeiras usadas pela automação de questões.
create index if not exists study_question_automation_runs_topic_id_idx
  on public.study_question_automation_runs(topic_id);

create index if not exists study_question_automation_topics_created_by_idx
  on public.study_question_automation_topics(created_by);

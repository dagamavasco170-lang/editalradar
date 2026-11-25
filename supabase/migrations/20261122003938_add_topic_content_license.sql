alter table public.study_question_automation_topics
  add column if not exists content_license text;

comment on column public.study_question_automation_topics.content_license is
  'License applied to generated content when source terms require share-alike.';

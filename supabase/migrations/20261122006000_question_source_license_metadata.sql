alter table public.study_question_automation_topics
  add column if not exists source_license text,
  add column if not exists source_attribution text;

alter table public.study_questions
  add column if not exists source_license text,
  add column if not exists source_attribution text,
  add column if not exists content_license text;

alter table public.study_question_automation_reviews
  add column if not exists source_license text,
  add column if not exists source_attribution text,
  add column if not exists content_license text;

comment on column public.study_question_automation_topics.source_license is
  'License or permission that governs reuse of the reference source.';
comment on column public.study_question_automation_topics.source_attribution is
  'Attribution text required by the reference source license.';
comment on column public.study_questions.source_license is
  'License/permission of the reference material used during generation.';
comment on column public.study_questions.source_attribution is
  'Required source credit for the material used to generate the question.';
comment on column public.study_questions.content_license is
  'License assigned to the generated question when source terms require share-alike.';
comment on column public.study_question_automation_reviews.source_license is
  'License/permission of the reviewed reference material.';
comment on column public.study_question_automation_reviews.source_attribution is
  'Required attribution for the reviewed source material.';
comment on column public.study_question_automation_reviews.content_license is
  'License assigned to the generated question when source terms require share-alike.';

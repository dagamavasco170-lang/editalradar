alter table public.study_question_automation_topics alter column source_excerpt drop not null;
alter table public.study_question_automation_topics drop constraint if exists study_question_automation_topics_source_excerpt_check;
alter table public.study_question_automation_topics add constraint study_question_automation_topics_source_excerpt_check check (source_excerpt is null or char_length(btrim(source_excerpt)) between 200 and 12000);

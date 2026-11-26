update public.study_question_automation_topics
set active = false, updated_at = now()
where split_part(regexp_replace(source_url, '^https://', ''), '/', 1) = 'escolhalivre.org.br'
   or split_part(regexp_replace(source_url, '^https://', ''), '/', 1) like '%.escolhalivre.org.br';

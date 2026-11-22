update public.study_question_automation_topics
set active = false, updated_at = now()
where not (
  split_part(regexp_replace(source_url, '^https://', ''), '/', 1) = 'politize.com.br'
  or split_part(regexp_replace(source_url, '^https://', ''), '/', 1) like '%.politize.com.br'
  or split_part(regexp_replace(source_url, '^https://', ''), '/', 1) = 'pt.wikibooks.org'
  or split_part(regexp_replace(source_url, '^https://', ''), '/', 1) = 'pt.wikipedia.org'
  or split_part(regexp_replace(source_url, '^https://', ''), '/', 1) = 'pt.wikiversity.org'
  or split_part(regexp_replace(source_url, '^https://', ''), '/', 1) = 'pt.wiktionary.org'
  or split_part(regexp_replace(source_url, '^https://', ''), '/', 1) = 'escolhalivre.org.br'
  or split_part(regexp_replace(source_url, '^https://', ''), '/', 1) like '%.escolhalivre.org.br'
);

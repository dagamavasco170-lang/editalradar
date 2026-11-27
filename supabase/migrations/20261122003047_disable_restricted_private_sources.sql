update public.study_question_automation_topics
set active = false, updated_at = now()
where split_part(regexp_replace(source_url, '^https://', ''), '/', 1) in (
  'jrconcursos.com.br',
  'www.jrconcursos.com.br',
  'pt.khanacademy.org',
  'khanacademy.org',
  'www.khanacademy.org',
  'www.jusbrasil.com.br',
  'jusbrasil.com.br',
  'www.tecconcursos.com.br',
  'tecconcursos.com.br',
  'www.qconcursos.com',
  'qconcursos.com',
  'blog.qconcursos.com'
);

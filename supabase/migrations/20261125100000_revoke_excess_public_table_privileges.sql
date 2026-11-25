-- Remove inherited table-maintenance privileges from client-facing roles in public.
-- RLS does not protect TRUNCATE, REFERENCES, or TRIGGER privileges.

-- Preserve the answer-key table as an admin-only data surface.
revoke all on table public.study_question_answers from anon, public;
revoke truncate, references, trigger on all tables in schema public from anon, authenticated, public;

-- Prevent future public-schema tables created by postgres from inheriting these privileges.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated, public;

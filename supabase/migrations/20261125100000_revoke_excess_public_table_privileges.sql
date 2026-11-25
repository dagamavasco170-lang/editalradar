-- Remove inherited table-maintenance privileges from client-facing roles in public.
-- RLS does not protect TRUNCATE, REFERENCES, or TRIGGER privileges.
revoke truncate, references, trigger on all tables in schema public from anon, authenticated, public;

-- Prevent future public-schema tables from inheriting these privileges from either
-- role commonly used to create migrations/objects in Supabase.
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated, public;
alter default privileges for role supabase_admin in schema public
  revoke truncate, references, trigger on tables from anon, authenticated, public;

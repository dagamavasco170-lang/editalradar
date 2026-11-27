-- PostgreSQL 17 MAINTAIN is a table maintenance privilege; revoke it from API client roles.
revoke maintain on all tables in schema public from anon, authenticated, public;

-- Revoke future MAINTAIN defaults for objects created by postgres.
-- Altering supabase_admin's default ACL is not permitted to the migration runner
-- in the local Supabase replay environment; its defaults are managed by Supabase.
alter default privileges for role postgres in schema public
  revoke maintain on tables from anon, authenticated, public;

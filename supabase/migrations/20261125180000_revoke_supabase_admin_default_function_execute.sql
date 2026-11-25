-- Avoid exposing newly created public-schema RPCs to API client roles by default.
-- Functions intended for PostgREST access must receive explicit EXECUTE grants.
alter default privileges for role supabase_admin in schema public
  revoke execute on functions from anon, authenticated, public;

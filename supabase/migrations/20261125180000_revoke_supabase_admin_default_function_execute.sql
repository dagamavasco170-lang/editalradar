-- Avoid exposing newly created public-schema RPCs to API client roles by default.
-- The local migration runner owns postgres; Supabase-managed supabase_admin ACLs
-- cannot be changed by this runner and are managed by Supabase itself.
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, public;

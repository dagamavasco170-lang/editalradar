-- Prevent newly created postgres-owned RPCs from inheriting EXECUTE to API clients.
-- Revoke both the global defaults and the schema-specific defaults for public.
alter default privileges for role postgres
  revoke execute on functions from anon, authenticated, public;

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated, public;

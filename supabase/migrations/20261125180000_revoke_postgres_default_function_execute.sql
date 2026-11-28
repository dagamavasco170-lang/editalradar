-- Remove PostgreSQL's default PUBLIC EXECUTE grant for functions created by postgres.
-- Schema-scoped REVOKE cannot remove the global default function privilege.
alter default privileges for role postgres
  revoke execute on functions from anon, authenticated, public;

-- Keep the PGMQ extension's management and queue operations inaccessible to API client roles.
-- SECURITY DEFINER worker RPCs execute as their owner and retain owner privileges.
revoke execute on all functions in schema pgmq from anon, authenticated, public;

-- Prevent future PGMQ functions created by postgres from inheriting PUBLIC/client EXECUTE.
alter default privileges for role postgres in schema pgmq
  revoke execute on functions from anon, authenticated, public;

begin;

select plan(8);

select ok(
  (select relrowsecurity from pg_class where oid = 'private.diagnostics_ingest_rate_limits'::regclass),
  'diagnostics rate-limit buckets have RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'private.diagnostics_ingest_rate_limits', 'SELECT')
  and not has_table_privilege('authenticated', 'private.diagnostics_ingest_rate_limits', 'SELECT')
  and not has_table_privilege('service_role', 'private.diagnostics_ingest_rate_limits', 'SELECT'),
  'rate-limit buckets are not directly readable by API roles'
);
select ok(
  not has_function_privilege('anon', 'public.consume_diagnostics_ingest_rate_limit(integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.consume_diagnostics_ingest_rate_limit(integer,integer)', 'EXECUTE'),
  'only the service role can execute the rate limiter'
);
select ok(
  has_function_privilege('service_role', 'public.consume_diagnostics_ingest_rate_limit(integer,integer)', 'EXECUTE'),
  'service role can execute the rate limiter'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.consume_diagnostics_ingest_rate_limit(integer,integer)'::regprocedure),
  'rate limiter is SECURITY DEFINER'
);
select ok(
  (select proconfig @> array['search_path=""']::text[] from pg_proc where oid = 'public.consume_diagnostics_ingest_rate_limit(integer,integer)'::regprocedure),
  'rate limiter pins an empty search_path'
);

select ok(
  public.consume_diagnostics_ingest_rate_limit(2, 5),
  'first batch is accepted within the atomic minute budget'
);
select ok(
  public.consume_diagnostics_ingest_rate_limit(2, 5)
  and not public.consume_diagnostics_ingest_rate_limit(2, 5),
  'concurrent-safe counter refuses a batch that would exceed the minute budget'
);

select * from finish();
rollback;

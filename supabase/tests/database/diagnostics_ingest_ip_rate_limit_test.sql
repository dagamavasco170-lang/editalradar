begin;

select plan(8);

select ok(
  (select relrowsecurity from pg_class where oid = 'private.diagnostics_ingest_ip_rate_limits'::regclass),
  'per-IP buckets have RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'private.diagnostics_ingest_ip_rate_limits', 'SELECT')
  and not has_table_privilege('authenticated', 'private.diagnostics_ingest_ip_rate_limits', 'SELECT')
  and not has_table_privilege('service_role', 'private.diagnostics_ingest_ip_rate_limits', 'SELECT'),
  'API roles cannot read per-IP buckets directly'
);
select ok(
  not has_function_privilege('anon', 'public.consume_diagnostics_ingest_ip_rate_limit(text,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.consume_diagnostics_ingest_ip_rate_limit(text,integer,integer)', 'EXECUTE'),
  'anon and authenticated cannot execute per-IP limiter'
);
select ok(
  has_function_privilege('service_role', 'public.consume_diagnostics_ingest_ip_rate_limit(text,integer,integer)', 'EXECUTE'),
  'service role can execute per-IP limiter'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.consume_diagnostics_ingest_ip_rate_limit(text,integer,integer)'::regprocedure),
  'per-IP limiter is SECURITY DEFINER'
);
select ok(
  (select proconfig @> array['search_path=""']::text[] from pg_proc where oid = 'public.consume_diagnostics_ingest_ip_rate_limit(text,integer,integer)'::regprocedure),
  'per-IP limiter pins an empty search_path'
);
select ok(
  public.consume_diagnostics_ingest_ip_rate_limit(repeat('a', 64), 3, 5),
  'first per-IP batch is accepted'
);
select ok(
  public.consume_diagnostics_ingest_ip_rate_limit(repeat('a', 64), 2, 5)
  and not public.consume_diagnostics_ingest_ip_rate_limit(repeat('a', 64), 1, 5),
  'per-IP bucket rejects a batch exceeding its atomic quota'
);

select * from finish();
rollback;

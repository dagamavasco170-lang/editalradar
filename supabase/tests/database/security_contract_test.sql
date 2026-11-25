-- Security contract checks for the study answer key and official exam sources.
-- Catalog-only assertions: no production data is read or modified.
begin;

select plan(24);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.study_question_answers'::regclass),
  'study_question_answers has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.study_exam_sources'::regclass),
  'study_exam_sources has RLS enabled'
);
select ok(
  not has_function_privilege('anon', 'public.check_study_question_answer(bigint,text)', 'EXECUTE'),
  'anon cannot execute answer-check RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.check_study_question_answer(bigint,text)', 'EXECUTE'),
  'authenticated can execute answer-check RPC'
);
select ok(
  not has_table_privilege('anon', 'public.study_question_answers', 'SELECT'),
  'anon has no direct SELECT privilege on answer table'
);
select ok(
  has_table_privilege('authenticated', 'public.study_question_answers', 'SELECT'),
  'authenticated has table-level SELECT privilege (RLS must restrict rows)'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'study_question_answers'
      and policyname = 'Admins can manage study question answers'
      and roles @> array['authenticated']::name[]
  ),
  'answer table admin policy exists for authenticated'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'study_exam_sources'
      and policyname = 'Read published exam sources or admin review'
      and cmd = 'SELECT'
  ),
  'public exam-source read policy exists'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'study_exam_sources'
      and policyname in (
        'Admins can insert official exam sources',
        'Admins can update official exam sources',
        'Admins can delete official exam sources'
      )
      and roles @> array['authenticated']::name[]
    group by schemaname, tablename
    having count(distinct policyname) = 3
  ),
  'admin management policy exists for exam sources'
);
select ok(
  (select prosecdef from pg_proc where oid = 'public.check_study_question_answer(bigint,text)'::regprocedure),
  'answer-check RPC is SECURITY DEFINER'
);
select ok(
  exists (
    select 1 from pg_proc
    where oid = 'public.check_study_question_answer(bigint,text)'::regprocedure
      and (
        proconfig @> array['search_path=pg_catalog, public']::text[]
        or proconfig @> array['search_path=""']::text[]
      )
  ),
  'answer-check RPC pins search_path or disables implicit schema lookup'
);
select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where p.oid = 'public.check_study_question_answer(bigint,text)'::regprocedure
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'RPC is not executable by anon through inherited grants'
);
select ok(
  position('AUTH.UID() IS NOT NULL' in upper(pg_get_functiondef('public.check_study_question_answer(bigint,text)'::regprocedure))) > 0,
  'answer-check RPC requires an authenticated user'
);
select ok(
  position('license_status' in pg_get_functiondef('public.check_study_question_answer(bigint,text)'::regprocedure)) > 0
  and position('published' in pg_get_functiondef('public.check_study_question_answer(bigint,text)'::regprocedure)) > 0,
  'answer-check RPC filters to published and licensed questions'
);
select ok(
  position('license_proof_url' in lower(pg_get_functiondef('public.check_study_question_answer(bigint,text)'::regprocedure))) > 0,
  'answer-check RPC requires license proof for non-public-domain sources'
);
select ok(
  position('original_content' in lower(pg_get_functiondef('public.check_study_question_answer(bigint,text)'::regprocedure))) > 0
  and position('review_status' in lower(pg_get_functiondef('public.check_study_question_answer(bigint,text)'::regprocedure))) > 0,
  'answer-check RPC only allows reviewed original AI content'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'study_questions'
      and policyname = 'Read published licensed questions or admin review'
      and cmd = 'SELECT'
      and position('license_proof_url' in lower(qual)) > 0
      and position('review_status' in lower(qual)) > 0
  ),
  'public question SELECT policy enforces proof and reviewed-AI eligibility'
);
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'study_questions'
      and policyname = 'Admins can insert study questions'
      and cmd = 'INSERT'
      and position('created_by' in lower(with_check)) > 0
      and position('auth.uid()' in lower(with_check)) > 0
      and position('app_metadata' in lower(with_check)) > 0
  ),
  'question insertion requires admin app_metadata and creator identity'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'study_questions'
      and column_name = 'answer'
  ),
  'answer is not stored on the public study_questions table'
);

select ok(
  not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and (
        has_table_privilege('anon', c.oid, 'TRUNCATE')
        or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
        or has_table_privilege('anon', c.oid, 'REFERENCES')
        or has_table_privilege('authenticated', c.oid, 'REFERENCES')
        or has_table_privilege('anon', c.oid, 'TRIGGER')
        or has_table_privilege('authenticated', c.oid, 'TRIGGER')
      )
  ),
  'client roles have no destructive or maintenance table privileges in public'
);
select ok(
  not exists (
    select 1
    from pg_default_acl d
    cross join lateral aclexplode(d.defaclacl) a
    join pg_namespace n on n.oid = d.defaclnamespace
    where n.nspname = 'public'
      and d.defaclobjtype = 'r'
      and d.defaclrole = 'postgres'::regrole
      and (a.grantee in ('anon'::regrole, 'authenticated'::regrole) or a.grantee = 0)
      and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')
  ),
  'postgres does not default-grant maintenance privileges to client roles'
);

select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.oid in (
        'public.enqueue_push_delivery(jsonb,integer)'::regprocedure,
        'public.enqueue_push_deliveries(jsonb[],integer)'::regprocedure,
        'public.read_push_delivery_retries(integer,integer)'::regprocedure,
        'public.ack_push_delivery_retry(bigint)'::regprocedure,
        'public.reschedule_push_delivery_retry(bigint,jsonb,integer)'::regprocedure,
        'public.fail_push_delivery_retry(bigint,text,text,integer)'::regprocedure,
        'public.verify_push_queue_worker_token(text)'::regprocedure
      )
      and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  ),
  'push queue SECURITY DEFINER RPCs are not executable by client roles'
);
select ok(
  not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.oid in (
        'public.check_study_question_answer(bigint,text)'::regprocedure,
        'public.enqueue_push_delivery(jsonb,integer)'::regprocedure,
        'public.enqueue_push_deliveries(jsonb[],integer)'::regprocedure,
        'public.read_push_delivery_retries(integer,integer)'::regprocedure,
        'public.ack_push_delivery_retry(bigint)'::regprocedure,
        'public.reschedule_push_delivery_retry(bigint,jsonb,integer)'::regprocedure,
        'public.fail_push_delivery_retry(bigint,text,text,integer)'::regprocedure,
        'public.verify_push_queue_worker_token(text)'::regprocedure
      )
      and not (p.proconfig @> array['search_path=""']::text[])
  ),
  'audited SECURITY DEFINER functions disable implicit search_path lookup'
);
select ok(
  not exists (
    select 1 from pg_proc p
    where p.oid = 'public.check_study_question_answer(bigint,text)'::regprocedure
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  )
  and has_function_privilege('authenticated', 'public.check_study_question_answer(bigint,text)', 'EXECUTE'),
  'answer-check RPC grants execute only to authenticated among client roles'
);

select * from finish();
rollback;

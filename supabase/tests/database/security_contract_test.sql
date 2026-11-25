-- Security contract checks for the study answer key and official exam sources.
-- Catalog-only assertions: no production data is read or modified.
begin;

select plan(15);

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
  not has_column('public', 'study_questions', 'answer'),
  'answer is not stored on the public study_questions table'
);

select * from finish();
rollback;

-- Mutation/authorization behavior for question and answer RLS.
-- Runs only in the local Supabase test database; all fixture changes roll back.
begin;

select plan(9);

insert into public.study_questions
  (discipline,topic,difficulty,board,exam_name,exam_year,prompt,options,explanation,source_url,rights_holder,license_status,license_proof_url,published,origin,review_status)
values
  ('Segurança','Mutation RLS','Fácil','Fixture','ER RLS MUTATION fixture',2026,
   'Prompt used only by transactional RLS tests','["A","B"]'::jsonb,'Fixture explanation',
   'https://example.com/fixture','Fixture','public_domain',null,false,'manual','not_required');

insert into public.study_question_answers (question_id,answer,explanation)
select id,'A','Fixture answer' from public.study_questions
where exam_name='ER RLS MUTATION fixture';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","app_metadata":{}}';

select is(
  (select count(*) from public.study_questions where exam_name='ER RLS MUTATION fixture'),
  0::bigint,
  'non-admin cannot read unpublished fixture'
);

update public.study_questions set prompt='Unauthorized mutation'
where exam_name='ER RLS MUTATION fixture';
select is(
  (select prompt from public.study_questions where exam_name='ER RLS MUTATION fixture'),
  'Prompt used only by transactional RLS tests',
  'non-admin UPDATE is blocked by RLS'
);

delete from public.study_questions where exam_name='ER RLS MUTATION fixture';
select is(
  (select count(*) from public.study_questions where exam_name='ER RLS MUTATION fixture'),
  1::bigint,
  'non-admin DELETE is blocked by RLS'
);

select throws_ok(
  $$insert into public.study_questions
    (discipline,topic,difficulty,board,exam_name,exam_year,prompt,options,explanation,source_url,rights_holder,license_status,published,origin,review_status,created_by)
    values ('Segurança','Mutation RLS','Fácil','Fixture','ER RLS MUTATION unauthorized insert',2026,
    'Prompt for unauthorized insert','["A","B"]'::jsonb,'Fixture explanation',
    'https://example.com/fixture','Fixture','public_domain',false,'manual','not_required',
    '11111111-1111-1111-1111-111111111111')$$,
  '42501',
  'non-admin INSERT is rejected by policy'
);

delete from public.study_question_answers
where question_id in (select id from public.study_questions where exam_name='ER RLS MUTATION fixture');
select is(
  (select count(*) from public.study_question_answers a join public.study_questions q on q.id=a.question_id where q.exam_name='ER RLS MUTATION fixture'),
  1::bigint,
  'non-admin cannot DELETE answer row'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated","app_metadata":{"role":"admin"}}';

select is(
  (select count(*) from public.study_questions where exam_name='ER RLS MUTATION fixture'),
  1::bigint,
  'admin can read unpublished fixture'
);
delete from public.study_questions where exam_name='ER RLS MUTATION fixture';
select is(
  (select count(*) from public.study_questions where exam_name='ER RLS MUTATION fixture'),
  0::bigint,
  'admin can delete fixture question'
);
select is(
  (select count(*) from public.study_question_answers a join public.study_questions q on q.id=a.question_id where q.exam_name='ER RLS MUTATION fixture'),
  0::bigint,
  'admin delete cascades fixture answer row'
);

reset role;
select is(
  (select count(*) from public.study_questions where exam_name='ER RLS MUTATION fixture'),
  0::bigint,
  'fixture cleanup confirmed before transaction rollback'
);

select * from finish();
rollback;

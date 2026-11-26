-- Optimize admin claim evaluation in policies, resolving claims once per statement.
drop policy if exists "Admins can insert catalog records" on public.contest_catalog;
create policy "Admins can insert catalog records" on public.contest_catalog
  for insert to authenticated
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');
drop policy if exists "Admins can update catalog records" on public.contest_catalog;
create policy "Admins can update catalog records" on public.contest_catalog
  for update to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin')
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');
drop policy if exists "Admins can delete catalog records" on public.contest_catalog;
create policy "Admins can delete catalog records" on public.contest_catalog
  for delete to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');

drop policy if exists "Admins can read contest discoveries" on public.contest_discoveries;
create policy "Admins can read contest discoveries" on public.contest_discoveries
  for select to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');
drop policy if exists "Admins can review contest discoveries" on public.contest_discoveries;
create policy "Admins can review contest discoveries" on public.contest_discoveries
  for update to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin')
  with check (
    coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin'
    and status in ('pending','published','dismissed')
  );

drop policy if exists "Admins can read all study questions" on public.study_questions;
create policy "Admins can read all study questions" on public.study_questions
  for select to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');
drop policy if exists "Admins can insert study questions" on public.study_questions;
create policy "Admins can insert study questions" on public.study_questions
  for insert to authenticated
  with check (
    coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin'
    and created_by = (select auth.uid())
  );
drop policy if exists "Admins can update study questions" on public.study_questions;
create policy "Admins can update study questions" on public.study_questions
  for update to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin')
  with check (
    coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin'
    and created_by = (select auth.uid())
  );
drop policy if exists "Admins can delete study questions" on public.study_questions;
create policy "Admins can delete study questions" on public.study_questions
  for delete to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');

drop policy if exists "Admins can manage study question answers" on public.study_question_answers;
create policy "Admins can manage study question answers" on public.study_question_answers
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin')
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');

drop policy if exists "Admins can manage official exam sources" on public.study_exam_sources;
create policy "Admins can manage official exam sources" on public.study_exam_sources
  for all to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin')
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');

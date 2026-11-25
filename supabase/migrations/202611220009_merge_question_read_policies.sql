-- Combine published and administrative SELECT paths to avoid duplicate permissive policies.
drop policy if exists "Admins can read all study questions" on public.study_questions;
drop policy if exists "Public can read licensed published questions" on public.study_questions;
create policy "Read published licensed questions or admin review"
  on public.study_questions for select to anon, authenticated
  using (
    (
      published = true and (
        (
          license_status in ('permission_granted','public_domain','cc_by','cc_by_sa')
          and (license_status = 'public_domain' or license_proof_url is not null)
        )
        or (
          license_status = 'original_content'
          and origin = 'ai_generated'
          and review_status in ('auto_approved','admin_approved')
        )
      )
    )
    or coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin'
  );

drop policy if exists "Public can read official exam sources" on public.study_exam_sources;
drop policy if exists "Admins can manage official exam sources" on public.study_exam_sources;
create policy "Read published exam sources or admin review"
  on public.study_exam_sources for select to anon, authenticated
  using (
    published = true
    or coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin'
  );

drop policy if exists "Admins can insert official exam sources" on public.study_exam_sources;
create policy "Admins can insert official exam sources"
  on public.study_exam_sources for insert to authenticated
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');
drop policy if exists "Admins can update official exam sources" on public.study_exam_sources;
create policy "Admins can update official exam sources"
  on public.study_exam_sources for update to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin')
  with check (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');
drop policy if exists "Admins can delete official exam sources" on public.study_exam_sources;
create policy "Admins can delete official exam sources"
  on public.study_exam_sources for delete to authenticated
  using (coalesce(((select auth.jwt()) -> 'app_metadata' ->> 'role'), '') = 'admin');

drop index if exists public.study_exam_sources_discipline_year_idx;

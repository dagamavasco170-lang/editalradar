-- Revisão explícita de direitos antes de extrair/republicar enunciados de provas.
-- Fontes existentes ficam em link_only; publicação oficial não é licença presumida.
alter table public.study_exam_sources
  add column if not exists question_reuse_status text not null default 'link_only',
  add column if not exists question_reuse_basis text,
  add column if not exists question_reuse_proof_url text,
  add column if not exists question_reuse_terms_url text,
  add column if not exists question_reuse_rights_holder text,
  add column if not exists question_reuse_restrictions text not null default '',
  add column if not exists question_reuse_review_notes text not null default '',
  add column if not exists question_reuse_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists question_reuse_reviewed_at timestamptz;

alter table public.study_exam_sources
  drop constraint if exists study_exam_sources_question_reuse_status_check,
  drop constraint if exists study_exam_sources_question_reuse_basis_check,
  drop constraint if exists study_exam_sources_question_reuse_proof_url_check,
  drop constraint if exists study_exam_sources_question_reuse_terms_url_check,
  drop constraint if exists study_exam_sources_question_reuse_approved_check;

alter table public.study_exam_sources
  add constraint study_exam_sources_question_reuse_status_check
    check (question_reuse_status in ('link_only','not_reviewed','approved','rejected')),
  add constraint study_exam_sources_question_reuse_basis_check
    check (question_reuse_basis is null or question_reuse_basis in (
      'permission_granted','public_domain','cc_by','cc_by_sa','official_publication'
    )),
  add constraint study_exam_sources_question_reuse_proof_url_check
    check (question_reuse_proof_url is null or question_reuse_proof_url ~ '^https://'),
  add constraint study_exam_sources_question_reuse_terms_url_check
    check (question_reuse_terms_url is null or question_reuse_terms_url ~ '^https://'),
  add constraint study_exam_sources_question_reuse_approved_check
    check (question_reuse_status <> 'approved' or (
      question_reuse_basis is not null
      and question_reuse_reviewed_by is not null
      and question_reuse_reviewed_at is not null
      and (question_reuse_proof_url is not null or question_reuse_terms_url is not null)
    ));

drop policy if exists "Read published official exam sources" on public.study_exam_sources;
create policy "Read published official exam sources"
  on public.study_exam_sources for select to anon, authenticated
  using (published = true);

drop policy if exists "Admins manage official exam sources" on public.study_exam_sources;
create policy "Admins manage official exam sources"
  on public.study_exam_sources for all to authenticated
  using (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin')
  with check (coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), '') = 'admin');

grant select on public.study_exam_sources to anon, authenticated, service_role;

comment on column public.study_exam_sources.question_reuse_status is
  'Link-only por padrão. Somente approved autoriza ingestão de enunciados, após revisão humana documentada.';
comment on column public.study_exam_sources.question_reuse_proof_url is
  'URL HTTPS de licença, autorização ou evidência jurídica específica que permita reutilizar os enunciados.';
comment on column public.study_exam_sources.question_reuse_terms_url is
  'URL HTTPS dos termos oficiais aplicáveis ao uso e à reprodução da prova.';

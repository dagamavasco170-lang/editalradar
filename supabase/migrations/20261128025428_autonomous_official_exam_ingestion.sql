-- Pipeline autônomo de ingestão e autopublicação de provas oficiais.
-- Esta migration só cria o contrato do worker; nunca deve ser aplicada pelo CI à produção.
-- A autopublicação exige service_role, gabarito definitivo documentado e validação automática integral.

create table if not exists public.study_exam_ingestion_runs (
  id uuid primary key,
  mode text not null check (mode in ('dry-run','publish')),
  status text not null default 'running'
    check (status in ('running','completed','partial','failed')),
  sources_checked integer not null default 0 check (sources_checked >= 0),
  documents_checked integer not null default 0 check (documents_checked >= 0),
  questions_extracted integer not null default 0 check (questions_extracted >= 0),
  published_count integer not null default 0 check (published_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  quarantined_count integer not null default 0 check (quarantined_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  report jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint study_exam_ingestion_runs_completion_check
    check ((status = 'running' and completed_at is null) or (status <> 'running' and completed_at is not null))
);

create index if not exists study_exam_ingestion_runs_started_idx
  on public.study_exam_ingestion_runs(started_at desc);

alter table public.study_exam_ingestion_runs enable row level security;
revoke all on public.study_exam_ingestion_runs from public, anon, authenticated;
grant select, insert, update on public.study_exam_ingestion_runs to service_role;

alter table public.study_exam_question_imports
  alter column created_by drop not null;

alter table public.study_exam_question_imports
  add column if not exists gabarito_source_url text,
  add column if not exists gabarito_document_sha256 text,
  add column if not exists auto_validation_score integer,
  add column if not exists auto_validation_evidence jsonb,
  add column if not exists auto_reviewed_at timestamptz,
  add column if not exists automation_run_id uuid references public.study_exam_ingestion_runs(id) on delete set null;

alter table public.study_exam_question_imports
  drop constraint if exists study_exam_question_imports_status_check,
  drop constraint if exists study_exam_question_imports_published_review_check,
  drop constraint if exists study_exam_question_imports_gabarito_sha_check,
  drop constraint if exists study_exam_question_imports_auto_score_check,
  drop constraint if exists study_exam_question_imports_auto_evidence_check;

alter table public.study_exam_question_imports
  add constraint study_exam_question_imports_status_check
    check (status in ('pending','published','rejected','duplicate','quarantined')),
  add constraint study_exam_question_imports_gabarito_sha_check
    check (gabarito_document_sha256 is null or gabarito_document_sha256 ~ '^[0-9a-f]{64}$'),
  add constraint study_exam_question_imports_gabarito_url_check
    check (gabarito_source_url is null or gabarito_source_url ~ '^https://'),
  add constraint study_exam_question_imports_auto_score_check
    check (auto_validation_score is null or auto_validation_score between 0 and 100),
  add constraint study_exam_question_imports_auto_evidence_check
    check (auto_validation_evidence is null or jsonb_typeof(auto_validation_evidence) = 'object'),
  add constraint study_exam_question_imports_published_review_check
    check (status <> 'published' or (
      rights_review_status = 'accepted'
      and reviewed_at is not null
      and published_question_id is not null
      and (
        (reviewed_by is not null)
        or (
          reviewed_by is null
          and automation_run_id is not null
          and auto_reviewed_at is not null
          and auto_validation_score = 100
          and gabarito_source_url is not null
          and gabarito_document_sha256 is not null
        )
      )
    ));

create index if not exists study_exam_question_imports_automation_run_idx
  on public.study_exam_question_imports(automation_run_id, status)
  where automation_run_id is not null;

grant select, insert, update on public.study_exam_question_imports to service_role;
grant usage, select on sequence public.study_exam_question_imports_id_seq to service_role;
grant select, insert, update on public.study_questions, public.study_question_answers to service_role;
grant usage, select on sequence public.study_questions_id_seq to service_role;

comment on table public.study_exam_ingestion_runs is
  'Auditoria de cada ciclo do importador autônomo de provas e gabaritos oficiais.';
comment on column public.study_exam_question_imports.auto_validation_evidence is
  'Evidências determinísticas do PDF da prova, gabarito definitivo, parser, cobertura e validações que permitiram autopublicação.';
comment on column public.study_exam_question_imports.automation_run_id is
  'Execução autônoma que originou a importação; obrigatório para autopublicação sem usuário revisor.';

create or replace function public.publish_study_exam_question_import_automated(
  p_import_id bigint,
  p_answer text,
  p_explanation text default '',
  p_run_id uuid default null
)
returns bigint
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_import public.study_exam_question_imports%rowtype;
  v_question_id bigint;
  v_now timestamptz := now();
  v_answer text := upper(btrim(coalesce(p_answer, '')));
  v_evidence jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception 'Somente a automação de servidor pode autopublicar questões.'
      using errcode = '42501';
  end if;

  if p_run_id is null then
    raise exception 'A execução de auditoria é obrigatória para autopublicação.'
      using errcode = '22023';
  end if;

  select *
    into v_import
    from public.study_exam_question_imports
   where id = p_import_id
     and status = 'pending'
   for update;

  if not found then
    raise exception 'Importação inexistente ou já processada.'
      using errcode = 'P0002';
  end if;

  if v_import.automation_run_id is distinct from p_run_id
     or not exists (
       select 1 from public.study_exam_ingestion_runs r
        where r.id = p_run_id and r.mode = 'publish' and r.status = 'running'
     ) then
    raise exception 'Execução de automação não corresponde ao manifesto pendente.'
      using errcode = '22023';
  end if;

  if v_import.rights_basis <> 'official_publication'
     or v_import.official_release_verified is not true
     or v_import.rights_review_status <> 'accepted'
     or v_import.source_url !~ '^https://'
     or v_import.exam_pdf_url !~ '^https://'
     or v_import.gabarito_source_url !~ '^https://'
     or v_import.source_document_sha256 !~ '^[0-9a-f]{64}$'
     or v_import.gabarito_document_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Proveniência oficial e hashes da prova/gabarito são obrigatórios.'
      using errcode = '22023';
  end if;

  if v_import.auto_validation_score is distinct from 100
     or v_import.auto_reviewed_at is null
     or v_import.auto_validation_evidence is null then
    raise exception 'A questão não passou por todos os gates automáticos.'
      using errcode = '22023';
  end if;

  v_evidence := v_import.auto_validation_evidence -> 'checks';
  if coalesce(v_evidence ->> 'completePrompt', 'false') <> 'true'
     or coalesce(v_evidence ->> 'optionsValid', 'false') <> 'true'
     or coalesce(v_evidence ->> 'answerKeyMatches', 'false') <> 'true'
     or coalesce(v_evidence ->> 'parserTextOnly', 'false') <> 'true'
     or coalesce(v_evidence ->> 'noVisualDependency', 'false') <> 'true'
     or coalesce(v_import.auto_validation_evidence ->> 'answerKeyType', '') <> 'official_final'
     or coalesce(v_import.auto_validation_evidence ->> 'sourceHostValidated', 'false') <> 'true'
     or v_import.auto_validation_evidence ->> 'proofUrl' is distinct from v_import.exam_pdf_url
     or v_import.auto_validation_evidence ->> 'answerKeyUrl' is distinct from v_import.gabarito_source_url
     or v_import.auto_validation_evidence ->> 'proofSha256' is distinct from v_import.source_document_sha256
     or v_import.auto_validation_evidence ->> 'answerKeySha256' is distinct from v_import.gabarito_document_sha256
     or coalesce((v_import.auto_validation_evidence ->> 'gabaritoCoverage')::numeric, 0) < 1.0 then
    raise exception 'Evidências automáticas incompletas ou inconsistentes.'
      using errcode = '22023';
  end if;

  if char_length(coalesce(p_explanation, '')) > 5000 then
    raise exception 'Explicação excede o limite permitido.'
      using errcode = '22023';
  end if;

  if lower(coalesce(v_import.suggested_answer, '')) <> lower(v_answer) then
    raise exception 'A resposta não corresponde à extração do gabarito oficial validado.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
      from jsonb_array_elements(v_import.options) as option_row(value)
     where lower(coalesce(option_row.value ->> 'id', '')) = lower(v_answer)
  ) then
    raise exception 'O gabarito definitivo não corresponde a uma alternativa da questão.'
      using errcode = '22023';
  end if;

  insert into public.study_questions (
    exam_name, exam_year, board, discipline, topic, difficulty,
    prompt, options, source_url, rights_holder, license_status,
    license_proof_url, source_license, source_attribution, rights_basis,
    source_document_sha256, source_page, source_question_number, source_fingerprint,
    origin, review_status, reviewed_at, published, created_by
  ) values (
    v_import.exam_name, v_import.exam_year, v_import.board, v_import.discipline,
    v_import.topic, v_import.difficulty, v_import.prompt, v_import.options,
    v_import.exam_pdf_url, coalesce(nullif(btrim(v_import.rights_holder), ''), v_import.board),
    'official_publication', null, v_import.source_license, v_import.source_attribution,
    'official_publication', v_import.source_document_sha256, v_import.source_page,
    v_import.source_question_number, v_import.fingerprint,
    'exam_import', 'auto_approved', v_now, false, null
  )
  on conflict do nothing
  returning id into v_question_id;

  if v_question_id is null then
    update public.study_exam_question_imports
       set status = 'duplicate',
           reviewed_at = v_now,
           auto_reviewed_at = v_now,
           review_notes = left('Duplicata detectada por hash/fingerprint durante a publicação autônoma.', 4000),
           updated_at = v_now
     where id = v_import.id;
    return null;
  end if;

  insert into public.study_question_answers (question_id, answer, explanation, created_by)
  values (
    v_question_id,
    lower(v_answer),
    coalesce(nullif(btrim(p_explanation), ''), 'Gabarito definitivo publicado pela banca: ' || v_import.gabarito_source_url),
    null
  );

  update public.study_questions
     set published = true,
         updated_at = v_now
   where id = v_question_id;

  update public.study_exam_question_imports
     set status = 'published',
         rights_review_status = 'accepted',
         reviewed_by = null,
         reviewed_at = v_now,
         auto_reviewed_at = v_now,
         published_question_id = v_question_id,
         review_notes = left('Autopublicada após validação determinística e conferência do gabarito definitivo oficial.', 4000),
         updated_at = v_now
   where id = v_import.id;

  return v_question_id;
end;
$$;

revoke all on function public.publish_study_exam_question_import_automated(bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_study_exam_question_import_automated(bigint, text, text, uuid) to service_role;

-- A leitura pública e a correção de respostas aceitam questões aprovadas automaticamente
-- somente quando a proveniência e o gabarito oficial foram gravados pelo worker.
drop policy if exists "Read published licensed questions or admin review" on public.study_questions;
create policy "Read published licensed questions or admin review"
  on public.study_questions for select to anon, authenticated
  using (
    (
      published = true
      and (
        (
          license_status in ('permission_granted','public_domain','cc_by','cc_by_sa')
          and (license_status = 'public_domain' or license_proof_url is not null)
        )
        or (
          license_status = 'official_publication'
          and origin = 'exam_import'
          and rights_basis = 'official_publication'
          and review_status in ('admin_approved','auto_approved')
        )
        or (
          license_status = 'original_content'
          and origin = 'ai_generated'
          and review_status in ('auto_approved','admin_approved')
        )
      )
    )
    or coalesce(((select auth.jwt())->'app_metadata'->>'role'),'')='admin'
  );

create or replace function public.check_study_question_answer(
  p_question_id bigint,
  p_selected_answer text
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'correct', a.answer = lower(btrim(coalesce(p_selected_answer, ''))),
    'explanation', a.explanation
  )
  from public.study_questions q
  join public.study_question_answers a on a.question_id = q.id
  where q.id = p_question_id
    and q.published = true
    and (
      q.license_status in ('permission_granted','public_domain','cc_by','cc_by_sa')
      or (
        q.license_status = 'official_publication'
        and q.origin = 'exam_import'
        and q.rights_basis = 'official_publication'
        and q.review_status in ('admin_approved','auto_approved')
      )
    )
    and auth.uid() is not null
  limit 1;
$$;

revoke all on function public.check_study_question_answer(bigint, text) from public, anon;
grant execute on function public.check_study_question_answer(bigint, text) to authenticated;

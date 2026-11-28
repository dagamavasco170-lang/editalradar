-- Corrige questões oficiais reimportadas sem criar duplicatas.
-- Uma reextração do mesmo PDF/página/número deve atualizar o texto publicado
-- no lugar, preservando o ID da questão e o histórico dos usuários.

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
     or coalesce(v_evidence ->> 'textSpacingValid', 'false') <> 'true'
     or coalesce(v_evidence ->> 'noVisualDependency', 'false') <> 'true'
     or coalesce(v_import.auto_validation_evidence ->> 'answerKeyType', '') <> 'official_final'
     or coalesce(v_import.auto_validation_evidence ->> 'sourceHostValidated', 'false') <> 'true'
     or v_import.auto_validation_evidence ->> 'proofUrl' is distinct from v_import.exam_pdf_url
     or v_import.auto_validation_evidence ->> 'answerKeyUrl' is distinct from v_import.gabarito_source_url
     or v_import.auto_validation_evidence ->> 'proofSha256' is distinct from v_import.source_document_sha256
     or v_import.auto_validation_evidence ->> 'answerKeySha256' is distinct from v_import.gabarito_document_sha256
     or coalesce((v_import.auto_validation_evidence ->> 'gabaritoCoverage')::numeric, 0) < 1.0 then
    raise exception 'Evidências automáticas incompletas, sem espaçamento validado ou inconsistentes.'
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

  -- O identificador do documento + página + número é a identidade estável
  -- do item. Uma reextração corrigida atualiza essa mesma questão.
  select q.id
    into v_question_id
    from public.study_questions q
   where q.origin = 'exam_import'
     and q.source_document_sha256 = v_import.source_document_sha256
     and q.source_page = v_import.source_page
     and q.source_question_number = v_import.source_question_number
   for update;

  if v_question_id is not null then
    -- Não substitui uma questão diferente que já use o mesmo fingerprint.
    if exists (
      select 1
        from public.study_questions q
       where q.origin = 'exam_import'
         and q.source_fingerprint = v_import.fingerprint
         and q.id <> v_question_id
    ) then
      update public.study_exam_question_imports
         set status = 'duplicate',
             reviewed_at = v_now,
             auto_reviewed_at = v_now,
             review_notes = left('Fingerprint já utilizado por outro item publicado; reimportação não substituiu o registro existente.', 4000),
             updated_at = v_now
       where id = v_import.id;
      return null;
    end if;

    update public.study_questions
       set exam_name = v_import.exam_name,
           exam_year = v_import.exam_year,
           board = v_import.board,
           discipline = v_import.discipline,
           topic = v_import.topic,
           difficulty = v_import.difficulty,
           prompt = v_import.prompt,
           options = v_import.options,
           source_url = v_import.exam_pdf_url,
           rights_holder = coalesce(nullif(btrim(v_import.rights_holder), ''), v_import.board),
           license_status = 'official_publication',
           license_proof_url = null,
           source_license = v_import.source_license,
           source_attribution = v_import.source_attribution,
           rights_basis = 'official_publication',
           source_document_sha256 = v_import.source_document_sha256,
           source_page = v_import.source_page,
           source_question_number = v_import.source_question_number,
           source_fingerprint = v_import.fingerprint,
           review_status = 'auto_approved',
           reviewed_at = v_now,
           published = true,
           updated_at = v_now
     where id = v_question_id;
  else
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
  end if;

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

  update public.study_question_answers
     set answer = lower(v_answer),
         explanation = coalesce(
           nullif(btrim(p_explanation), ''),
           'Gabarito definitivo publicado pela banca: ' || v_import.gabarito_source_url
         )
   where question_id = v_question_id;

  if not found then
    insert into public.study_question_answers (question_id, answer, explanation, created_by)
    values (
      v_question_id,
      lower(v_answer),
      coalesce(
        nullif(btrim(p_explanation), ''),
        'Gabarito definitivo publicado pela banca: ' || v_import.gabarito_source_url
      ),
      null
    );
  end if;

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
         review_notes = left(
           'Publicada ou atualizada após reextração com validação do espaçamento, conferência do gabarito definitivo e proveniência oficial.',
           4000
         ),
         updated_at = v_now
   where id = v_import.id;

  return v_question_id;
end;
$$;

revoke all on function public.publish_study_exam_question_import_automated(bigint, text, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_study_exam_question_import_automated(bigint, text, text, uuid) to service_role;

comment on function public.publish_study_exam_question_import_automated(bigint, text, text, uuid) is
  'Publica questões oficiais com validação de espaçamento e atualiza no lugar a mesma questão quando uma reextração do mesmo PDF/página/número corrige o texto.';

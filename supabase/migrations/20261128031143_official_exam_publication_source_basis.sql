-- Publicação oficial como fundamento de reutilização em nível de fonte.
-- A decisão não exige autorização individual por questão; fontes não oficiais seguem
-- exigindo evidência e revisão registradas.
alter table public.study_exam_sources
  drop constraint if exists study_exam_sources_question_reuse_approved_check;

alter table public.study_exam_sources
  add constraint study_exam_sources_question_reuse_approved_check
  check (
    question_reuse_status <> 'approved'
    or (
      question_reuse_basis is not null
      and (
        (
          question_reuse_basis = 'official_publication'
          and published = true
          and source_url ~ '^https://'
        )
        or (
          question_reuse_basis <> 'official_publication'
          and question_reuse_reviewed_by is not null
          and question_reuse_reviewed_at is not null
          and (
            question_reuse_proof_url is not null
            or question_reuse_terms_url is not null
          )
        )
      )
    )
  );

update public.study_exam_sources
   set question_reuse_status = 'approved',
       question_reuse_basis = 'official_publication',
       question_reuse_proof_url = source_url,
       question_reuse_rights_holder = board,
       question_reuse_restrictions = 'A análise não abrange obras de terceiros incorporadas ao enunciado; itens com dependência visual ou textual externa permanecem sujeitos à revisão específica.',
       question_reuse_review_notes = 'Fonte oficial publicada pela banca/órgão. Fundamento de ato oficial (Lei 9.610/1998, art. 8º, IV) e referência ao TJPR, Apelação Cível 1437332-3, 5ª Câmara Cível, julgamento de 22/03/2016. Classificação aplicada à fonte/caderno, não como autorização individual por questão.',
       updated_at = now()
 where published = true
   and source_url ~ '^https://'
   and question_reuse_status in ('link_only','not_reviewed');

comment on constraint study_exam_sources_question_reuse_approved_check
  on public.study_exam_sources is
  'A publicação oficial em fonte da banca/órgão é uma base de reutilização em nível de fonte; demais bases exigem evidência/revisão documentada.';

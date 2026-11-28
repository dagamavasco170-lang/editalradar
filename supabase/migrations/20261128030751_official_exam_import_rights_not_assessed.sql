-- Permite pré-cadastro privado de questões sem presumir a base jurídica de reutilização.
alter table public.study_exam_question_imports
  drop constraint if exists study_exam_question_imports_rights_basis_check;
alter table public.study_exam_question_imports
  add constraint study_exam_question_imports_rights_basis_check
    check (rights_basis in (
      'official_publication','public_domain','permission_granted',
      'cc_by','cc_by_sa','other_reviewed','not_assessed'
    ));
comment on column public.study_exam_question_imports.rights_basis is
  'not_assessed identifica item extraído de fonte oficial e mantido apenas na fila privada até classificação da base jurídica; não autoriza publicação.';

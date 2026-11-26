-- Automação de elaboração e revisão de questões originais do EditalRadar.
-- Questões só são publicadas quando passam pela revisão independente e por
-- validações determinísticas.

alter table public.study_questions
  add column if not exists origin text not null default 'manual',
  add column if not exists review_status text not null default 'not_required',
  add column if not exists review_score integer,
  add column if not exists generation_model text,
  add column if not exists reviewed_at timestamptz;

alter table public.study_questions
  drop constraint if exists study_questions_origin_check,
  drop constraint if exists study_questions_review_status_check,
  drop constraint if exists study_questions_review_score_check,
  drop constraint if exists study_questions_license_status_check;

alter table public.study_questions
  add constraint study_questions_origin_check check (origin in ('manual','ai_generated')),
  add constraint study_questions_review_status_check check (review_status in ('not_required','pending','auto_approved','manual_review','admin_approved','rejected')),
  add constraint study_questions_review_score_check check (review_score is null or review_score between 0 and 100),
  add constraint study_questions_license_status_check check (license_status in ('permission_granted','public_domain','cc_by','cc_by_sa','link_only','original_content'));

update public.study_questions set review_status='not_required' where origin='manual' and review_status='pending';
create index if not exists study_questions_automation_review_idx on public.study_questions(origin,review_status,created_at desc);

drop policy if exists "Read published licensed questions or admin review" on public.study_questions;
drop policy if exists "Admins can read all study questions" on public.study_questions;
drop policy if exists "Public can read licensed published questions" on public.study_questions;
create policy "Read published licensed questions or admin review"
  on public.study_questions for select to anon, authenticated
  using (
    (
      published=true and (
        (license_status in ('permission_granted','public_domain','cc_by','cc_by_sa') and (license_status='public_domain' or license_proof_url is not null))
        or (license_status='original_content' and origin='ai_generated' and review_status in ('auto_approved','admin_approved'))
      )
    )
    or coalesce(((select auth.jwt())->'app_metadata'->>'role'),'')='admin'
  );

drop policy if exists "Admins can update study questions" on public.study_questions;
create policy "Admins can update study questions"
  on public.study_questions for update to authenticated
  using (coalesce(((select auth.jwt())->'app_metadata'->>'role'),'')='admin')
  with check (
    coalesce(((select auth.jwt())->'app_metadata'->>'role'),'')='admin'
    and (created_by=(select auth.uid()) or origin='ai_generated')
  );

create table if not exists public.study_question_automation_topics (
  id uuid primary key default gen_random_uuid(),
  discipline text not null check (char_length(btrim(discipline)) between 2 and 100),
  topic text not null check (char_length(btrim(topic)) between 2 and 160),
  difficulty text not null default 'Intermediária' check (difficulty in ('Fácil','Intermediária','Avançada')),
  source_url text not null check (source_url ~ '^https://'),
  source_excerpt text not null check (char_length(btrim(source_excerpt)) between 200 and 12000),
  questions_per_run smallint not null default 3 check (questions_per_run between 1 and 5),
  cadence_days smallint not null default 1 check (cadence_days between 1 and 30),
  active boolean not null default true,
  last_run_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(discipline,topic,source_url)
);
create index if not exists study_question_automation_topics_due_idx on public.study_question_automation_topics(active,last_run_at);
alter table public.study_question_automation_topics enable row level security;
drop policy if exists "Admins manage question automation topics" on public.study_question_automation_topics;
create policy "Admins manage question automation topics" on public.study_question_automation_topics for all to authenticated
  using (coalesce(((select auth.jwt())->'app_metadata'->>'role'),'')='admin')
  with check (coalesce(((select auth.jwt())->'app_metadata'->>'role'),'')='admin');
grant select,insert,update,delete on public.study_question_automation_topics to authenticated;

create table if not exists public.study_question_automation_runs (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid references public.study_question_automation_topics(id) on delete set null,
  trigger_mode text not null check (trigger_mode in ('manual','scheduled')),
  status text not null default 'running' check (status in ('running','completed','partial','failed','skipped')),
  model text not null,
  requested_count smallint not null default 0,
  generated_count smallint not null default 0,
  auto_approved_count smallint not null default 0,
  manual_review_count smallint not null default 0,
  rejected_count smallint not null default 0,
  error_summary text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists study_question_automation_runs_started_idx on public.study_question_automation_runs(started_at desc);
alter table public.study_question_automation_runs enable row level security;
drop policy if exists "Admins read question automation runs" on public.study_question_automation_runs;
create policy "Admins read question automation runs" on public.study_question_automation_runs for select to authenticated
  using (coalesce(((select auth.jwt())->'app_metadata'->>'role'),'')='admin');
grant select on public.study_question_automation_runs to authenticated;

create table if not exists public.study_question_automation_reviews (
  question_id bigint primary key references public.study_questions(id) on delete cascade,
  run_id uuid references public.study_question_automation_runs(id) on delete set null,
  source_excerpt text not null,
  evidence_excerpt text not null,
  reviewer_model text not null,
  reviewer_score integer not null check (reviewer_score between 0 and 100),
  approved boolean not null,
  factual_support boolean not null,
  single_correct_answer boolean not null,
  explanation_consistent boolean not null,
  issues jsonb not null default '[]'::jsonb,
  reviewed_at timestamptz not null default now()
);
create index if not exists study_question_automation_reviews_run_idx on public.study_question_automation_reviews(run_id);
alter table public.study_question_automation_reviews enable row level security;
drop policy if exists "Admins read question automation reviews" on public.study_question_automation_reviews;
create policy "Admins read question automation reviews" on public.study_question_automation_reviews for select to authenticated
  using (coalesce(((select auth.jwt())->'app_metadata'->>'role'),'')='admin');
grant select on public.study_question_automation_reviews to authenticated;

-- Reassert the answer-check security contract after the complete automation schema exists.
-- Explicit qualification avoids depending on a mutable search_path in SECURITY DEFINER code.
create or replace function public.check_study_question_answer(
  p_question_id bigint,
  p_selected_answer text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'correct', a.answer = pg_catalog.btrim(coalesce(p_selected_answer, '')),
    'explanation', a.explanation
  )
  from public.study_questions q
  join public.study_question_answers a on a.question_id = q.id
  where q.id = p_question_id
    and q.published = true
    and (
      (
        q.license_status in ('permission_granted','public_domain','cc_by','cc_by_sa')
        and (q.license_status = 'public_domain' or q.license_proof_url is not null)
      )
      or (
        q.license_status = 'original_content'
        and q.origin = 'ai_generated'
        and q.review_status in ('auto_approved','admin_approved')
      )
    )
    and auth.uid() is not null
  limit 1;
$$;

revoke all on function public.check_study_question_answer(bigint, text) from public, anon;
grant execute on function public.check_study_question_answer(bigint, text) to authenticated;

-- Pin every audited SECURITY DEFINER function to an empty search_path.
alter function public.enqueue_push_delivery(jsonb, integer) set search_path = '';
alter function public.enqueue_push_deliveries(jsonb[], integer) set search_path = '';
alter function public.read_push_delivery_retries(integer, integer) set search_path = '';
alter function public.ack_push_delivery_retry(bigint) set search_path = '';
alter function public.reschedule_push_delivery_retry(bigint, jsonb, integer) set search_path = '';
alter function public.fail_push_delivery_retry(bigint, text, text, integer) set search_path = '';
alter function public.verify_push_queue_worker_token(text) set search_path = '';

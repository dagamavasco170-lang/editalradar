create or replace function private._get_push_notification_health()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_queue jsonb;
  v_scheduler jsonb;
  v_http jsonb;
  v_devices jsonb;
  v_failures jsonb;
  v_recent_errors jsonb;
begin
  if auth.uid() is null
    or coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') <> 'admin'
  then
    raise exception 'Acesso restrito a administradores'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'queue_length', coalesce(metrics.queue_length, 0),
    'visible_length', coalesce(metrics.queue_visible_length, 0),
    'oldest_message_age_seconds', metrics.oldest_msg_age_sec,
    'newest_message_age_seconds', metrics.newest_msg_age_sec,
    'total_messages', coalesce(metrics.total_messages, 0),
    'scraped_at', metrics.scrape_time
  )
  into v_queue
  from pgmq.metrics('push_delivery_retries') as metrics
  where metrics.queue_name = 'push_delivery_retries';

  if v_queue is null then
    v_queue := jsonb_build_object(
      'queue_length', 0,
      'visible_length', 0,
      'oldest_message_age_seconds', null,
      'newest_message_age_seconds', null,
      'total_messages', 0,
      'scraped_at', now()
    );
  end if;

  select jsonb_build_object(
    'active', job.active,
    'schedule', job.schedule,
    'last_run_at', run.start_time,
    'last_run_finished_at', run.end_time,
    'last_run_status', run.status,
    'last_run_message', run.return_message,
    'last_run_age_seconds', case
      when run.start_time is null then null
      else greatest(0, extract(epoch from (now() - run.start_time))::integer)
    end
  )
  into v_scheduler
  from cron.job as job
  left join lateral (
    select details.start_time, details.end_time, details.status, details.return_message
    from cron.job_run_details as details
    where details.jobid = job.jobid
    order by details.start_time desc
    limit 1
  ) as run on true
  where job.jobname = 'process-push-delivery-retries'
  limit 1;

  if v_scheduler is null then
    v_scheduler := jsonb_build_object(
      'active', false,
      'schedule', null,
      'last_run_at', null,
      'last_run_finished_at', null,
      'last_run_status', null,
      'last_run_message', null,
      'last_run_age_seconds', null
    );
  end if;

  select jsonb_build_object(
    'status_code', response.status_code,
    'created_at', response.created,
    'timed_out', coalesce(response.timed_out, false),
    'error', nullif(left(coalesce(response.error_msg, ''), 240), ''),
    'result_counts', jsonb_build_object(
      'available', parsed.processed_match is not null,
      'processed', coalesce((parsed.processed_match)[1]::integer, 0),
      'sent', coalesce((parsed.sent_match)[1]::integer, 0),
      'rescheduled', coalesce((parsed.rescheduled_match)[1]::integer, 0),
      'expired', coalesce((parsed.expired_match)[1]::integer, 0),
      'expired_before_retry', coalesce((parsed.expired_before_retry_match)[1]::integer, 0),
      'disabled_invalid', coalesce((parsed.disabled_invalid_match)[1]::integer, 0),
      'invalid_message', coalesce((parsed.invalid_message_match)[1]::integer, 0),
      'dead_letter', coalesce((parsed.dead_letter_match)[1]::integer, 0),
      'pending_redelivery', coalesce((parsed.pending_redelivery_match)[1]::integer, 0)
    )
  )
  into v_http
  from net._http_response as response
  cross join lateral (
    select
      regexp_match(coalesce(response.content, ''), '"processed"\s*:\s*([0-9]+)') as processed_match,
      regexp_match(coalesce(response.content, ''), '"sent"\s*:\s*([0-9]+)') as sent_match,
      regexp_match(coalesce(response.content, ''), '"rescheduled"\s*:\s*([0-9]+)') as rescheduled_match,
      regexp_match(coalesce(response.content, ''), '"expired"\s*:\s*([0-9]+)') as expired_match,
      regexp_match(coalesce(response.content, ''), '"expired_before_retry"\s*:\s*([0-9]+)') as expired_before_retry_match,
      regexp_match(coalesce(response.content, ''), '"disabled_invalid"\s*:\s*([0-9]+)') as disabled_invalid_match,
      regexp_match(coalesce(response.content, ''), '"invalid_message"\s*:\s*([0-9]+)') as invalid_message_match,
      regexp_match(coalesce(response.content, ''), '"dead_letter"\s*:\s*([0-9]+)') as dead_letter_match,
      regexp_match(coalesce(response.content, ''), '"pending_redelivery"\s*:\s*([0-9]+)') as pending_redelivery_match
  ) as parsed
  order by response.created desc
  limit 1;

  if v_http is null then
    v_http := jsonb_build_object(
      'status_code', null,
      'created_at', null,
      'timed_out', false,
      'error', null,
      'result_counts', jsonb_build_object(
        'available', false,
        'processed', 0,
        'sent', 0,
        'rescheduled', 0,
        'expired', 0,
        'expired_before_retry', 0,
        'disabled_invalid', 0,
        'invalid_message', 0,
        'dead_letter', 0,
        'pending_redelivery', 0
      )
    );
  end if;

  select jsonb_build_object(
    'total', count(*),
    'enabled', count(*) filter (where enabled is true),
    'disabled', count(*) filter (where enabled is false)
  )
  into v_devices
  from public.push_devices;

  select jsonb_build_object(
    'total', count(*),
    'last_24h', count(*) filter (where failed_at >= now() - interval '24 hours'),
    'latest_at', max(failed_at)
  )
  into v_failures
  from public.push_delivery_failures;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'error_code', grouped.error_code,
        'count', grouped.failure_count,
        'latest_at', grouped.latest_at
      )
      order by grouped.latest_at desc
    ),
    '[]'::jsonb
  )
  into v_recent_errors
  from (
    select error_code, count(*) as failure_count, max(failed_at) as latest_at
    from public.push_delivery_failures
    where failed_at >= now() - interval '7 days'
    group by error_code
    order by max(failed_at) desc
    limit 5
  ) as grouped;

  return jsonb_build_object(
    'generated_at', now(),
    'queue', v_queue,
    'scheduler', v_scheduler,
    'worker_http', v_http,
    'devices', v_devices,
    'failures', v_failures,
    'recent_errors', v_recent_errors
  );
end;
$function$;

comment on function private._get_push_notification_health() is
  'Consulta administrativa da saúde de push com contagens agregadas do último lote, sem payloads ou tokens.';
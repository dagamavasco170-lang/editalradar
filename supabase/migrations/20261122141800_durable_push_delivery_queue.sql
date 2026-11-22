-- Durable FCM retry queue for EditalRadar.
-- Queue contents remain private to Postgres; only narrowly scoped service-role RPCs can access them.

create extension if not exists pgmq;
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (
    select 1 from pgmq.list_queues() where queue_name = 'push_delivery_retries'
  ) then
    perform pgmq.create('push_delivery_retries');
  end if;
end
$$;

create table if not exists public.push_delivery_failures (
  id bigint generated always as identity primary key,
  failed_at timestamptz not null default now(),
  token_fingerprint text not null,
  error_code text not null,
  attempt_count integer not null check (attempt_count > 0)
);

create index if not exists push_delivery_failures_failed_at_idx
  on public.push_delivery_failures (failed_at desc);

alter table public.push_delivery_failures enable row level security;
revoke all on table public.push_delivery_failures from public, anon, authenticated;
grant select, insert on table public.push_delivery_failures to service_role;
grant usage, select on sequence public.push_delivery_failures_id_seq to service_role;

create or replace function public.enqueue_push_delivery(
  p_message jsonb,
  p_delay_seconds integer default 0
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message_id bigint;
begin
  if jsonb_typeof(p_message) <> 'object'
     or coalesce(length(p_message->>'token'), 0) < 32
     or coalesce(length(p_message->>'token'), 0) > 4096
     or coalesce(length(p_message->>'title'), 0) = 0
     or coalesce(length(p_message->>'body'), 0) = 0 then
    raise exception 'Invalid push delivery payload';
  end if;

  select pgmq.send(
    'push_delivery_retries',
    p_message,
    greatest(0, least(coalesce(p_delay_seconds, 0), 86400))
  ) into v_message_id;

  return v_message_id;
end;
$$;

create or replace function public.read_push_delivery_retries(
  p_qty integer default 20,
  p_visibility_seconds integer default 180
)
returns table (
  msg_id bigint,
  read_ct bigint,
  message jsonb,
  enqueued_at timestamptz,
  vt timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select r.msg_id, r.read_ct, r.message, r.enqueued_at, r.vt
  from pgmq.read(
    'push_delivery_retries',
    greatest(60, least(coalesce(p_visibility_seconds, 180), 600)),
    greatest(1, least(coalesce(p_qty, 20), 50))
  ) as r;
$$;

create or replace function public.ack_push_delivery_retry(p_msg_id bigint)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select pgmq.delete('push_delivery_retries', p_msg_id);
$$;

create or replace function public.reschedule_push_delivery_retry(
  p_old_msg_id bigint,
  p_message jsonb,
  p_delay_seconds integer
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_message_id bigint;
  v_deleted boolean;
begin
  if jsonb_typeof(p_message) <> 'object'
     or coalesce(length(p_message->>'token'), 0) < 32
     or coalesce(length(p_message->>'token'), 0) > 4096 then
    raise exception 'Invalid push retry payload';
  end if;

  select pgmq.send(
    'push_delivery_retries',
    p_message,
    greatest(1, least(coalesce(p_delay_seconds, 1), 86400))
  ) into v_new_message_id;

  select pgmq.delete('push_delivery_retries', p_old_msg_id) into v_deleted;
  if not coalesce(v_deleted, false) then
    raise exception 'Could not acknowledge previous push retry message';
  end if;

  return v_new_message_id;
end;
$$;

create or replace function public.fail_push_delivery_retry(
  p_msg_id bigint,
  p_token text,
  p_error_code text,
  p_attempt_count integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted boolean;
begin
  if coalesce(length(p_token), 0) < 32 then
    raise exception 'Invalid token fingerprint input';
  end if;

  insert into public.push_delivery_failures (
    token_fingerprint,
    error_code,
    attempt_count
  ) values (
    encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex'),
    left(coalesce(nullif(p_error_code, ''), 'UNKNOWN'), 80),
    greatest(1, least(coalesce(p_attempt_count, 1), 1000))
  );

  select pgmq.delete('push_delivery_retries', p_msg_id) into v_deleted;
  if not coalesce(v_deleted, false) then
    raise exception 'Could not acknowledge failed push retry message';
  end if;
end;
$$;

create or replace function public.verify_push_queue_worker_token(p_token text)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce(
    p_token is not null
    and p_token = (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'push_queue_worker_token'
      limit 1
    ),
    false
  );
$$;

revoke all on function public.enqueue_push_delivery(jsonb, integer) from public, anon, authenticated;
revoke all on function public.read_push_delivery_retries(integer, integer) from public, anon, authenticated;
revoke all on function public.ack_push_delivery_retry(bigint) from public, anon, authenticated;
revoke all on function public.reschedule_push_delivery_retry(bigint, jsonb, integer) from public, anon, authenticated;
revoke all on function public.fail_push_delivery_retry(bigint, text, text, integer) from public, anon, authenticated;
revoke all on function public.verify_push_queue_worker_token(text) from public, anon, authenticated;

grant execute on function public.enqueue_push_delivery(jsonb, integer) to service_role;
grant execute on function public.read_push_delivery_retries(integer, integer) to service_role;
grant execute on function public.ack_push_delivery_retry(bigint) to service_role;
grant execute on function public.reschedule_push_delivery_retry(bigint, jsonb, integer) to service_role;
grant execute on function public.fail_push_delivery_retry(bigint, text, text, integer) to service_role;
grant execute on function public.verify_push_queue_worker_token(text) to service_role;

do $$
begin
  if not exists (
    select 1 from vault.secrets where name = 'push_queue_worker_token'
  ) then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'push_queue_worker_token',
      'Internal authentication token for the scheduled EditalRadar push queue worker'
    );
  end if;

  if not exists (
    select 1 from vault.secrets where name = 'push_queue_project_url'
  ) then
    perform vault.create_secret(
      'https://xrdtqbatynoofkjtjgeq.supabase.co',
      'push_queue_project_url',
      'Supabase project URL used by the scheduled EditalRadar push queue worker'
    );
  end if;
end
$$;

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'process-push-delivery-retries'
  limit 1;

  if v_job_id is not null then
    perform cron.unschedule(v_job_id);
  end if;

  perform cron.schedule(
    'process-push-delivery-retries',
    '* * * * *',
    $job$
      select net.http_post(
        url := (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'push_queue_project_url'
          limit 1
        ) || '/functions/v1/push-queue-worker',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            select decrypted_secret
            from vault.decrypted_secrets
            where name = 'push_queue_worker_token'
            limit 1
          )
        ),
        body := jsonb_build_object('source', 'pg_cron'),
        timeout_milliseconds := 55000
      ) as request_id;
    $job$
  );
end
$$;

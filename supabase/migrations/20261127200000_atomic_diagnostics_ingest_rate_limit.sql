-- Atomic service-wide budget for anonymous diagnostics ingestion.
-- client_id remains a grouping value only; it is not an authenticated identity.
create table if not exists private.diagnostics_ingest_rate_limits (
  window_start timestamptz primary key,
  request_count integer not null check (request_count between 0 and 500)
);

alter table private.diagnostics_ingest_rate_limits enable row level security;
revoke all on table private.diagnostics_ingest_rate_limits from public, anon, authenticated, service_role;

create or replace function public.consume_diagnostics_ingest_rate_limit(
  p_cost integer,
  p_limit integer default 500
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz := date_trunc('minute', clock_timestamp());
  v_allowed boolean;
begin
  if p_cost is null or p_cost < 1 or p_cost > 5
     or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid diagnostics rate limit arguments'
      using errcode = '22023';
  end if;

  delete from private.diagnostics_ingest_rate_limits
  where window_start < v_window_start - interval '1 day';

  insert into private.diagnostics_ingest_rate_limits as limits (window_start, request_count)
  values (v_window_start, p_cost)
  on conflict (window_start) do update
    set request_count = limits.request_count + excluded.request_count
    where limits.request_count + excluded.request_count <= p_limit
  returning true into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.consume_diagnostics_ingest_rate_limit(integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_diagnostics_ingest_rate_limit(integer, integer)
  to service_role;

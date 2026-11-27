-- Per-source diagnostics budget. The IP is HMACed in the Edge Function;
-- this table never stores the raw client address.
create table if not exists private.diagnostics_ingest_ip_rate_limits (
  window_start timestamptz not null,
  ip_hash text not null check (ip_hash ~ '^[a-f0-9]{64}$'),
  request_count integer not null check (request_count between 0 and 40),
  primary key (window_start, ip_hash)
);

alter table private.diagnostics_ingest_ip_rate_limits enable row level security;
revoke all on table private.diagnostics_ingest_ip_rate_limits
  from public, anon, authenticated, service_role;

create or replace function public.consume_diagnostics_ingest_ip_rate_limit(
  p_ip_hash text,
  p_cost integer,
  p_limit integer default 40
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz :=
    to_timestamp(floor(extract(epoch from clock_timestamp()) / 900) * 900);
  v_allowed boolean;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[a-f0-9]{64}$'
     or p_cost is null or p_cost < 1 or p_cost > 5
     or p_limit is null or p_limit < 1 or p_limit > 40 then
    raise exception 'invalid diagnostics IP rate limit arguments'
      using errcode = '22023';
  end if;

  delete from private.diagnostics_ingest_ip_rate_limits
  where window_start < v_window_start - interval '1 day';

  insert into private.diagnostics_ingest_ip_rate_limits as limits
    (window_start, ip_hash, request_count)
  values (v_window_start, p_ip_hash, p_cost)
  on conflict (window_start, ip_hash) do update
    set request_count = limits.request_count + excluded.request_count
    where limits.request_count + excluded.request_count <= p_limit
  returning true into v_allowed;

  return coalesce(v_allowed, false);
end;
$$;

revoke all on function public.consume_diagnostics_ingest_ip_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_diagnostics_ingest_ip_rate_limit(text, integer, integer)
  to service_role;

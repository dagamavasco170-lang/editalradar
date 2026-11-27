create index if not exists app_diagnostics_client_created_at_idx on public.app_diagnostics(client_id, created_at desc);
select cron.schedule(
  'editalradar-diagnostics-retention',
  '17 3 * * *',
  $$delete from public.app_diagnostics where created_at < now() - interval '30 days'$$
);

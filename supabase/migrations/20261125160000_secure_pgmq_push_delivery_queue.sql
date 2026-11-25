-- Protect the durable push queue and its archive from direct API access.
-- Worker access remains through the narrowly scoped service_role RPCs.
alter table pgmq.q_push_delivery_retries enable row level security;
alter table pgmq.a_push_delivery_retries enable row level security;

revoke all on table pgmq.q_push_delivery_retries from public, anon, authenticated;
revoke all on table pgmq.a_push_delivery_retries from public, anon, authenticated;

comment on table pgmq.q_push_delivery_retries is
  'Push retry queue. RLS enabled; access is mediated by service-role RPCs.';
comment on table pgmq.a_push_delivery_retries is
  'Push retry archive. RLS enabled; access is mediated by service-role RPCs.';

-- Permissões para o robô de triagem publicar registros validados automaticamente.
-- O segredo SUPABASE_SERVICE_ROLE_KEY permanece somente no GitHub Actions.
grant select, insert, update on public.contest_catalog to service_role;
grant usage, select on sequence public.contest_catalog_id_seq to service_role;

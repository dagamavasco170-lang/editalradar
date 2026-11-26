ALTER TABLE public.contest_discoveries
  DROP CONSTRAINT IF EXISTS contest_discoveries_discovery_type_check;

ALTER TABLE public.contest_discoveries
  ADD CONSTRAINT contest_discoveries_discovery_type_check
  CHECK (discovery_type IN ('new_link', 'page_change', 'source_baseline', 'web_search_lead'));

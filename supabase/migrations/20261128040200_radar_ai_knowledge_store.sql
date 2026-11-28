-- Radar AI private knowledge store. Embeddings use Supabase gte-small (384 dimensions).
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.radar_ai_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 240),
  source_url text NOT NULL CHECK (source_url ~ '^https://'),
  source_category text NOT NULL CHECK (source_category IN (
    'official-law', 'official-exam', 'official-notice', 'licensed',
    'public-domain', 'authorized'
  )),
  rights_status text NOT NULL DEFAULT 'unreviewed' CHECK (rights_status IN (
    'unreviewed', 'link_only', 'authorized', 'permission_granted',
    'public_domain', 'official_publication', 'cc_by', 'cc_by_sa', 'restricted'
  )),
  rights_verified boolean NOT NULL DEFAULT false,
  rights_evidence_url text CHECK (rights_evidence_url IS NULL OR rights_evidence_url ~ '^https://'),
  attribution text NOT NULL DEFAULT '',
  official boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radar_ai_sources_source_url_unique UNIQUE (source_url)
);

CREATE TABLE IF NOT EXISTS public.radar_ai_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.radar_ai_sources(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 500),
  document_url text CHECK (document_url IS NULL OR document_url ~ '^https://'),
  document_type text NOT NULL DEFAULT 'text' CHECK (document_type IN ('text', 'pdf', 'html', 'exam', 'notice', 'law', 'other')),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  content text NOT NULL,
  subject text,
  topic text,
  board text,
  exam_name text,
  exam_year integer CHECK (exam_year IS NULL OR exam_year BETWEEN 1900 AND 2200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'quarantined')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radar_ai_documents_source_hash_unique UNIQUE (source_id, content_hash)
);

CREATE TABLE IF NOT EXISTS public.radar_ai_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.radar_ai_documents(id) ON DELETE CASCADE,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  content text NOT NULL CHECK (char_length(btrim(content)) BETWEEN 1 AND 6000),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  subject text,
  topic text,
  board text,
  exam_name text,
  exam_year integer CHECK (exam_year IS NULL OR exam_year BETWEEN 1900 AND 2200),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  embedding extensions.vector(384),
  search_vector tsvector GENERATED ALWAYS AS (to_tsvector('portuguese'::regconfig, content)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT radar_ai_chunks_document_index_unique UNIQUE (document_id, chunk_index),
  CONSTRAINT radar_ai_chunks_document_hash_unique UNIQUE (document_id, content_hash)
);

CREATE INDEX IF NOT EXISTS radar_ai_documents_source_id_idx ON public.radar_ai_documents(source_id);
CREATE INDEX IF NOT EXISTS radar_ai_documents_status_idx ON public.radar_ai_documents(status);
CREATE INDEX IF NOT EXISTS radar_ai_documents_subject_topic_idx ON public.radar_ai_documents(subject, topic);
CREATE INDEX IF NOT EXISTS radar_ai_chunks_document_id_idx ON public.radar_ai_chunks(document_id);
CREATE INDEX IF NOT EXISTS radar_ai_chunks_subject_topic_idx ON public.radar_ai_chunks(subject, topic);
CREATE INDEX IF NOT EXISTS radar_ai_chunks_exam_idx ON public.radar_ai_chunks(board, exam_name, exam_year);
CREATE INDEX IF NOT EXISTS radar_ai_chunks_search_vector_idx ON public.radar_ai_chunks USING gin(search_vector);
CREATE INDEX IF NOT EXISTS radar_ai_chunks_embedding_hnsw_idx ON public.radar_ai_chunks USING hnsw (embedding vector_cosine_ops) WHERE embedding IS NOT NULL;

-- Defense in depth: reject document ingestion when source rights are not explicitly verified.
CREATE OR REPLACE FUNCTION public.radar_ai_assert_source_ingest_allowed()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.radar_ai_sources s
    WHERE s.id = NEW.source_id
      AND s.active
      AND s.rights_verified
      AND s.rights_status IN (
        'authorized', 'permission_granted', 'public_domain',
        'official_publication', 'cc_by', 'cc_by_sa'
      )
  ) THEN
    RAISE EXCEPTION 'Radar AI ingestion denied: source rights are not verified or do not permit ingestion';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS radar_ai_documents_rights_gate ON public.radar_ai_documents;
CREATE TRIGGER radar_ai_documents_rights_gate
BEFORE INSERT OR UPDATE OF source_id ON public.radar_ai_documents
FOR EACH ROW EXECUTE FUNCTION public.radar_ai_assert_source_ingest_allowed();

ALTER TABLE public.radar_ai_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radar_ai_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radar_ai_chunks ENABLE ROW LEVEL SECURITY;

-- Private knowledge is accessible only to trusted server-side workloads.
REVOKE ALL ON TABLE public.radar_ai_sources, public.radar_ai_documents, public.radar_ai_chunks FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.radar_ai_sources, public.radar_ai_documents, public.radar_ai_chunks TO service_role;
REVOKE ALL ON FUNCTION public.radar_ai_assert_source_ingest_allowed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.radar_ai_assert_source_ingest_allowed() TO service_role;

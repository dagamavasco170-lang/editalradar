-- Radar AI learning analytics and curated training examples (private/server-only).
CREATE TABLE IF NOT EXISTS public.radar_ai_training_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  example_key text NOT NULL UNIQUE,
  task text NOT NULL CHECK (task IN ('tutor-explanation','question-analysis','error-diagnosis','question-generation','study-planning')),
  input jsonb NOT NULL CHECK (jsonb_typeof(input) = 'object'),
  target text NOT NULL CHECK (char_length(btrim(target)) >= 20),
  rubric jsonb NOT NULL CHECK (jsonb_typeof(rubric) = 'array' AND jsonb_array_length(rubric) > 0),
  references_json jsonb NOT NULL CHECK (jsonb_typeof(references_json) = 'array' AND jsonb_array_length(references_json) > 0),
  rights_status text NOT NULL CHECK (rights_status IN ('authorized','permission_granted','public_domain','official_publication','cc_by','cc_by_sa')),
  review_status text NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending','approved','rejected')),
  dataset_split text NOT NULL DEFAULT 'train' CHECK (dataset_split IN ('train','validation','test')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((review_status IN ('approved','rejected')) = (reviewed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.radar_ai_learning_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_key text NOT NULL CHECK (char_length(btrim(topic_key)) BETWEEN 1 AND 240),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 240),
  is_correct boolean NOT NULL,
  error_type text CHECK (error_type IS NULL OR error_type IN ('content-gap','misinterpretation','concept-confusion','carelessness','guess','unknown')),
  response_time_ms integer CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX IF NOT EXISTS radar_ai_learning_user_topic_time_idx
  ON public.radar_ai_learning_events(user_id, topic_key, occurred_at DESC);
CREATE INDEX IF NOT EXISTS radar_ai_learning_user_time_idx
  ON public.radar_ai_learning_events(user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.radar_ai_topic_profiles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic_key text NOT NULL CHECK (char_length(btrim(topic_key)) BETWEEN 1 AND 240),
  subject text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 1 AND 240),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0 AND correct_count <= attempt_count),
  weighted_accuracy numeric(6,5) NOT NULL DEFAULT 0 CHECK (weighted_accuracy BETWEEN 0 AND 1),
  mastery_status text NOT NULL DEFAULT 'insufficient-data' CHECK (mastery_status IN ('insufficient-data','needs-review','developing','mastered')),
  confidence text NOT NULL DEFAULT 'low' CHECK (confidence IN ('low','medium','high')),
  last_attempt_at timestamptz,
  error_counts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(error_counts) = 'object'),
  recommended_action text NOT NULL DEFAULT 'diagnostic-practice' CHECK (recommended_action IN ('diagnostic-practice','targeted-review','mixed-practice','maintenance-review')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic_key)
);

ALTER TABLE public.radar_ai_training_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radar_ai_learning_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.radar_ai_topic_profiles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.radar_ai_training_examples, public.radar_ai_learning_events, public.radar_ai_topic_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.radar_ai_training_examples, public.radar_ai_learning_events, public.radar_ai_topic_profiles TO service_role;

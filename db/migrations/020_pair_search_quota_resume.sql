-- Quota-aware Vehicle-Person Pair search and resumable progress.
ALTER TABLE vehicle_person_pair_runs
  DROP CONSTRAINT IF EXISTS vehicle_person_pair_runs_status_check;

ALTER TABLE vehicle_person_pair_runs
  ADD CONSTRAINT vehicle_person_pair_runs_status_check
  CHECK (status IN (
    'QUEUED','RUNNING','PARTIAL','COMPLETED','FAILED','CANCELLED'
  ));

ALTER TABLE person_direct_video_signal_runs
  DROP CONSTRAINT IF EXISTS person_direct_video_signal_runs_status_valid;
ALTER TABLE person_direct_video_signal_runs
  ADD CONSTRAINT person_direct_video_signal_runs_status_valid
  CHECK(status IN('QUEUED','RUNNING','PARTIAL','COMPLETED','FAILED','CANCELLED'));

ALTER TABLE country_event_video_signal_runs
  DROP CONSTRAINT IF EXISTS country_event_video_signal_runs_status_valid;
ALTER TABLE country_event_video_signal_runs
  ADD CONSTRAINT country_event_video_signal_runs_status_valid
  CHECK(status IN('QUEUED','RUNNING','PARTIAL','COMPLETED','FAILED','CANCELLED'));

ALTER TABLE vehicle_person_pair_runs
  ADD COLUMN IF NOT EXISTS resume_run_id BIGINT
    REFERENCES vehicle_person_pair_runs(id),
  ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS youtube_search_query_cache (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  normalized_query TEXT NOT NULL,
  format TEXT NOT NULL,
  result_video_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  searched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  search_result_count INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'YOUTUBE',
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(normalized_query, format, provider)
);

CREATE INDEX IF NOT EXISTS idx_youtube_search_query_cache_expiry
  ON youtube_search_query_cache(expires_at);

CREATE TABLE IF NOT EXISTS youtube_daily_search_budget (
  quota_date_pacific DATE PRIMARY KEY,
  daily_limit INTEGER NOT NULL DEFAULT 100 CHECK(daily_limit=100),
  automated_safe_limit INTEGER NOT NULL DEFAULT 90 CHECK(automated_safe_limit=90),
  reserved_credits INTEGER NOT NULL DEFAULT 10 CHECK(reserved_credits=10),
  search_calls_used INTEGER NOT NULL DEFAULT 0 CHECK(search_calls_used BETWEEN 0 AND 90),
  vehicle_search_calls INTEGER NOT NULL DEFAULT 0,
  person_search_calls INTEGER NOT NULL DEFAULT 0,
  pair_search_calls INTEGER NOT NULL DEFAULT 0,
  country_event_search_calls INTEGER NOT NULL DEFAULT 0,
  manual_reserved_calls INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  blocked_search_calls INTEGER NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(search_calls_used = vehicle_search_calls + person_search_calls +
    pair_search_calls + country_event_search_calls)
);

CREATE TABLE IF NOT EXISTS locked_canon_slots (
  slot_id TEXT PRIMARY KEY CHECK(slot_id ~ '^CANDIDATE_SLOT_(0[1-9]|1[0-5])$'),
  canon_driver_name TEXT,
  canon_vehicle_name TEXT NOT NULL,
  canon_country_code VARCHAR(8) NOT NULL REFERENCES countries(code)
    CHECK(canon_country_code ~ '^[A-Z]{2}$'),
  locked BOOLEAN NOT NULL DEFAULT TRUE,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS locked_canon_news_candidates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES locked_canon_slots(slot_id) ON DELETE CASCADE,
  country_news_signal_id BIGINT NOT NULL REFERENCES country_news_signals(id),
  rank INTEGER NOT NULL CHECK(rank > 0),
  selected BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(slot_id,country_news_signal_id),
  UNIQUE(slot_id,rank)
);

CREATE TABLE IF NOT EXISTS station_guest_search_budgets (
  station_run_key TEXT PRIMARY KEY,
  total_budget INTEGER NOT NULL DEFAULT 30 CHECK(total_budget=30),
  vehicle_discovery_budget INTEGER NOT NULL DEFAULT 6,
  person_discovery_budget INTEGER NOT NULL DEFAULT 6,
  joint_pair_budget INTEGER NOT NULL DEFAULT 12,
  country_event_budget INTEGER NOT NULL DEFAULT 4,
  retry_reserve INTEGER NOT NULL DEFAULT 2,
  used JSONB NOT NULL DEFAULT '{"vehicle":0,"person":0,"pair":0,"country_event":0,"retry":0}'::jsonb,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','SEARCH_BUDGET_EXHAUSTED','COMPLETED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(vehicle_discovery_budget + person_discovery_budget + joint_pair_budget +
    country_event_budget + retry_reserve = total_budget)
);

ALTER TABLE fusion_runs
  ADD COLUMN IF NOT EXISTS content_mode TEXT NOT NULL DEFAULT 'STATION_GUEST'
    CHECK(content_mode IN('LOCKED_CANON','STATION_GUEST')),
  ADD COLUMN IF NOT EXISTS station_run_key TEXT;

ALTER TABLE story_pipeline_runs
  ALTER COLUMN fusion_candidate_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS content_mode TEXT NOT NULL DEFAULT 'STATION_GUEST'
    CHECK(content_mode IN('LOCKED_CANON','STATION_GUEST')),
  ADD COLUMN IF NOT EXISTS locked_canon_slot_id TEXT REFERENCES locked_canon_slots(slot_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_story_pipeline_runs_locked_canon_active
  ON story_pipeline_runs(locked_canon_slot_id)
  WHERE content_mode='LOCKED_CANON'
    AND status NOT IN('COMPLETED','FAILED','CANCELLED');

-- Restore any Fusion lineage that was superseded by a diagnostic Fusion
-- whose source Pair Run was not a complete target-reaching run.
UPDATE fusion_runs previous
SET superseded_by_run_id=NULL,
    superseded_at=NULL,
    updated_at=NOW()
FROM fusion_runs replacement
JOIN vehicle_person_pair_runs source_pair
  ON source_pair.id=replacement.pair_run_id
WHERE previous.superseded_by_run_id=replacement.id
  AND NOT (
    source_pair.status='COMPLETED'
    AND COALESCE((source_pair.summary->>'target_reached')::boolean, FALSE)
  );

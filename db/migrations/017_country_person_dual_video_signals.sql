-- =========================================================
-- COUNTRY + PERSON DUAL-VIDEO SIGNAL PACKS
--
-- A signal item is always ONE specific video. This migration
-- adds the two tables needed to persist the two new
-- single-video Hook roles that don't already have a home:
--
--   country_event_video_signals -- the one video matched to a
--   CURRENT country_news_signals event (a country identity
--   video already lives on `signals.resolved_country_id` and
--   needs no new table). The video comes from a REAL YouTube
--   search against the live event, not a scan of already-
--   ingested vehicle signals, so full video metadata is
--   persisted here directly.
--
--   person_direct_video_signals -- the one video where a
--   person is DIRECTLY mentioned (title / tags / description),
--   as opposed to a merely-associated vehicle video (which
--   already lives on `signals` + `vehicle_person_links` and
--   needs no new table either). The video comes from a REAL
--   per-person YouTube search, not a scan of the first N
--   ingested signals, so full video metadata is persisted
--   here directly.
--
-- Both tables are write-once-per-run caches: a POST .../run
-- performs the sequential YouTube search, validates, and
-- upserts the resolved Hook video here. GET reads never
-- search YouTube and never write to the database -- they only
-- read whatever the most recent run persisted. The matched
-- video may or may not already exist in `signals` (search
-- results are not limited to the ingested vehicle-channel
-- pool), so `signal_id` is nullable and full video metadata is
-- always stored, never assumed to be reachable through a
-- `signals` join. The migration runner wraps this file in a
-- transaction, so no BEGIN / COMMIT here.
-- =========================================================

-- =========================================================
-- 1. RUN QUEUES
--
-- Same QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED run-table
-- shape used by every other domain (scanner_runs,
-- country_news_runs, person_radar_runs, fusion_runs): POST
-- .../run inserts a QUEUED row; a worker claims it with
-- FOR UPDATE SKIP LOCKED, executes the sequential YouTube
-- search, and finalizes it. GET .../runs/:id only reads.
-- =========================================================

CREATE TABLE IF NOT EXISTS country_event_video_signal_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  status TEXT NOT NULL DEFAULT 'QUEUED',

  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  entities_attempted INTEGER NOT NULL DEFAULT 0,
  search_query_count INTEGER NOT NULL DEFAULT 0,
  videos_discovered_count INTEGER NOT NULL DEFAULT 0,
  videos_evaluated_count INTEGER NOT NULL DEFAULT 0,
  videos_matched_count INTEGER NOT NULL DEFAULT 0,
  signals_inserted_count INTEGER NOT NULL DEFAULT 0,
  signals_updated_count INTEGER NOT NULL DEFAULT 0,
  no_match_entity_count INTEGER NOT NULL DEFAULT 0,
  quota_units_estimated INTEGER NOT NULL DEFAULT 0,

  error_message TEXT,

  locked_by TEXT,
  locked_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT country_event_video_signal_runs_status_valid
    CHECK (
      status IN (
        'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'
      )
    ),

  CONSTRAINT country_event_video_signal_runs_counts_nonnegative
    CHECK (
      entities_attempted >= 0 AND
      search_query_count >= 0 AND
      videos_discovered_count >= 0 AND
      videos_evaluated_count >= 0 AND
      videos_matched_count >= 0 AND
      signals_inserted_count >= 0 AND
      signals_updated_count >= 0 AND
      no_match_entity_count >= 0 AND
      quota_units_estimated >= 0
    ),

  CONSTRAINT country_event_video_signal_runs_request_payload_is_object
    CHECK (jsonb_typeof(request_payload) = 'object'),

  CONSTRAINT country_event_video_signal_runs_summary_is_object
    CHECK (jsonb_typeof(summary) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_country_event_video_signal_runs_single_active
  ON country_event_video_signal_runs ((1))
  WHERE status IN ('QUEUED', 'RUNNING');

CREATE TABLE IF NOT EXISTS person_direct_video_signal_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  status TEXT NOT NULL DEFAULT 'QUEUED',

  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  entities_attempted INTEGER NOT NULL DEFAULT 0,
  search_query_count INTEGER NOT NULL DEFAULT 0,
  videos_discovered_count INTEGER NOT NULL DEFAULT 0,
  videos_evaluated_count INTEGER NOT NULL DEFAULT 0,
  videos_matched_count INTEGER NOT NULL DEFAULT 0,
  signals_inserted_count INTEGER NOT NULL DEFAULT 0,
  signals_updated_count INTEGER NOT NULL DEFAULT 0,
  no_match_entity_count INTEGER NOT NULL DEFAULT 0,
  quota_units_estimated INTEGER NOT NULL DEFAULT 0,

  error_message TEXT,

  locked_by TEXT,
  locked_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT person_direct_video_signal_runs_status_valid
    CHECK (
      status IN (
        'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'
      )
    ),

  CONSTRAINT person_direct_video_signal_runs_counts_nonnegative
    CHECK (
      entities_attempted >= 0 AND
      search_query_count >= 0 AND
      videos_discovered_count >= 0 AND
      videos_evaluated_count >= 0 AND
      videos_matched_count >= 0 AND
      signals_inserted_count >= 0 AND
      signals_updated_count >= 0 AND
      no_match_entity_count >= 0 AND
      quota_units_estimated >= 0
    ),

  CONSTRAINT person_direct_video_signal_runs_request_payload_is_object
    CHECK (jsonb_typeof(request_payload) = 'object'),

  CONSTRAINT person_direct_video_signal_runs_summary_is_object
    CHECK (jsonb_typeof(summary) = 'object')
);

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_person_direct_video_signal_runs_single_active
  ON person_direct_video_signal_runs ((1))
  WHERE status IN ('QUEUED', 'RUNNING');

-- =========================================================
-- 2. COUNTRY EVENT VIDEO SIGNALS
-- =========================================================

CREATE TABLE IF NOT EXISTS country_event_video_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  country_news_signal_id BIGINT NOT NULL
    REFERENCES country_news_signals(id)
    ON DELETE CASCADE,

  country_id BIGINT NOT NULL
    REFERENCES countries(id)
    ON DELETE CASCADE,

  -- Nullable: a real YouTube search result does not need to
  -- already exist in the ingested `signals` pool. When the
  -- same external_video_id IS already an ingested signal, its
  -- id is carried here for cross-reference; otherwise this
  -- stays NULL and every field the pack needs still lives on
  -- this row directly.
  signal_id BIGINT
    REFERENCES signals(id)
    ON DELETE SET NULL,

  external_video_id TEXT NOT NULL,
  video_title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  video_views BIGINT NOT NULL DEFAULT 0,
  views_per_hour NUMERIC(18, 4),
  published_at TIMESTAMPTZ,
  channel_id TEXT,
  channel_title TEXT,
  duration_seconds INTEGER,
  description_excerpt TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,

  search_query TEXT,

  matched_country_term TEXT,
  matched_event_term TEXT,

  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  resolver_version TEXT NOT NULL
    DEFAULT 'country-event-video-search-v1',

  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT country_event_video_signals_unique
    UNIQUE (country_news_signal_id, external_video_id),

  CONSTRAINT country_event_video_signals_evidence_is_object
    CHECK (jsonb_typeof(evidence) = 'object'),

  CONSTRAINT country_event_video_signals_tags_is_array
    CHECK (jsonb_typeof(tags) = 'array'),

  CONSTRAINT country_event_video_signals_views_nonnegative
    CHECK (video_views >= 0)
);

CREATE INDEX IF NOT EXISTS
  idx_country_event_video_signals_country
  ON country_event_video_signals(country_id);

CREATE INDEX IF NOT EXISTS
  idx_country_event_video_signals_signal
  ON country_event_video_signals(signal_id);

CREATE INDEX IF NOT EXISTS
  idx_country_event_video_signals_country_computed
  ON country_event_video_signals(country_id, computed_at DESC);

-- =========================================================
-- 3. PERSON DIRECT VIDEO SIGNALS
-- =========================================================

CREATE TABLE IF NOT EXISTS person_direct_video_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  person_id BIGINT NOT NULL
    REFERENCES people(id)
    ON DELETE CASCADE,

  -- Nullable for the same reason as
  -- country_event_video_signals.signal_id above.
  signal_id BIGINT
    REFERENCES signals(id)
    ON DELETE SET NULL,

  external_video_id TEXT NOT NULL,
  video_title TEXT NOT NULL,
  video_url TEXT NOT NULL,
  thumbnail_url TEXT,
  video_views BIGINT NOT NULL DEFAULT 0,
  published_at TIMESTAMPTZ,
  channel_id TEXT,
  channel_title TEXT,
  duration_seconds INTEGER,
  description_excerpt TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,

  search_query TEXT,

  matched_alias TEXT NOT NULL,

  direct_mention_field TEXT NOT NULL,

  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  resolver_version TEXT NOT NULL
    DEFAULT 'person-direct-video-search-v1',

  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT person_direct_video_signals_unique
    UNIQUE (person_id, external_video_id),

  CONSTRAINT person_direct_video_signals_field_valid
    CHECK (
      direct_mention_field IN (
        'TITLE',
        'TAGS',
        'DESCRIPTION'
      )
    ),

  CONSTRAINT person_direct_video_signals_evidence_is_object
    CHECK (jsonb_typeof(evidence) = 'object'),

  CONSTRAINT person_direct_video_signals_tags_is_array
    CHECK (jsonb_typeof(tags) = 'array'),

  CONSTRAINT person_direct_video_signals_views_nonnegative
    CHECK (video_views >= 0)
);

CREATE INDEX IF NOT EXISTS
  idx_person_direct_video_signals_person
  ON person_direct_video_signals(person_id);

CREATE INDEX IF NOT EXISTS
  idx_person_direct_video_signals_signal
  ON person_direct_video_signals(signal_id);

CREATE INDEX IF NOT EXISTS
  idx_person_direct_video_signals_person_computed
  ON person_direct_video_signals(person_id, computed_at DESC);

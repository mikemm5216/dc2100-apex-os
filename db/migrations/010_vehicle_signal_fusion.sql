-- =========================================================
-- VEHICLE-CENTERED SIGNAL FUSION
-- Task 3.3F
--
-- Pure aggregation layer over existing evidence: qualified
-- vehicle signals, country-matched country news, and
-- vehicle-person links (current traffic + historical
-- resonance). No new evidence is fetched here — Fusion only
-- reads and scores what the prior radars already persisted.
--
-- The migration runner wraps this file in a transaction,
-- so no BEGIN / COMMIT here.
-- =========================================================

CREATE TABLE IF NOT EXISTS fusion_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  status TEXT NOT NULL DEFAULT 'QUEUED',

  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  vehicle_count INTEGER NOT NULL DEFAULT 0,
  completed_vehicle_count INTEGER NOT NULL DEFAULT 0,
  skipped_vehicle_count INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  candidate_inserted_count INTEGER NOT NULL DEFAULT 0,
  candidate_updated_count INTEGER NOT NULL DEFAULT 0,

  error_message TEXT,

  locked_by TEXT,
  locked_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fusion_runs_status_valid
    CHECK (
      status IN (
        'QUEUED',
        'RUNNING',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    ),

  CONSTRAINT fusion_runs_counts_nonnegative
    CHECK (
      vehicle_count >= 0 AND
      completed_vehicle_count >= 0 AND
      skipped_vehicle_count >= 0 AND
      candidate_count >= 0 AND
      candidate_inserted_count >= 0 AND
      candidate_updated_count >= 0
    )
);

CREATE TABLE IF NOT EXISTS vehicle_fusion_candidates (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  run_id BIGINT NOT NULL
    REFERENCES fusion_runs(id)
    ON DELETE CASCADE,

  vehicle_id BIGINT NOT NULL
    REFERENCES vehicles(id)
    ON DELETE CASCADE,

  country_id BIGINT NOT NULL
    REFERENCES countries(id)
    ON DELETE CASCADE,

  country_news_signal_id BIGINT NOT NULL
    REFERENCES country_news_signals(id)
    ON DELETE CASCADE,

  person_id BIGINT
    REFERENCES people(id)
    ON DELETE SET NULL,

  vehicle_person_link_id BIGINT
    REFERENCES vehicle_person_links(id)
    ON DELETE SET NULL,

  person_link_tier TEXT,

  -- Vehicle Traffic evidence
  qualified_vehicle_signal_count INTEGER NOT NULL DEFAULT 0,
  vehicle_views_total BIGINT NOT NULL DEFAULT 0,
  vehicle_views_max BIGINT NOT NULL DEFAULT 0,
  vehicle_viral_tier TEXT,
  vehicle_traffic_score NUMERIC(6, 2) NOT NULL,

  -- Country News evidence
  country_news_category TEXT NOT NULL,
  country_news_conflict_archetypes JSONB NOT NULL DEFAULT '[]'::jsonb,
  country_news_traffic_proxy_score NUMERIC(6, 2) NOT NULL,

  -- Person Current Traffic evidence
  person_current_traffic_score NUMERIC(6, 2),

  -- Historical Relationship evidence
  person_historical_resonance_score NUMERIC(6, 2),
  person_historical_resonance_tier TEXT,
  relationship_scope TEXT,
  vehicle_person_link_confidence_score NUMERIC(6, 2),

  -- Transformation evidence
  transformation_potential_score NUMERIC(6, 2) NOT NULL,

  -- Fusion result
  fusion_score NUMERIC(6, 2) NOT NULL,
  fusion_version TEXT NOT NULL,
  missing_signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_complete BOOLEAN NOT NULL DEFAULT TRUE,

  fusion_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vehicle_fusion_candidates_person_link_tier_valid
    CHECK (
      person_link_tier IS NULL OR
      person_link_tier IN (
        'EXACT_VEHICLE',
        'SAME_SERIES',
        'SAME_BRAND'
      )
    ),

  CONSTRAINT vehicle_fusion_candidates_person_consistency
    CHECK (
      (
        person_id IS NULL AND
        vehicle_person_link_id IS NULL AND
        person_link_tier IS NULL AND
        person_current_traffic_score IS NULL AND
        person_historical_resonance_score IS NULL AND
        vehicle_person_link_confidence_score IS NULL
      ) OR (
        person_id IS NOT NULL
      )
    ),

  CONSTRAINT vehicle_fusion_candidates_scores_range
    CHECK (
      vehicle_traffic_score >= 0 AND
      vehicle_traffic_score <= 100 AND
      country_news_traffic_proxy_score >= 0 AND
      country_news_traffic_proxy_score <= 100 AND
      transformation_potential_score >= 0 AND
      transformation_potential_score <= 100 AND
      fusion_score >= 0 AND
      fusion_score <= 100 AND
      (
        person_current_traffic_score IS NULL OR
        (
          person_current_traffic_score >= 0 AND
          person_current_traffic_score <= 100
        )
      ) AND
      (
        person_historical_resonance_score IS NULL OR
        (
          person_historical_resonance_score >= 0 AND
          person_historical_resonance_score <= 100
        )
      ) AND
      (
        vehicle_person_link_confidence_score IS NULL OR
        (
          vehicle_person_link_confidence_score >= 0 AND
          vehicle_person_link_confidence_score <= 100
        )
      )
    ),

  CONSTRAINT vehicle_fusion_candidates_counts_nonnegative
    CHECK (
      qualified_vehicle_signal_count >= 0 AND
      vehicle_views_total >= 0 AND
      vehicle_views_max >= 0
    ),

  CONSTRAINT vehicle_fusion_candidates_missing_signals_is_array
    CHECK (jsonb_typeof(missing_signals) = 'array'),

  CONSTRAINT vehicle_fusion_candidates_conflict_archetypes_is_array
    CHECK (jsonb_typeof(country_news_conflict_archetypes) = 'array'),

  CONSTRAINT vehicle_fusion_candidates_evidence_is_object
    CHECK (jsonb_typeof(fusion_evidence) = 'object')
);

-- Candidate uniqueness: (run_id, vehicle_id, country_news_signal_id,
-- person_id) with NULL person_id coalesced so the same
-- evidence combination can never produce duplicate
-- candidates in one run. Re-running upserts, never
-- duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_vehicle_fusion_candidates_identity
  ON vehicle_fusion_candidates (
    run_id,
    vehicle_id,
    country_news_signal_id,
    COALESCE(person_id, -1)
  );

CREATE INDEX IF NOT EXISTS
  idx_vehicle_fusion_candidates_run_id
  ON vehicle_fusion_candidates(run_id);

CREATE INDEX IF NOT EXISTS
  idx_vehicle_fusion_candidates_vehicle_id
  ON vehicle_fusion_candidates(vehicle_id);

CREATE INDEX IF NOT EXISTS
  idx_vehicle_fusion_candidates_fusion_score
  ON vehicle_fusion_candidates(fusion_score DESC);

CREATE INDEX IF NOT EXISTS
  idx_vehicle_fusion_candidates_is_complete
  ON vehicle_fusion_candidates(is_complete, fusion_score DESC);

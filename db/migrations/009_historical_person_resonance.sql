-- =========================================================
-- HISTORICAL PERSON RESONANCE LAYER
-- Task 3.3E.1
--
-- Adds catalog-based historical relationship knowledge to
-- vehicle-person links and person traffic signals.
-- Historical Resonance is curated relationship knowledge:
-- it is NEVER historical traffic and NEVER a 10-year view
-- count. No score is fabricated here — every resonance
-- column starts NULL / empty and is filled by the person
-- resonance resolver on the next Person Radar run.
--
-- The migration runner wraps this file in a transaction,
-- so no BEGIN / COMMIT here.
-- =========================================================

-- =========================================================
-- 1. VEHICLE PERSON LINKS — resonance columns
-- =========================================================

ALTER TABLE vehicle_person_links
  ADD COLUMN IF NOT EXISTS evidence_horizon TEXT,
  ADD COLUMN IF NOT EXISTS iconic_association BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS legacy_association BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS recognition_weight NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS association_start_year SMALLINT,
  ADD COLUMN IF NOT EXISTS association_end_year SMALLINT,
  ADD COLUMN IF NOT EXISTS historical_resonance_score NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS historical_resonance_tier TEXT,
  ADD COLUMN IF NOT EXISTS resonance_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resonance_version TEXT,
  ADD COLUMN IF NOT EXISTS resonance_locked BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'vehicle_person_links_evidence_horizon_valid'
  ) THEN
    ALTER TABLE vehicle_person_links
      ADD CONSTRAINT
        vehicle_person_links_evidence_horizon_valid
      CHECK (
        evidence_horizon IS NULL OR
        evidence_horizon IN (
          'ONE_YEAR',
          'TEN_YEARS',
          'ALL_TIME'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'vehicle_person_links_resonance_tier_valid'
  ) THEN
    ALTER TABLE vehicle_person_links
      ADD CONSTRAINT
        vehicle_person_links_resonance_tier_valid
      CHECK (
        historical_resonance_tier IS NULL OR
        historical_resonance_tier IN (
          'ICONIC',
          'ESTABLISHED',
          'RECOGNIZABLE',
          'NICHE'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'vehicle_person_links_recognition_weight_range'
  ) THEN
    ALTER TABLE vehicle_person_links
      ADD CONSTRAINT
        vehicle_person_links_recognition_weight_range
      CHECK (
        recognition_weight IS NULL OR
        (
          recognition_weight >= 0.0000 AND
          recognition_weight <= 1.0000
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'vehicle_person_links_resonance_score_range'
  ) THEN
    ALTER TABLE vehicle_person_links
      ADD CONSTRAINT
        vehicle_person_links_resonance_score_range
      CHECK (
        historical_resonance_score IS NULL OR
        (
          historical_resonance_score >= 0 AND
          historical_resonance_score <= 100
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'vehicle_person_links_association_years_range'
  ) THEN
    ALTER TABLE vehicle_person_links
      ADD CONSTRAINT
        vehicle_person_links_association_years_range
      CHECK (
        (
          association_start_year IS NULL OR
          (
            association_start_year >= 1880 AND
            association_start_year <= 2100
          )
        ) AND
        (
          association_end_year IS NULL OR
          (
            association_end_year >= 1880 AND
            association_end_year <= 2100
          )
        ) AND
        (
          association_start_year IS NULL OR
          association_end_year IS NULL OR
          association_end_year >=
            association_start_year
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'vehicle_person_links_resonance_evidence_is_object'
  ) THEN
    ALTER TABLE vehicle_person_links
      ADD CONSTRAINT
        vehicle_person_links_resonance_evidence_is_object
      CHECK (
        jsonb_typeof(resonance_evidence) = 'object'
      );
  END IF;
END
$$;

-- =========================================================
-- 2. PERSON TRAFFIC SIGNALS — scope score columns
-- =========================================================

ALTER TABLE person_traffic_signals
  ADD COLUMN IF NOT EXISTS historical_resonance_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS historical_resonance_tiers JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS historical_resonance_score NUMERIC(5, 2),
  ADD COLUMN IF NOT EXISTS historical_resonance_tier TEXT,
  ADD COLUMN IF NOT EXISTS primary_resonance_link_id BIGINT,
  ADD COLUMN IF NOT EXISTS resonance_version TEXT,
  ADD COLUMN IF NOT EXISTS resonance_evidence JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'person_traffic_signals_primary_resonance_link_fk'
  ) THEN
    ALTER TABLE person_traffic_signals
      ADD CONSTRAINT
        person_traffic_signals_primary_resonance_link_fk
      FOREIGN KEY (primary_resonance_link_id)
      REFERENCES vehicle_person_links(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'person_traffic_signals_resonance_scores_is_object'
  ) THEN
    ALTER TABLE person_traffic_signals
      ADD CONSTRAINT
        person_traffic_signals_resonance_scores_is_object
      CHECK (
        jsonb_typeof(historical_resonance_scores) =
          'object'
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'person_traffic_signals_resonance_tiers_is_object'
  ) THEN
    ALTER TABLE person_traffic_signals
      ADD CONSTRAINT
        person_traffic_signals_resonance_tiers_is_object
      CHECK (
        jsonb_typeof(historical_resonance_tiers) =
          'object'
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'person_traffic_signals_resonance_evidence_is_object'
  ) THEN
    ALTER TABLE person_traffic_signals
      ADD CONSTRAINT
        person_traffic_signals_resonance_evidence_is_object
      CHECK (
        jsonb_typeof(resonance_evidence) = 'object'
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'person_traffic_signals_resonance_score_range'
  ) THEN
    ALTER TABLE person_traffic_signals
      ADD CONSTRAINT
        person_traffic_signals_resonance_score_range
      CHECK (
        historical_resonance_score IS NULL OR
        (
          historical_resonance_score >= 0 AND
          historical_resonance_score <= 100
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname =
      'person_traffic_signals_resonance_tier_valid'
  ) THEN
    ALTER TABLE person_traffic_signals
      ADD CONSTRAINT
        person_traffic_signals_resonance_tier_valid
      CHECK (
        historical_resonance_tier IS NULL OR
        historical_resonance_tier IN (
          'ICONIC',
          'ESTABLISHED',
          'RECOGNIZABLE',
          'NICHE'
        )
      );
  END IF;
END
$$;

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS
  idx_vehicle_person_links_evidence_horizon
  ON vehicle_person_links(evidence_horizon);

CREATE INDEX IF NOT EXISTS
  idx_vehicle_person_links_resonance_score
  ON vehicle_person_links(
    historical_resonance_score DESC
  );

CREATE INDEX IF NOT EXISTS
  idx_vehicle_person_links_resonance_tier
  ON vehicle_person_links(historical_resonance_tier);

CREATE INDEX IF NOT EXISTS
  idx_person_traffic_signals_resonance_score
  ON person_traffic_signals(
    historical_resonance_score DESC
  );

CREATE INDEX IF NOT EXISTS
  idx_person_traffic_signals_resonance_tier
  ON person_traffic_signals(
    historical_resonance_tier,
    historical_resonance_score DESC
  );

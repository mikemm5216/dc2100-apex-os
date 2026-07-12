-- =========================================================
-- VEHICLE ENTITY + COUNTRY RESOLVER
-- Task 3.3C
--
-- Adds deterministic vehicle entity resolution columns to
-- signals. The migration runner wraps this file in a
-- transaction, so no BEGIN / COMMIT here.
-- =========================================================

-- Brand origin countries required by the vehicle catalog.
INSERT INTO countries (code, name, enabled)
VALUES
  ('IT', 'Italy', TRUE),
  ('KR', 'South Korea', TRUE),
  ('FR', 'France', TRUE),
  ('SE', 'Sweden', TRUE),
  ('HR', 'Croatia', TRUE)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS vehicle_brand TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_series TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_model TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_type TEXT,
  ADD COLUMN IF NOT EXISTS vehicle_action TEXT,
  ADD COLUMN IF NOT EXISTS resolved_vehicle_id BIGINT,
  ADD COLUMN IF NOT EXISTS resolved_country_id BIGINT,
  ADD COLUMN IF NOT EXISTS conflict_keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS entity_resolution_status TEXT NOT NULL DEFAULT 'UNRESOLVED',
  ADD COLUMN IF NOT EXISTS entity_confidence NUMERIC(5, 4),
  ADD COLUMN IF NOT EXISTS entity_match_method TEXT,
  ADD COLUMN IF NOT EXISTS entity_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS entity_resolver_version TEXT,
  ADD COLUMN IF NOT EXISTS entity_locked BOOLEAN NOT NULL DEFAULT FALSE;

-- =========================================================
-- FOREIGN KEYS
-- =========================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'signals_resolved_vehicle_fk'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_resolved_vehicle_fk
      FOREIGN KEY (resolved_vehicle_id)
      REFERENCES vehicles(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'signals_resolved_country_fk'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_resolved_country_fk
      FOREIGN KEY (resolved_country_id)
      REFERENCES countries(id)
      ON DELETE SET NULL;
  END IF;
END
$$;

-- =========================================================
-- CONSTRAINTS
-- =========================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'signals_entity_resolution_status_valid'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_entity_resolution_status_valid
      CHECK (
        entity_resolution_status IN (
          'RESOLVED',
          'BRAND_ONLY',
          'AMBIGUOUS',
          'UNRESOLVED',
          'NOT_APPLICABLE'
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
    WHERE conname = 'signals_entity_confidence_range'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_entity_confidence_range
      CHECK (
        entity_confidence IS NULL OR
        (
          entity_confidence >= 0.0000 AND
          entity_confidence <= 1.0000
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
    WHERE conname = 'signals_entity_match_method_valid'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_entity_match_method_valid
      CHECK (
        entity_match_method IS NULL OR
        entity_match_method IN (
          'MODEL_ALIAS',
          'SERIES_ALIAS',
          'BRAND_ALIAS',
          'UNIQUE_MODEL_ALIAS',
          'SOURCE_PRIOR',
          'MANUAL',
          'NONE'
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
    WHERE conname = 'signals_conflict_keywords_is_array'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_conflict_keywords_is_array
      CHECK (
        jsonb_typeof(conflict_keywords) = 'array'
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'signals_entity_evidence_is_object'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_entity_evidence_is_object
      CHECK (
        jsonb_typeof(entity_evidence) = 'object'
      );
  END IF;
END
$$;

-- =========================================================
-- BACKFILL
--
-- Entity resolution has not run yet, so no brand / model /
-- confidence values are fabricated here. Long videos are
-- out of resolver scope; Shorts wait for the next scan.
-- =========================================================

UPDATE signals
SET
  entity_resolution_status = CASE
    WHEN is_short THEN 'UNRESOLVED'
    ELSE 'NOT_APPLICABLE'
  END,
  entity_match_method = CASE
    WHEN is_short THEN NULL
    ELSE 'NONE'
  END;

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_signals_entity_resolution_status
  ON signals(entity_resolution_status);

CREATE INDEX IF NOT EXISTS idx_signals_vehicle_brand
  ON signals(vehicle_brand)
  WHERE vehicle_brand IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signals_resolved_country_id
  ON signals(resolved_country_id)
  WHERE resolved_country_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signals_vehicle_type
  ON signals(vehicle_type)
  WHERE vehicle_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signals_vehicle_action
  ON signals(vehicle_action)
  WHERE vehicle_action IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_signals_resolved_vehicle_id
  ON signals(resolved_vehicle_id)
  WHERE resolved_vehicle_id IS NOT NULL;

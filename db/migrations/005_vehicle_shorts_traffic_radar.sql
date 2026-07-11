-- =========================================================
-- VEHICLE SHORTS TRAFFIC RADAR
-- Task 3.3B
--
-- Adds Shorts classification, traffic metrics, and viral
-- tier columns to signals, then backfills existing rows.
-- The migration runner wraps this file in a transaction,
-- so no BEGIN / COMMIT here.
-- =========================================================

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS is_short BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS short_format TEXT NOT NULL DEFAULT 'NOT_SHORT',
  ADD COLUMN IF NOT EXISTS short_rejection_reason TEXT,
  ADD COLUMN IF NOT EXISTS views_per_hour NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS viral_tier TEXT NOT NULL DEFAULT 'UNQUALIFIED';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'signals_short_format_valid'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_short_format_valid
      CHECK (
        short_format IN (
          'CLASSIC_SHORT',
          'EXTENDED_SHORT',
          'NOT_SHORT'
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
    WHERE conname = 'signals_short_rejection_reason_valid'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_short_rejection_reason_valid
      CHECK (
        short_rejection_reason IS NULL OR
        short_rejection_reason IN (
          'MISSING_DURATION',
          'ZERO_DURATION',
          'OVER_180_SECONDS'
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
    WHERE conname = 'signals_viral_tier_valid'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_viral_tier_valid
      CHECK (
        viral_tier IN (
          'PROVEN',
          'RISING',
          'WATCH',
          'UNQUALIFIED'
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
    WHERE conname = 'signals_views_per_hour_nonnegative'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_views_per_hour_nonnegative
      CHECK (
        views_per_hour IS NULL OR
        views_per_hour >= 0
      );
  END IF;
END
$$;

-- =========================================================
-- BACKFILL: Shorts classification from stored duration
-- =========================================================

UPDATE signals
SET
  is_short = (
    duration_seconds IS NOT NULL AND
    duration_seconds >= 1 AND
    duration_seconds <= 180
  ),

  short_format = CASE
    WHEN duration_seconds IS NULL
      OR duration_seconds <= 0
      THEN 'NOT_SHORT'
    WHEN duration_seconds <= 60
      THEN 'CLASSIC_SHORT'
    WHEN duration_seconds <= 180
      THEN 'EXTENDED_SHORT'
    ELSE 'NOT_SHORT'
  END,

  short_rejection_reason = CASE
    WHEN duration_seconds IS NULL
      THEN 'MISSING_DURATION'
    WHEN duration_seconds < 0
      THEN 'MISSING_DURATION'
    WHEN duration_seconds = 0
      THEN 'ZERO_DURATION'
    WHEN duration_seconds > 180
      THEN 'OVER_180_SECONDS'
    ELSE NULL
  END;

-- =========================================================
-- BACKFILL: views_per_hour
-- age_hours = max((now - published_at) / 1 hour, 1)
-- =========================================================

UPDATE signals
SET views_per_hour = ROUND(
  views::numeric /
  GREATEST(
    EXTRACT(
      EPOCH FROM (NOW() - published_at)
    ) / 3600.0,
    1
  ),
  4
)
WHERE published_at IS NOT NULL;

-- =========================================================
-- BACKFILL: viral tier + qualification
--
-- Non-Shorts (including existing 9-18 minute long-form
-- records) become viral_tier = UNQUALIFIED and
-- qualified = FALSE.
-- =========================================================

UPDATE signals s
SET
  viral_tier = t.tier,
  qualified = (t.tier IN ('PROVEN', 'RISING'))
FROM (
  SELECT
    id,
    CASE
      WHEN NOT computed.is_short
        THEN 'UNQUALIFIED'
      WHEN computed.views >= 1000000
        THEN 'PROVEN'
      WHEN computed.views >= 100000
        AND computed.age_days IS NOT NULL
        AND computed.age_days <= 14
        AND (computed.views / computed.age_days) >= 50000
        THEN 'RISING'
      WHEN computed.views >= 25000
        AND computed.age_days IS NOT NULL
        AND computed.age_days <= 7
        AND (computed.views / computed.age_days) >= 10000
        THEN 'WATCH'
      ELSE 'UNQUALIFIED'
    END AS tier
  FROM (
    SELECT
      id,
      (
        duration_seconds IS NOT NULL AND
        duration_seconds >= 1 AND
        duration_seconds <= 180
      ) AS is_short,
      views::numeric AS views,
      CASE
        WHEN published_at IS NULL THEN NULL
        ELSE GREATEST(
          EXTRACT(
            EPOCH FROM (NOW() - published_at)
          ) / 86400.0,
          1.0 / 24.0
        )
      END AS age_days
    FROM signals
  ) computed
) t
WHERE s.id = t.id;

-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_signals_is_short_views
  ON signals(is_short, views DESC);

CREATE INDEX IF NOT EXISTS idx_signals_viral_tier_views
  ON signals(viral_tier, views DESC);

CREATE INDEX IF NOT EXISTS idx_signals_published_at
  ON signals(published_at DESC);

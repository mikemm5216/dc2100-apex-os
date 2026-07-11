-- =========================================================
-- VIRAL SCANNER FOUNDATION
-- =========================================================

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS youtube_channel_id TEXT,
  ADD COLUMN IF NOT EXISTS youtube_uploads_playlist_id TEXT,
  ADD COLUMN IF NOT EXISTS last_scan_status TEXT,
  ADD COLUMN IF NOT EXISTS last_scan_error TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'sources_last_scan_status_valid'
  ) THEN
    ALTER TABLE sources
      ADD CONSTRAINT sources_last_scan_status_valid
      CHECK (
        last_scan_status IS NULL OR
        last_scan_status IN (
          'PENDING',
          'RUNNING',
          'SUCCESS',
          'FAILED',
          'SKIPPED'
        )
      );
  END IF;
END
$$;

ALTER TABLE signals
  ADD COLUMN IF NOT EXISTS channel_id TEXT,
  ADD COLUMN IF NOT EXISTS channel_title TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_url TEXT,
  ADD COLUMN IF NOT EXISTS qualified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS rank_score NUMERIC(18, 4),
  ADD COLUMN IF NOT EXISTS last_scanned_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'signals_rank_score_nonnegative'
  ) THEN
    ALTER TABLE signals
      ADD CONSTRAINT signals_rank_score_nonnegative
      CHECK (
        rank_score IS NULL OR rank_score >= 0
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS scanner_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  status TEXT NOT NULL DEFAULT 'QUEUED',

  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  source_count INTEGER NOT NULL DEFAULT 0,
  resolved_source_count INTEGER NOT NULL DEFAULT 0,
  failed_source_count INTEGER NOT NULL DEFAULT 0,

  video_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  qualified_count INTEGER NOT NULL DEFAULT 0,

  quota_units_estimated INTEGER NOT NULL DEFAULT 0,

  error_message TEXT,

  locked_by TEXT,
  locked_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT scanner_runs_status_valid
    CHECK (
      status IN (
        'QUEUED',
        'RUNNING',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    ),

  CONSTRAINT scanner_runs_counts_nonnegative
    CHECK (
      source_count >= 0 AND
      resolved_source_count >= 0 AND
      failed_source_count >= 0 AND
      video_count >= 0 AND
      inserted_count >= 0 AND
      updated_count >= 0 AND
      qualified_count >= 0 AND
      quota_units_estimated >= 0
    )
);

CREATE TABLE IF NOT EXISTS signal_metric_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  signal_id BIGINT NOT NULL
    REFERENCES signals(id)
    ON DELETE CASCADE,

  views BIGINT NOT NULL,

  raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,

  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT signal_metric_snapshots_views_nonnegative
    CHECK (views >= 0)
);

CREATE INDEX IF NOT EXISTS idx_sources_youtube_channel_id
  ON sources(youtube_channel_id)
  WHERE youtube_channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sources_scan_status
  ON sources(last_scan_status);

CREATE INDEX IF NOT EXISTS idx_signals_qualified_rank
  ON signals(qualified, rank_score DESC);

CREATE INDEX IF NOT EXISTS idx_signals_views_per_day
  ON signals(views_per_day DESC);

CREATE INDEX IF NOT EXISTS idx_signals_last_scanned_at
  ON signals(last_scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_scanner_runs_status_created
  ON scanner_runs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_signal_snapshots_signal_time
  ON signal_metric_snapshots(signal_id, captured_at DESC);

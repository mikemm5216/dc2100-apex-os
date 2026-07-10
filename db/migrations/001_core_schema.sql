
-- =========================================================
-- 1. COUNTRIES
-- 國家參考資料
-- =========================================================

CREATE TABLE countries (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(8) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT countries_code_uppercase
    CHECK (code = UPPER(code))
);


-- =========================================================
-- 2. VEHICLES
-- 車輛參考資料
-- MVP 階段只放基本資料，不做完整 Vehicle Bible
-- =========================================================

CREATE TABLE vehicles (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  manufacturer TEXT,
  country_id BIGINT REFERENCES countries(id) ON DELETE SET NULL,
  category TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT vehicles_code_uppercase
    CHECK (code = UPPER(code))
);


-- =========================================================
-- 3. SOURCES
-- YouTube / News / Social 等情報來源
-- =========================================================

CREATE TABLE sources (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  category TEXT NOT NULL,
  country_id BIGINT REFERENCES countries(id) ON DELETE SET NULL,
  priority SMALLINT NOT NULL DEFAULT 3,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_scan_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sources_priority_range
    CHECK (priority BETWEEN 1 AND 5)
);


-- =========================================================
-- 4. SIGNALS
-- Scanner 抓到的候選爆點
-- =========================================================

CREATE TABLE signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_id BIGINT REFERENCES sources(id) ON DELETE SET NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  views BIGINT NOT NULL DEFAULT 0,
  views_per_day NUMERIC(18, 2),
  age_hours NUMERIC(18, 2),
  growth_velocity NUMERIC(18, 4),
  raw_metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT signals_duration_nonnegative
    CHECK (duration_seconds IS NULL OR duration_seconds >= 0),

  CONSTRAINT signals_views_nonnegative
    CHECK (views >= 0),

  CONSTRAINT signals_views_per_day_nonnegative
    CHECK (views_per_day IS NULL OR views_per_day >= 0),

  CONSTRAINT signals_age_hours_nonnegative
    CHECK (age_hours IS NULL OR age_hours >= 0),

  CONSTRAINT signals_source_external_unique
    UNIQUE (source_id, external_id)
);


-- =========================================================
-- 5. CONTENTS
-- DC 2100 正式內容候選
-- =========================================================

CREATE TABLE contents (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  content_id TEXT NOT NULL UNIQUE,

  signal_id BIGINT REFERENCES signals(id) ON DELETE SET NULL,
  country_id BIGINT REFERENCES countries(id) ON DELETE SET NULL,
  vehicle_id BIGINT REFERENCES vehicles(id) ON DELETE SET NULL,

  title TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'DISCOVERED',

  priority SMALLINT NOT NULL DEFAULT 3,

  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT contents_content_id_format
    CHECK (
      content_id ~ '^P0-[A-Z0-9]+-[A-Z0-9]+-[0-9]{3,}$'
    ),

  CONSTRAINT contents_priority_range
    CHECK (priority BETWEEN 1 AND 5),

  CONSTRAINT contents_status_valid
    CHECK (
      status IN (
        'DISCOVERED',
        'ANALYZED',
        'RECOMMENDED',
        'CEO_APPROVED',
        'PACK_READY',
        'GENERATING',
        'UPLOADED',
        'QA_APPROVED',
        'SCHEDULED',
        'PUBLISHED',
        'ANALYZING',
        'WINNER',
        'RESERVE_SIGNAL',
        'ARCHIVED'
      )
    )
);


-- =========================================================
-- 6. CONTENT STATUS HISTORY
-- 每一次狀態變更都留下紀錄
-- =========================================================

CREATE TABLE content_status_history (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  content_id BIGINT NOT NULL
    REFERENCES contents(id)
    ON DELETE CASCADE,

  from_status TEXT,

  to_status TEXT NOT NULL,

  changed_by TEXT NOT NULL DEFAULT 'system',

  reason TEXT,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT content_history_from_status_valid
    CHECK (
      from_status IS NULL OR
      from_status IN (
        'DISCOVERED',
        'ANALYZED',
        'RECOMMENDED',
        'CEO_APPROVED',
        'PACK_READY',
        'GENERATING',
        'UPLOADED',
        'QA_APPROVED',
        'SCHEDULED',
        'PUBLISHED',
        'ANALYZING',
        'WINNER',
        'RESERVE_SIGNAL',
        'ARCHIVED'
      )
    ),

  CONSTRAINT content_history_to_status_valid
    CHECK (
      to_status IN (
        'DISCOVERED',
        'ANALYZED',
        'RECOMMENDED',
        'CEO_APPROVED',
        'PACK_READY',
        'GENERATING',
        'UPLOADED',
        'QA_APPROVED',
        'SCHEDULED',
        'PUBLISHED',
        'ANALYZING',
        'WINNER',
        'RESERVE_SIGNAL',
        'ARCHIVED'
      )
    )
);


-- =========================================================
-- INDEXES
-- 讓未來 Dashboard 查詢與排序更快
-- =========================================================

CREATE INDEX idx_sources_enabled
  ON sources(enabled);

CREATE INDEX idx_signals_source_id
  ON signals(source_id);

CREATE INDEX idx_signals_published_at
  ON signals(published_at DESC);

CREATE INDEX idx_signals_growth_velocity
  ON signals(growth_velocity DESC);

CREATE INDEX idx_contents_status
  ON contents(status);

CREATE INDEX idx_contents_priority
  ON contents(priority);

CREATE INDEX idx_contents_signal_id
  ON contents(signal_id);

CREATE INDEX idx_contents_created_at
  ON contents(created_at DESC);

CREATE INDEX idx_content_status_history_content_id
  ON content_status_history(content_id);

CREATE INDEX idx_content_status_history_changed_at
  ON content_status_history(changed_at DESC);


-- =========================================================
-- AUTO UPDATE updated_at
-- 資料被修改時，自動更新時間
-- =========================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TRIGGER countries_set_updated_at
BEFORE UPDATE ON countries
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();


CREATE TRIGGER vehicles_set_updated_at
BEFORE UPDATE ON vehicles
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();


CREATE TRIGGER sources_set_updated_at
BEFORE UPDATE ON sources
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();


CREATE TRIGGER signals_set_updated_at
BEFORE UPDATE ON signals
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();


CREATE TRIGGER contents_set_updated_at
BEFORE UPDATE ON contents
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();



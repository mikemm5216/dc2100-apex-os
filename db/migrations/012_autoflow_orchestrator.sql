-- =========================================================
-- AUTOFLOW ORCHESTRATOR
-- Task 3.3G.1
--
-- Pure orchestration layer over the four existing, already
-- accepted domains (Scanner, Country News Radar, Person
-- Radar, Fusion). This migration only adds new tables that
-- track AutoFlow run/step/event state. It does not touch
-- scanner_runs, country_news_runs, person_radar_runs,
-- fusion_runs, or any other existing table.
--
-- Vehicle Resolver and Historical Resonance are not
-- independent domains — Vehicle Resolver already runs inside
-- a scanner_runs run, and Historical Resonance already runs
-- inside a person_radar_runs run. They are represented below
-- as virtual (non-orchestrated) display steps whose status/
-- input/output are reported from their parent step, not as
-- their own queue.
--
-- The migration runner wraps this file in a transaction, so
-- no BEGIN / COMMIT here.
-- =========================================================

CREATE TABLE IF NOT EXISTS autoflow_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  status TEXT NOT NULL DEFAULT 'QUEUED',
  current_step TEXT,

  trigger_type TEXT NOT NULL DEFAULT 'MANUAL',
  requested_by TEXT,
  idempotency_key TEXT,

  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,

  failure_step TEXT,
  error_message TEXT,

  cancel_requested_at TIMESTAMPTZ,

  locked_by TEXT,
  locked_at TIMESTAMPTZ,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT autoflow_runs_status_valid
    CHECK (
      status IN (
        'QUEUED',
        'RUNNING',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    ),

  CONSTRAINT autoflow_runs_current_step_valid
    CHECK (
      current_step IS NULL OR
      current_step IN (
        'SCANNER',
        'COUNTRY_NEWS_RADAR',
        'PERSON_RADAR',
        'FUSION'
      )
    ),

  -- v1 lock-down: AutoFlow is manually triggered only. No
  -- cron, no scheduler. trigger_type is NOT NULL with a
  -- default, so this comparison can never see NULL/UNKNOWN.
  CONSTRAINT autoflow_runs_trigger_type_valid
    CHECK (trigger_type = 'MANUAL'),

  CONSTRAINT autoflow_runs_failure_step_valid
    CHECK (
      failure_step IS NULL OR
      failure_step IN (
        'SCANNER',
        'COUNTRY_NEWS_RADAR',
        'PERSON_RADAR',
        'FUSION'
      )
    ),

  CONSTRAINT autoflow_runs_request_payload_is_object
    CHECK (jsonb_typeof(request_payload) = 'object'),

  CONSTRAINT autoflow_runs_summary_is_object
    CHECK (jsonb_typeof(summary) = 'object')
);

-- DB-level guarantee that at most one AutoFlow run is
-- QUEUED or RUNNING at any time. Every row that matches the
-- WHERE predicate indexes to the same constant (1), so a
-- second matching row can never be inserted. This is
-- deliberately stronger than the API-level 409 check used by
-- the existing domains, because AutoFlow is the top-level
-- conductor and duplicate/conflicting runs must be impossible
-- at the database layer, not just discouraged at the API.
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_autoflow_runs_single_active
  ON autoflow_runs ((1))
  WHERE status IN ('QUEUED', 'RUNNING');

-- Idempotent trigger requests: a repeated POST with the same
-- idempotency_key must resolve to the same run, never a
-- duplicate row. NULL keys are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_autoflow_runs_idempotency_key
  ON autoflow_runs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  idx_autoflow_runs_status_created_at
  ON autoflow_runs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS autoflow_run_steps (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  run_id BIGINT NOT NULL
    REFERENCES autoflow_runs(id)
    ON DELETE CASCADE,

  step_key TEXT NOT NULL,
  step_order SMALLINT NOT NULL,
  is_orchestrated BOOLEAN NOT NULL,
  parent_step_key TEXT,

  domain_run_table TEXT,
  domain_run_id BIGINT,

  status TEXT NOT NULL DEFAULT 'PENDING',

  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Single source of truth for the six fixed display steps:
  -- pins step_order, orchestration flag, parent step, and
  -- target domain run table per step_key in one place, so no
  -- two constraints can ever drift apart on the same fact.
  --
  -- Written as a simple CASE on step_key rather than a flat
  -- OR of ANDs: PostgreSQL CHECK treats an UNKNOWN (NULL)
  -- result as passing, and plain `=`/`<>` against a nullable
  -- column (parent_step_key, domain_run_table) yields UNKNOWN
  -- when that column is NULL — a NULL parent_step_key or
  -- domain_run_table would silently satisfy an OR-branch
  -- built on `column = literal` instead of being rejected.
  -- Every nullable-column comparison below therefore uses
  -- IS NULL / IS NOT DISTINCT FROM, which always evaluates to
  -- TRUE or FALSE, never UNKNOWN. The simple CASE itself is
  -- also NULL-safe: step_key is NOT NULL, so exactly one WHEN
  -- matches, or ELSE FALSE is hit for any unlisted value —
  -- there is no way to fall through to an implicit pass.
  CONSTRAINT autoflow_run_steps_step_key_shape_valid
    CHECK (
      CASE step_key
        WHEN 'SCANNER' THEN
          step_order = 1 AND
          is_orchestrated = TRUE AND
          parent_step_key IS NULL AND
          domain_run_table IS NOT DISTINCT FROM 'scanner_runs'
        WHEN 'VEHICLE_RESOLVER' THEN
          step_order = 2 AND
          is_orchestrated = FALSE AND
          parent_step_key IS NOT DISTINCT FROM 'SCANNER' AND
          domain_run_table IS NULL
        WHEN 'COUNTRY_NEWS_RADAR' THEN
          step_order = 3 AND
          is_orchestrated = TRUE AND
          parent_step_key IS NULL AND
          domain_run_table IS NOT DISTINCT FROM 'country_news_runs'
        WHEN 'PERSON_RADAR' THEN
          step_order = 4 AND
          is_orchestrated = TRUE AND
          parent_step_key IS NULL AND
          domain_run_table IS NOT DISTINCT FROM 'person_radar_runs'
        WHEN 'HISTORICAL_RESONANCE' THEN
          step_order = 5 AND
          is_orchestrated = FALSE AND
          parent_step_key IS NOT DISTINCT FROM 'PERSON_RADAR' AND
          domain_run_table IS NULL
        WHEN 'FUSION' THEN
          step_order = 6 AND
          is_orchestrated = TRUE AND
          parent_step_key IS NULL AND
          domain_run_table IS NOT DISTINCT FROM 'fusion_runs'
        ELSE FALSE
      END
    ),

  -- Virtual steps (Vehicle Resolver, Historical Resonance)
  -- never get their own domain run — their status/output are
  -- always reported from their parent step.
  CONSTRAINT autoflow_run_steps_domain_run_id_virtual_null
    CHECK (
      is_orchestrated = TRUE OR
      domain_run_id IS NULL
    ),

  CONSTRAINT autoflow_run_steps_status_valid
    CHECK (
      status IN (
        'PENDING',
        'QUEUED',
        'RUNNING',
        'COMPLETED',
        'FAILED',
        'SKIPPED',
        'CANCELLED'
      )
    ),

  CONSTRAINT autoflow_run_steps_input_snapshot_is_object
    CHECK (jsonb_typeof(input_snapshot) = 'object'),

  CONSTRAINT autoflow_run_steps_output_summary_is_object
    CHECK (jsonb_typeof(output_summary) = 'object'),

  -- No duplicate step_key within a run. Combined with
  -- step_key_shape_valid pinning step_order to step_key, this
  -- also guarantees step_order is unique per run.
  CONSTRAINT autoflow_run_steps_unique_per_run
    UNIQUE (run_id, step_key)
);

CREATE INDEX IF NOT EXISTS
  idx_autoflow_run_steps_run_id_step_order
  ON autoflow_run_steps (run_id, step_order);

CREATE TABLE IF NOT EXISTS autoflow_run_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  run_id BIGINT NOT NULL
    REFERENCES autoflow_runs(id)
    ON DELETE CASCADE,

  step_key TEXT,

  event_type TEXT NOT NULL,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT autoflow_run_events_step_key_valid
    CHECK (
      step_key IS NULL OR
      step_key IN (
        'SCANNER',
        'VEHICLE_RESOLVER',
        'COUNTRY_NEWS_RADAR',
        'PERSON_RADAR',
        'HISTORICAL_RESONANCE',
        'FUSION'
      )
    ),

  CONSTRAINT autoflow_run_events_payload_is_object
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS
  idx_autoflow_run_events_run_id_created_at
  ON autoflow_run_events (run_id, created_at);

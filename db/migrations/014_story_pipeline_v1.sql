-- =========================================================
-- STORY / OUTLINE / SCRIPT PIPELINE V1
-- Task 3.4E
--
-- Human-gated pipeline that turns an already-persisted Fusion
-- Candidate (vehicle_fusion_candidates, Task 3.3F) into four
-- Story Directions, one locked Story Outline, and one locked
-- Script -- never touching the original Fusion Candidate row.
--
-- This migration only adds new tables. It does not alter
-- vehicle_fusion_candidates, fusion_runs, or any other
-- existing table.
--
-- The migration runner wraps this file in a transaction, so
-- no BEGIN / COMMIT here.
-- =========================================================

CREATE TABLE IF NOT EXISTS story_pipeline_runs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  idempotency_key TEXT,

  fusion_candidate_id BIGINT NOT NULL
    REFERENCES vehicle_fusion_candidates(id)
    ON DELETE RESTRICT,

  status TEXT NOT NULL DEFAULT 'AWAITING_CANDIDATE_APPROVAL',
  current_stage TEXT NOT NULL DEFAULT 'AWAITING_CANDIDATE_APPROVAL',

  -- Immutable evidence snapshot, captured once at creation.
  -- Every later stage reads only from this column, never from
  -- a fresh vehicle_fusion_candidates lookup.
  candidate_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  candidate_snapshot_hash TEXT,

  canon_version TEXT,
  rules_version TEXT,
  season_version TEXT,
  canon_hash TEXT,

  candidate_slot_id TEXT,
  beat_id TEXT,
  apex_stage TEXT,
  creator_notes TEXT,
  forbidden_elements JSONB NOT NULL DEFAULT '[]'::jsonb,
  review_language TEXT,
  script_language TEXT,

  selected_direction_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  selection_mode TEXT,
  merge_notes TEXT,
  selected_script_id BIGINT,

  failure_stage TEXT,
  error_code TEXT,
  error_message TEXT,

  worker_id TEXT,
  lease_expires_at TIMESTAMPTZ,

  -- attempt_count: total Claim count across the entire Run's
  -- lifetime (all stages combined), for observability only.
  -- stage_attempt_count: Claim count for the CURRENT stage
  -- only, reset to 0 every time the run enters a new
  -- QUEUED_* stage (first entry, advance to the next stage,
  -- or Regenerate). The 3-attempt ceiling in engine.js is
  -- enforced against stage_attempt_count, never attempt_count
  -- -- otherwise a normal DIRECTIONS -> OUTLINE -> SCRIPTS run
  -- would already be at 3 by the time it reaches Scripts and
  -- Regenerate/Resume would immediately exceed the ceiling.
  attempt_count INTEGER NOT NULL DEFAULT 0,
  stage_attempt_count INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,

  CONSTRAINT story_pipeline_runs_status_valid
    CHECK (
      status IN (
        'AWAITING_CANDIDATE_APPROVAL',
        'QUEUED_DIRECTIONS',
        'GENERATING_DIRECTIONS',
        'AWAITING_DIRECTION_SELECTION',
        'QUEUED_OUTLINE',
        'GENERATING_OUTLINE',
        'AWAITING_OUTLINE_LOCK',
        'QUEUED_SCRIPTS',
        'GENERATING_SCRIPTS',
        'AWAITING_SCRIPT_LOCK',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    ),

  CONSTRAINT story_pipeline_runs_current_stage_valid
    CHECK (
      current_stage IN (
        'AWAITING_CANDIDATE_APPROVAL',
        'QUEUED_DIRECTIONS',
        'GENERATING_DIRECTIONS',
        'AWAITING_DIRECTION_SELECTION',
        'QUEUED_OUTLINE',
        'GENERATING_OUTLINE',
        'AWAITING_OUTLINE_LOCK',
        'QUEUED_SCRIPTS',
        'GENERATING_SCRIPTS',
        'AWAITING_SCRIPT_LOCK',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    ),

  CONSTRAINT story_pipeline_runs_apex_stage_valid
    CHECK (
      apex_stage IS NULL OR
      apex_stage IN (
        'GLOBAL_QUALIFIERS',
        'REGIONAL_QUALIFIERS',
        'UNDERGROUND_CIRCUIT',
        'APEX_WORLD_TOUR',
        'FINAL_CHAMPIONSHIP'
      )
    ),

  CONSTRAINT story_pipeline_runs_candidate_slot_id_valid
    CHECK (
      candidate_slot_id IS NULL OR
      candidate_slot_id ~ '^CANDIDATE_SLOT_(0[1-9]|1[0-5])$'
    ),

  CONSTRAINT story_pipeline_runs_beat_id_valid
    CHECK (
      beat_id IS NULL OR
      beat_id ~ '^BEAT-(0[1-9]|1[0-5])$'
    ),

  CONSTRAINT story_pipeline_runs_candidate_snapshot_is_object
    CHECK (jsonb_typeof(candidate_snapshot) = 'object'),

  CONSTRAINT story_pipeline_runs_forbidden_elements_is_array
    CHECK (jsonb_typeof(forbidden_elements) = 'array'),

  CONSTRAINT story_pipeline_runs_selected_direction_ids_is_array
    CHECK (jsonb_typeof(selected_direction_ids) = 'array'),

  CONSTRAINT story_pipeline_runs_selection_mode_valid
    CHECK (
      selection_mode IS NULL OR
      selection_mode IN ('SINGLE', 'MERGE')
    ),

  CONSTRAINT story_pipeline_runs_attempt_count_nonnegative
    CHECK (attempt_count >= 0),

  CONSTRAINT story_pipeline_runs_stage_attempt_count_nonnegative
    CHECK (stage_attempt_count >= 0)
);

-- Idempotent create requests: a repeated POST with the same
-- Idempotency-Key must resolve to the same run, never a
-- duplicate row. NULL keys are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_story_pipeline_runs_idempotency_key
  ON story_pipeline_runs (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Same Fusion Candidate can have at most one Active Story Run
-- at a time. Active = every status except the three terminal
-- ones.
CREATE UNIQUE INDEX IF NOT EXISTS
  idx_story_pipeline_runs_fusion_candidate_active
  ON story_pipeline_runs (fusion_candidate_id)
  WHERE status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED');

CREATE INDEX IF NOT EXISTS
  idx_story_pipeline_runs_status_created_at
  ON story_pipeline_runs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS
  idx_story_pipeline_runs_lease_expires_at
  ON story_pipeline_runs (lease_expires_at)
  WHERE lease_expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS story_directions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  story_run_id BIGINT NOT NULL
    REFERENCES story_pipeline_runs(id)
    ON DELETE CASCADE,

  version INTEGER NOT NULL,
  direction_key TEXT NOT NULL,
  direction_type TEXT NOT NULL,

  payload JSONB NOT NULL,

  validation_status TEXT NOT NULL DEFAULT 'PASS',
  validation_issues JSONB NOT NULL DEFAULT '[]'::jsonb,

  superseded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT story_directions_direction_type_valid
    CHECK (
      direction_type IN (
        'VEHICLE_POWER',
        'COUNTRY_CONFLICT',
        'PERSON_CULTURE',
        'APEX_PROGRESSION'
      )
    ),

  CONSTRAINT story_directions_validation_status_valid
    CHECK (validation_status IN ('PASS', 'BLOCKED')),

  CONSTRAINT story_directions_payload_is_object
    CHECK (jsonb_typeof(payload) = 'object'),

  CONSTRAINT story_directions_validation_issues_is_array
    CHECK (jsonb_typeof(validation_issues) = 'array'),

  CONSTRAINT story_directions_version_positive
    CHECK (version >= 1),

  -- Exactly one row per direction_type per generation batch --
  -- guarantees the mandatory four-and-only-four-types rule at
  -- the database layer, not just in application code.
  CONSTRAINT story_directions_unique_type_per_version
    UNIQUE (story_run_id, version, direction_type)
);

CREATE INDEX IF NOT EXISTS
  idx_story_directions_run_id_version
  ON story_directions (story_run_id, version);

CREATE TABLE IF NOT EXISTS story_outlines (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  story_run_id BIGINT NOT NULL
    REFERENCES story_pipeline_runs(id)
    ON DELETE CASCADE,

  version INTEGER NOT NULL,

  payload JSONB NOT NULL,

  validation_status TEXT NOT NULL DEFAULT 'PASS',
  validation_issues JSONB NOT NULL DEFAULT '[]'::jsonb,

  locked_by TEXT,
  locked_at TIMESTAMPTZ,

  superseded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT story_outlines_validation_status_valid
    CHECK (validation_status IN ('PASS', 'BLOCKED')),

  CONSTRAINT story_outlines_payload_is_object
    CHECK (jsonb_typeof(payload) = 'object'),

  CONSTRAINT story_outlines_validation_issues_is_array
    CHECK (jsonb_typeof(validation_issues) = 'array'),

  CONSTRAINT story_outlines_version_positive
    CHECK (version >= 1),

  CONSTRAINT story_outlines_unique_version
    UNIQUE (story_run_id, version)
);

CREATE INDEX IF NOT EXISTS
  idx_story_outlines_run_id_version
  ON story_outlines (story_run_id, version);

CREATE TABLE IF NOT EXISTS story_scripts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  story_run_id BIGINT NOT NULL
    REFERENCES story_pipeline_runs(id)
    ON DELETE CASCADE,

  version INTEGER NOT NULL,
  variant_type TEXT NOT NULL,

  payload JSONB NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  estimated_duration_seconds INTEGER NOT NULL DEFAULT 0,

  validation_status TEXT NOT NULL DEFAULT 'PASS',
  validation_issues JSONB NOT NULL DEFAULT '[]'::jsonb,

  locked_by TEXT,
  locked_at TIMESTAMPTZ,

  superseded_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT story_scripts_variant_type_valid
    CHECK (
      variant_type IN (
        'VEHICLE_FIRST',
        'WORLD_FIRST',
        'CHARACTER_FIRST'
      )
    ),

  CONSTRAINT story_scripts_validation_status_valid
    CHECK (validation_status IN ('PASS', 'BLOCKED')),

  CONSTRAINT story_scripts_payload_is_object
    CHECK (jsonb_typeof(payload) = 'object'),

  CONSTRAINT story_scripts_validation_issues_is_array
    CHECK (jsonb_typeof(validation_issues) = 'array'),

  CONSTRAINT story_scripts_version_positive
    CHECK (version >= 1),

  CONSTRAINT story_scripts_counts_nonnegative
    CHECK (word_count >= 0 AND estimated_duration_seconds >= 0),

  CONSTRAINT story_scripts_unique_variant_per_version
    UNIQUE (story_run_id, version, variant_type)
);

CREATE INDEX IF NOT EXISTS
  idx_story_scripts_run_id_version
  ON story_scripts (story_run_id, version);

-- Added now that story_scripts exists: Gate 4 records exactly
-- which locked script row completed the run.
ALTER TABLE story_pipeline_runs
  ADD CONSTRAINT story_pipeline_runs_selected_script_id_fk
    FOREIGN KEY (selected_script_id)
    REFERENCES story_scripts(id)
    ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS story_generation_attempts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  story_run_id BIGINT NOT NULL
    REFERENCES story_pipeline_runs(id)
    ON DELETE CASCADE,

  stage TEXT NOT NULL,
  artifact_version INTEGER,

  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,

  -- Hashes only -- never the raw prompt/response text, and
  -- never an API key or Authorization header.
  request_hash TEXT,
  response_hash TEXT,

  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  latency_ms INTEGER,

  attempt_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT story_generation_attempts_stage_valid
    CHECK (stage IN ('DIRECTIONS', 'OUTLINE', 'SCRIPTS')),

  CONSTRAINT story_generation_attempts_status_valid
    CHECK (status IN ('SUCCESS', 'FAILED')),

  CONSTRAINT story_generation_attempts_attempt_number_positive
    CHECK (attempt_number >= 1),

  CONSTRAINT story_generation_attempts_tokens_nonnegative
    CHECK (
      (input_tokens IS NULL OR input_tokens >= 0) AND
      (output_tokens IS NULL OR output_tokens >= 0) AND
      (total_tokens IS NULL OR total_tokens >= 0) AND
      (latency_ms IS NULL OR latency_ms >= 0)
    )
);

CREATE INDEX IF NOT EXISTS
  idx_story_generation_attempts_run_id_created_at
  ON story_generation_attempts (story_run_id, created_at);

CREATE TABLE IF NOT EXISTS story_pipeline_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  story_run_id BIGINT NOT NULL
    REFERENCES story_pipeline_runs(id)
    ON DELETE CASCADE,

  event_type TEXT NOT NULL,
  stage TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT story_pipeline_events_payload_is_object
    CHECK (jsonb_typeof(payload) = 'object')
);

CREATE INDEX IF NOT EXISTS
  idx_story_pipeline_events_run_id_created_at
  ON story_pipeline_events (story_run_id, created_at);

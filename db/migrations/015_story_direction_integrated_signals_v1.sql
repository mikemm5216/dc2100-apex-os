-- =========================================================
-- STORY DIRECTION: INTEGRATED SIGNALS FIX
-- Task 3.5E
--
-- Root cause fixed by this migration: Vehicle / Country / Person
-- / APEX are evidence LAYERS every Story Direction must fuse
-- together, never four mutually-exclusive topics. The Story
-- Direction Generator, its output schema, and its validators are
-- changed (lib/story/prompts.js, schemas.js, validators.js,
-- engine.js) to produce 3-4 INTEGRATED_STORY directions per
-- batch instead of exactly one row per legacy direction_type.
--
-- This migration only relaxes/repoints two constraints on the
-- existing story_directions table -- it does not alter
-- story_pipeline_runs, story_outlines, story_scripts, or touch
-- any existing row's data. Rows persisted before this migration
-- keep their original legacy direction_type value
-- (VEHICLE_POWER / COUNTRY_CONFLICT / PERSON_CULTURE /
-- APEX_PROGRESSION) and remain fully readable; the application
-- layer (lib/story/api.js) tags them LEGACY_DIRECTION for the
-- UI and blocks them from Gate 2 selection instead of this
-- migration trying to rewrite or merge them.
--
-- The migration runner wraps this file in a transaction, so no
-- BEGIN / COMMIT here.
-- =========================================================

-- 1) Allow the new direction_type value alongside the four legacy
--    values (which must remain valid for existing rows).
ALTER TABLE story_directions
  DROP CONSTRAINT IF EXISTS story_directions_direction_type_valid;

ALTER TABLE story_directions
  ADD CONSTRAINT story_directions_direction_type_valid
    CHECK (
      direction_type IN (
        'VEHICLE_POWER',
        'COUNTRY_CONFLICT',
        'PERSON_CULTURE',
        'APEX_PROGRESSION',
        'INTEGRATED_STORY'
      )
    );

-- 2) The old uniqueness rule (one row per direction_type per
--    version) assumed direction_type was itself the distinguishing
--    key across a batch. Under INTEGRATED_STORY every row in a
--    batch shares the same direction_type, so direction_key (the
--    per-option id, e.g. "DIR-001".."DIR-004") is the real
--    distinguishing key now. This still guarantees no duplicate
--    direction_key within one story_run_id + version.
ALTER TABLE story_directions
  DROP CONSTRAINT IF EXISTS story_directions_unique_type_per_version;

ALTER TABLE story_directions
  ADD CONSTRAINT story_directions_unique_key_per_version
    UNIQUE (story_run_id, version, direction_key);

-- 3) Per-call semantic retry observability. These columns are
-- nullable so every legacy OUTLINE/SCRIPTS attempt and every row
-- written before this migration remains readable without a rewrite.
ALTER TABLE story_generation_attempts
  ADD COLUMN IF NOT EXISTS direction_key TEXT,
  ADD COLUMN IF NOT EXISTS validation_status TEXT,
  ADD COLUMN IF NOT EXISTS issue_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS beat_id TEXT,
  ADD COLUMN IF NOT EXISTS state_transition JSONB;

ALTER TABLE story_generation_attempts
  DROP CONSTRAINT IF EXISTS story_generation_attempts_direction_validation_status_valid;

ALTER TABLE story_generation_attempts
  ADD CONSTRAINT story_generation_attempts_direction_validation_status_valid
    CHECK (validation_status IS NULL OR validation_status IN ('PASS', 'BLOCKED'));

ALTER TABLE story_generation_attempts
  DROP CONSTRAINT IF EXISTS story_generation_attempts_issue_codes_is_array;

ALTER TABLE story_generation_attempts
  ADD CONSTRAINT story_generation_attempts_issue_codes_is_array
    CHECK (jsonb_typeof(issue_codes) = 'array');

ALTER TABLE story_generation_attempts
  DROP CONSTRAINT IF EXISTS story_generation_attempts_evidence_refs_is_array;

ALTER TABLE story_generation_attempts
  ADD CONSTRAINT story_generation_attempts_evidence_refs_is_array
    CHECK (jsonb_typeof(evidence_refs) = 'array');

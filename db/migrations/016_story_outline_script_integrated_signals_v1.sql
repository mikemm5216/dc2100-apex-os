-- =========================================================
-- STORY OUTLINE / SCRIPT: INTEGRATED SIGNALS FIX
-- Task 3.6
--
-- Root cause fixed by this migration: Task 3.5E gave Story
-- Direction generation a signal_contributions / coverage_status
-- structure so every direction fuses vehicle / country / person /
-- historical / APEX evidence into one causal story -- but Outline
-- and Script generation (built earlier, Task 3.4E) never received
-- that fix. Nothing stopped the evidence-layer discipline Gate 2
-- enforced from silently evaporating by Gate 3/4.
--
-- signal_contributions / coverage_status are never re-requested from
-- Gemini for Outline/Script -- they are computed deterministically
-- server-side (lib/story/engine.js: computeCoverageStatusFromSnapshot,
-- mergeSignalContributions) from the selected direction(s)/locked
-- outline already in hand, and persisted here for traceability and
-- for the new coverage-continuity validators
-- (lib/story/validators.js: runOutlineCoverageContinuityValidator,
-- runScriptCoverageContinuityValidator) to check against.
--
-- All new columns are nullable/defaulted -- any pre-existing
-- story_outlines/story_scripts row (dev/test data only; production
-- has none yet, PR #11 only ran Directions live) remains readable
-- with signal_contributions/coverage_status = NULL. The application
-- layer (lib/story/api.js) tags such rows LEGACY_NO_COVERAGE, mirroring
-- how Task 3.5E already tags pre-fix direction rows LEGACY_DIRECTION.
--
-- The migration runner wraps this file in a transaction, so no
-- BEGIN / COMMIT here.
-- =========================================================

-- 1) story_outlines: inherited coverage provenance.
ALTER TABLE story_outlines
  ADD COLUMN IF NOT EXISTS signal_contributions JSONB,
  ADD COLUMN IF NOT EXISTS coverage_status JSONB,
  ADD COLUMN IF NOT EXISTS source_direction_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS locked_beat_id TEXT;

ALTER TABLE story_outlines
  DROP CONSTRAINT IF EXISTS story_outlines_source_direction_ids_is_array;

ALTER TABLE story_outlines
  ADD CONSTRAINT story_outlines_source_direction_ids_is_array
    CHECK (jsonb_typeof(source_direction_ids) = 'array');

ALTER TABLE story_outlines
  DROP CONSTRAINT IF EXISTS story_outlines_signal_contributions_is_object;

ALTER TABLE story_outlines
  ADD CONSTRAINT story_outlines_signal_contributions_is_object
    CHECK (
      signal_contributions IS NULL
      OR jsonb_typeof(signal_contributions) = 'object'
    );

ALTER TABLE story_outlines
  DROP CONSTRAINT IF EXISTS story_outlines_coverage_status_is_object;

ALTER TABLE story_outlines
  ADD CONSTRAINT story_outlines_coverage_status_is_object
    CHECK (
      coverage_status IS NULL
      OR jsonb_typeof(coverage_status) = 'object'
    );

-- 2) story_scripts: same shape, plus source_outline_id (each of the 3
--    variants derives from exactly one locked outline, not a
--    direction array).
ALTER TABLE story_scripts
  ADD COLUMN IF NOT EXISTS signal_contributions JSONB,
  ADD COLUMN IF NOT EXISTS coverage_status JSONB,
  ADD COLUMN IF NOT EXISTS source_outline_id BIGINT,
  ADD COLUMN IF NOT EXISTS locked_beat_id TEXT;

ALTER TABLE story_scripts
  DROP CONSTRAINT IF EXISTS story_scripts_signal_contributions_is_object;

ALTER TABLE story_scripts
  ADD CONSTRAINT story_scripts_signal_contributions_is_object
    CHECK (
      signal_contributions IS NULL
      OR jsonb_typeof(signal_contributions) = 'object'
    );

ALTER TABLE story_scripts
  DROP CONSTRAINT IF EXISTS story_scripts_coverage_status_is_object;

ALTER TABLE story_scripts
  ADD CONSTRAINT story_scripts_coverage_status_is_object
    CHECK (
      coverage_status IS NULL
      OR jsonb_typeof(coverage_status) = 'object'
    );

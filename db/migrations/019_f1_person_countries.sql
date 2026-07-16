-- Countries required by the verified Formula 1 candidate catalog.
-- Catalog Sync / Person Radar resolves people through countries.code;
-- keeping this idempotent avoids manual Production database edits.
INSERT INTO countries (code, name, enabled)
VALUES
  ('MC', 'Monaco', TRUE),
  ('ES', 'Spain', TRUE),
  ('BR', 'Brazil', TRUE)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  enabled = TRUE;

-- Preserve historical Pair/Fusion runs while making replacement lineage
-- explicit. New run creation fills these fields transactionally.
ALTER TABLE vehicle_person_pair_runs
  ADD COLUMN IF NOT EXISTS superseded_by_run_id BIGINT
    REFERENCES vehicle_person_pair_runs(id),
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

ALTER TABLE fusion_runs
  ADD COLUMN IF NOT EXISTS superseded_by_run_id BIGINT
    REFERENCES fusion_runs(id),
  ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

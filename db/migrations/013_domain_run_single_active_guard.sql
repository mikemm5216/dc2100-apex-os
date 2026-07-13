-- =========================================================
-- DOMAIN RUN SINGLE-ACTIVE-RUN GUARD
-- Task 3.3G.2 (prerequisite)
--
-- Closes a pre-existing race in the already-accepted Scanner,
-- Country News, Person Radar, and Fusion domains: their
-- "only one active run" guarantee today is API-level only
-- (SELECT status IN ('QUEUED','RUNNING') THEN INSERT, inside
-- lib/scanner/api.js, lib/news/api.js, lib/person/api.js,
-- lib/fusion/api.js), with a real race window between the two
-- statements. AutoFlow's engine and a human manually triggering
-- the same domain from its own dashboard can both pass that
-- SELECT check and both INSERT.
--
-- This migration is purely additive: four new partial unique
-- indexes, same pattern as idx_autoflow_runs_single_active in
-- 012_autoflow_orchestrator.sql. No existing column,
-- constraint, table, or domain business logic is touched.
--
-- The migration runner wraps this file in a transaction, so
-- no BEGIN / COMMIT here.
-- =========================================================

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_scanner_runs_single_active
  ON scanner_runs ((1))
  WHERE status IN ('QUEUED', 'RUNNING');

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_country_news_runs_single_active
  ON country_news_runs ((1))
  WHERE status IN ('QUEUED', 'RUNNING');

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_person_radar_runs_single_active
  ON person_radar_runs ((1))
  WHERE status IN ('QUEUED', 'RUNNING');

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_fusion_runs_single_active
  ON fusion_runs ((1))
  WHERE status IN ('QUEUED', 'RUNNING');

// =========================================================
// CI-ONLY migration 015 acceptance check against a REAL Postgres
// (a disposable service container, never production). Run only
// after `npm run migrate` has already applied 001-015 against
// DATABASE_URL. This does not re-test what scripts/test-story-migration.js
// already covers with pg-mem -- it exists because pg-mem is not a real
// Postgres and this PR's whole point is a real constraint/transaction
// behavior check.
//
// All statements run on ONE checked-out client (not pool.query directly)
// -- transaction state (BEGIN/ROLLBACK, session_replication_role) must
// stay on a single physical connection, which a bare Pool does not
// guarantee across separate .query() calls.
// =========================================================

const assert = require("node:assert/strict");
const { Pool } = require("pg");

async function main() {
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be set.");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  const failures = [];
  function check(label, condition) {
    if (!condition) failures.push(label);
  }

  try {
    // fusion_candidate_id has a NOT NULL FK to vehicle_fusion_candidates;
    // session_replication_role='replica' suppresses that FK trigger so
    // this script doesn't need to walk the full vehicle/country/person
    // chain just to hold a run row -- migration 015 never touches that
    // chain, only story_directions/story_generation_attempts.
    await client.query("BEGIN");
    await client.query("SET session_replication_role = 'replica'");

    const run1 = await client.query(
      `INSERT INTO story_pipeline_runs (fusion_candidate_id, status, current_stage, candidate_snapshot)
       VALUES (999001, 'AWAITING_DIRECTION_SELECTION', 'AWAITING_DIRECTION_SELECTION', '{}'::jsonb)
       RETURNING id`
    );
    const runId1 = run1.rows[0].id;

    // 1) Legacy-style row (pre-fix direction_type, direction_key equal to
    // the type, as legacy rows always had) must remain insertable and
    // readable under the new CHECK constraint.
    await client.query(
      `INSERT INTO story_directions (story_run_id, version, direction_key, direction_type, payload, validation_status)
       VALUES ($1, 1, 'VEHICLE_POWER', 'VEHICLE_POWER', '{}'::jsonb, 'PASS')`,
      [runId1]
    );
    const legacyRead = await client.query(
      `SELECT direction_type FROM story_directions WHERE story_run_id = $1 AND direction_key = 'VEHICLE_POWER'`,
      [runId1]
    );
    check("legacy direction_type row insertable and readable", legacyRead.rows[0]?.direction_type === "VEHICLE_POWER");

    // 2) Four INTEGRATED_STORY rows, same run + version, distinct
    // direction_key -- the entire point of migration 015's unique-key change.
    for (const key of ["DIR-001", "DIR-002", "DIR-003", "DIR-004"]) {
      await client.query(
        `INSERT INTO story_directions (story_run_id, version, direction_key, direction_type, payload, validation_status)
         VALUES ($1, 2, $2, 'INTEGRATED_STORY', '{}'::jsonb, 'PASS')`,
        [runId1, key]
      );
    }
    const integratedCount = await client.query(
      `SELECT COUNT(*)::int AS n FROM story_directions WHERE story_run_id = $1 AND version = 2 AND direction_type = 'INTEGRATED_STORY'`,
      [runId1]
    );
    check("4 INTEGRATED_STORY rows coexist in same run+version", integratedCount.rows[0].n === 4);

    // 3) Duplicate direction_key within the same run+version must be
    // rejected by story_directions_unique_key_per_version. Use a
    // savepoint so the rejection doesn't abort the whole outer
    // transaction (Postgres marks a tx aborted after any error).
    await client.query("SAVEPOINT before_duplicate");
    let duplicateRejected = false;
    try {
      await client.query(
        `INSERT INTO story_directions (story_run_id, version, direction_key, direction_type, payload, validation_status)
         VALUES ($1, 2, 'DIR-001', 'INTEGRATED_STORY', '{}'::jsonb, 'PASS')`,
        [runId1]
      );
    } catch (error) {
      duplicateRejected = error.code === "23505"; // unique_violation
      await client.query("ROLLBACK TO SAVEPOINT before_duplicate");
    }
    check("duplicate direction_key in same run+version rejected", duplicateRejected);

    // 4) story_generation_attempts new columns: nullable, and accept
    // real values.
    await client.query(
      `INSERT INTO story_generation_attempts
         (story_run_id, stage, provider, model, prompt_version, attempt_number, status)
       VALUES ($1, 'DIRECTIONS', 'gemini', 'test-model', 'v1', 1, 'SUCCESS')`,
      [runId1]
    );
    const nullableRead = await client.query(
      `SELECT direction_key, validation_status, issue_codes, evidence_refs, beat_id, state_transition
       FROM story_generation_attempts WHERE story_run_id = $1 AND direction_key IS NULL LIMIT 1`,
      [runId1]
    );
    check(
      "legacy-shaped attempt row (no direction_key) reads fine with defaulted jsonb columns",
      nullableRead.rowCount === 1 &&
        Array.isArray(nullableRead.rows[0].issue_codes) &&
        Array.isArray(nullableRead.rows[0].evidence_refs)
    );

    await client.query(
      `INSERT INTO story_generation_attempts
         (story_run_id, stage, provider, model, prompt_version, attempt_number, status,
          direction_key, validation_status, issue_codes, evidence_refs, beat_id, state_transition)
       VALUES ($1, 'DIRECTIONS', 'gemini', 'test-model', 'v1', 1, 'FAILED',
          'DIR-001', 'BLOCKED', '["EVIDENCE_REF_NOT_FOUND"]'::jsonb, '["vehicle:9"]'::jsonb, 'BEAT-04', '{"previous_state":"CANDIDATE_APPROVED","target_state":"QUALIFIER_ENTERED"}'::jsonb)`,
      [runId1]
    );
    const observabilityRead = await client.query(
      `SELECT direction_key, validation_status, issue_codes FROM story_generation_attempts
       WHERE story_run_id = $1 AND direction_key = 'DIR-001'`,
      [runId1]
    );
    check(
      "new observability columns persist and read back correctly",
      observabilityRead.rows[0]?.validation_status === "BLOCKED"
    );

    // Roll back everything from case 1-4 -- this script only proves the
    // constraints/columns behave correctly, it must not leave test data
    // behind.
    await client.query("ROLLBACK");

    // 5) Rollback-on-error check: a transaction that hits the unique
    // violation must leave zero trace, not a partial write.
    await client.query("BEGIN");
    await client.query("SET session_replication_role = 'replica'");
    const run2 = await client.query(
      `INSERT INTO story_pipeline_runs (fusion_candidate_id, status, current_stage, candidate_snapshot)
       VALUES (999002, 'AWAITING_DIRECTION_SELECTION', 'AWAITING_DIRECTION_SELECTION', '{}'::jsonb)
       RETURNING id`
    );
    const runId2 = run2.rows[0].id;
    await client.query(
      `INSERT INTO story_directions (story_run_id, version, direction_key, direction_type, payload, validation_status)
       VALUES ($1, 1, 'DIR-001', 'INTEGRATED_STORY', '{}'::jsonb, 'PASS')`,
      [runId2]
    );

    let txRolledBackCleanly = false;
    try {
      await client.query(
        `INSERT INTO story_directions (story_run_id, version, direction_key, direction_type, payload, validation_status)
         VALUES ($1, 1, 'DIR-001', 'INTEGRATED_STORY', '{}'::jsonb, 'PASS')`,
        [runId2]
      );
    } catch {
      // The outer transaction is now aborted (Postgres semantics) --
      // ROLLBACK the whole thing and verify nothing from it persisted.
      await client.query("ROLLBACK");
      const afterRollback = await client.query(
        `SELECT COUNT(*)::int AS n FROM story_directions WHERE story_run_id = $1`,
        [runId2]
      );
      txRolledBackCleanly = afterRollback.rows[0].n === 0;
    }
    check("transaction with a rejected insert rolls back with zero partial rows", txRolledBackCleanly);
  } finally {
    try {
      await client.query("ROLLBACK");
    } catch {
      // no transaction open
    }
    await client.query(
      "DELETE FROM story_directions WHERE story_run_id IN (SELECT id FROM story_pipeline_runs WHERE fusion_candidate_id IN (999001, 999002))"
    );
    await client.query(
      "DELETE FROM story_generation_attempts WHERE story_run_id IN (SELECT id FROM story_pipeline_runs WHERE fusion_candidate_id IN (999001, 999002))"
    );
    await client.query("DELETE FROM story_pipeline_runs WHERE fusion_candidate_id IN (999001, 999002)");
    client.release();
    await pool.end();
  }

  console.log("MIGRATION 015 REAL-POSTGRES ACCEPTANCE");
  console.log(JSON.stringify({ result: failures.length === 0 ? "PASS" : "FAIL", failures }, null, 2));

  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error("MIGRATION ACCEPTANCE SCRIPT ERROR", error);
  process.exitCode = 1;
});

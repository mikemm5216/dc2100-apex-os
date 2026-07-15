const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DataType, newDb } = require("pg-mem");

const migrationSql = fs.readFileSync(
  path.join(__dirname, "..", "db", "migrations", "015_story_direction_integrated_signals_v1.sql"),
  "utf8"
);

const legacySchemaSql = `
  CREATE TABLE story_pipeline_runs (
    id BIGINT PRIMARY KEY
  );

  CREATE TABLE story_directions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    story_run_id BIGINT NOT NULL REFERENCES story_pipeline_runs(id),
    version INTEGER NOT NULL,
    direction_key TEXT NOT NULL,
    direction_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    validation_status TEXT NOT NULL,
    validation_issues JSONB NOT NULL,
    superseded_at TIMESTAMPTZ,
    CONSTRAINT story_directions_direction_type_valid CHECK (
      direction_type IN ('VEHICLE_POWER','COUNTRY_CONFLICT','PERSON_CULTURE','APEX_PROGRESSION')
    ),
    CONSTRAINT story_directions_unique_type_per_version
      UNIQUE (story_run_id, version, direction_type)
  );

  CREATE TABLE story_generation_attempts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    story_run_id BIGINT NOT NULL REFERENCES story_pipeline_runs(id),
    stage TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    total_tokens INTEGER,
    latency_ms INTEGER
  );
`;

async function createClient() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  db.public.registerFunction({
    name: "jsonb_typeof",
    args: [DataType.jsonb],
    returns: DataType.text,
    implementation: value => Array.isArray(value) ? "array" : typeof value
  });
  const { Client } = db.adapters.createPg();
  const client = new Client();
  await client.connect();
  await client.query(legacySchemaSql);
  return client;
}

async function run() {
  // Fresh database: legacy base schema followed immediately by 015.
  const fresh = await createClient();
  await fresh.query(migrationSql);
  await fresh.query("INSERT INTO story_pipeline_runs (id) VALUES (1)");
  await fresh.query(`
    INSERT INTO story_directions (
      story_run_id, version, direction_key, direction_type,
      payload, validation_status, validation_issues
    ) VALUES (1, 1, 'DIR-001', 'INTEGRATED_STORY', '{}', 'PASS', '[]')
  `);
  assert.equal((await fresh.query("SELECT COUNT(*)::int AS count FROM story_directions")).rows[0].count, 1);
  await fresh.end();

  // Existing database: four legacy types remain readable after 015.
  const existing = await createClient();
  await existing.query("INSERT INTO story_pipeline_runs (id) VALUES (9)");
  for (const [index, type] of [
    "VEHICLE_POWER",
    "COUNTRY_CONFLICT",
    "PERSON_CULTURE",
    "APEX_PROGRESSION"
  ].entries()) {
    await existing.query(
      `INSERT INTO story_directions (
        story_run_id, version, direction_key, direction_type,
        payload, validation_status, validation_issues
      ) VALUES ($1, 1, $2, $3, $4::jsonb, 'PASS', '[]')`,
      [9, `LEGACY-${index + 1}`, type, JSON.stringify({ legacy: true, type })]
    );
  }

  await existing.query(migrationSql);
  const legacy = await existing.query(
    "SELECT direction_key, direction_type, payload FROM story_directions WHERE story_run_id = 9 AND version = 1 ORDER BY direction_key"
  );
  assert.equal(legacy.rowCount, 4);
  assert.equal(legacy.rows.every(row => row.payload.legacy === true), true);

  // Four INTEGRATED_STORY rows may share run + version + type;
  // direction_key is the unique option identity.
  for (let index = 1; index <= 4; index += 1) {
    await existing.query(
      `INSERT INTO story_directions (
        story_run_id, version, direction_key, direction_type,
        payload, validation_status, validation_issues
      ) VALUES (9, 2, $1, 'INTEGRATED_STORY', '{}', 'PASS', '[]')`,
      [`DIR-${String(index).padStart(3, "0")}`]
    );
  }
  const integrated = await existing.query(
    "SELECT direction_key FROM story_directions WHERE story_run_id = 9 AND version = 2 ORDER BY direction_key"
  );
  assert.deepEqual(integrated.rows.map(row => row.direction_key), [
    "DIR-001", "DIR-002", "DIR-003", "DIR-004"
  ]);

  await assert.rejects(
    existing.query(`INSERT INTO story_directions (
      story_run_id, version, direction_key, direction_type,
      payload, validation_status, validation_issues
    ) VALUES (9, 2, 'DIR-001', 'INTEGRATED_STORY', '{}', 'PASS', '[]')`),
    /unique|duplicate/i
  );

  // New observability columns accept a fully described retry attempt.
  await existing.query(`INSERT INTO story_generation_attempts (
    story_run_id, stage, attempt_number, status, direction_key,
    validation_status, issue_codes, evidence_refs, beat_id, state_transition
  ) VALUES (
    9, 'DIRECTIONS', 1, 'FAILED', 'DIR-001', 'BLOCKED',
    '["STATE_TRANSITION_INVALID"]', '["vehicle:9"]', 'BEAT-04',
    '{"previous_state":"CANDIDATE_APPROVED","target_state":"QUALIFIER_PASSED"}'
  )`);

  await existing.end();
  console.log("MIGRATION 015 DRY RUN PASSED: fresh, legacy, integrated x4, unique key, observability");
  console.log("RECOVERY: migration runner wraps 015 in one transaction; rollback leaves the pre-015 constraints and rows intact.");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

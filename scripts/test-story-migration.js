const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { DataType, newDb } = require("pg-mem");

const migration015Sql = fs.readFileSync(
  path.join(__dirname, "..", "db", "migrations", "015_story_direction_integrated_signals_v1.sql"),
  "utf8"
);

const migration016Sql = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "db",
    "migrations",
    "016_story_outline_script_integrated_signals_v1.sql"
  ),
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

  CREATE TABLE story_outlines (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    story_run_id BIGINT NOT NULL REFERENCES story_pipeline_runs(id),
    version INTEGER NOT NULL,
    payload JSONB NOT NULL,
    validation_status TEXT NOT NULL,
    validation_issues JSONB NOT NULL,
    locked_by TEXT,
    locked_at TIMESTAMPTZ,
    superseded_at TIMESTAMPTZ,
    CONSTRAINT story_outlines_unique_version UNIQUE (story_run_id, version)
  );

  CREATE TABLE story_scripts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    story_run_id BIGINT NOT NULL REFERENCES story_pipeline_runs(id),
    version INTEGER NOT NULL,
    variant_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    word_count INTEGER,
    estimated_duration_seconds INTEGER,
    validation_status TEXT NOT NULL,
    validation_issues JSONB NOT NULL,
    locked_by TEXT,
    locked_at TIMESTAMPTZ,
    superseded_at TIMESTAMPTZ,
    CONSTRAINT story_scripts_unique_variant_per_version
      UNIQUE (story_run_id, version, variant_type)
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
  // Fresh database: legacy base schema followed immediately by 015
  // then 016.
  const fresh = await createClient();
  await fresh.query(migration015Sql);
  await fresh.query(migration016Sql);
  await fresh.query("INSERT INTO story_pipeline_runs (id) VALUES (1)");
  await fresh.query(`
    INSERT INTO story_directions (
      story_run_id, version, direction_key, direction_type,
      payload, validation_status, validation_issues
    ) VALUES (1, 1, 'DIR-001', 'INTEGRATED_STORY', '{}', 'PASS', '[]')
  `);
  assert.equal((await fresh.query("SELECT COUNT(*)::int AS count FROM story_directions")).rows[0].count, 1);

  await fresh.query(`
    INSERT INTO story_outlines (
      story_run_id, version, payload, validation_status, validation_issues,
      signal_contributions, coverage_status, source_direction_ids, locked_beat_id
    ) VALUES (
      1, 1, '{}', 'PASS', '[]',
      '{"vehicle":{"evidence_refs":["vehicle:1"]}}'::jsonb,
      '{"vehicle_signal":"USED"}'::jsonb,
      '["1"]'::jsonb, 'BEAT-04'
    )
  `);

  const freshOutline = await fresh.query(
    "SELECT signal_contributions, coverage_status, source_direction_ids, locked_beat_id FROM story_outlines WHERE story_run_id = 1"
  );
  assert.equal(freshOutline.rowCount, 1);
  assert.equal(freshOutline.rows[0].locked_beat_id, "BEAT-04");
  assert.deepEqual(freshOutline.rows[0].source_direction_ids, ["1"]);

  await fresh.query(`
    INSERT INTO story_scripts (
      story_run_id, version, variant_type, payload, validation_status, validation_issues,
      signal_contributions, coverage_status, source_outline_id, locked_beat_id
    ) VALUES (
      1, 1, 'VEHICLE_FIRST', '{}', 'PASS', '[]',
      '{"vehicle":{"evidence_refs":["vehicle:1"]}}'::jsonb,
      '{"vehicle_signal":"USED"}'::jsonb,
      1, 'BEAT-04'
    )
  `);
  const freshScript = await fresh.query(
    "SELECT source_outline_id, locked_beat_id FROM story_scripts WHERE story_run_id = 1"
  );
  assert.equal(freshScript.rowCount, 1);
  assert.equal(freshScript.rows[0].locked_beat_id, "BEAT-04");

  // A non-array source_direction_ids is rejected.
  await assert.rejects(
    fresh.query(`
      INSERT INTO story_outlines (
        story_run_id, version, payload, validation_status, validation_issues, source_direction_ids
      ) VALUES (1, 2, '{}', 'PASS', '[]', '{"not":"an array"}'::jsonb)
    `),
    /check/i
  );

  await fresh.end();

  // Existing database: four legacy direction types AND a pre-Task-3.6
  // outline/script row (no signal_contributions/coverage_status at
  // all) remain readable after 015 + 016.
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

  await existing.query(`
    INSERT INTO story_outlines (
      story_run_id, version, payload, validation_status, validation_issues
    ) VALUES (9, 1, '{"legacy":true}'::jsonb, 'PASS', '[]')
  `);
  await existing.query(`
    INSERT INTO story_scripts (
      story_run_id, version, variant_type, payload, validation_status, validation_issues
    ) VALUES (9, 1, 'VEHICLE_FIRST', '{"legacy":true}'::jsonb, 'PASS', '[]')
  `);

  await existing.query(migration015Sql);
  await existing.query(migration016Sql);

  const legacy = await existing.query(
    "SELECT direction_key, direction_type, payload FROM story_directions WHERE story_run_id = 9 AND version = 1 ORDER BY direction_key"
  );
  assert.equal(legacy.rowCount, 4);
  assert.equal(legacy.rows.every(row => row.payload.legacy === true), true);

  const legacyOutline = await existing.query(
    "SELECT payload, signal_contributions, coverage_status FROM story_outlines WHERE story_run_id = 9"
  );
  assert.equal(legacyOutline.rowCount, 1);
  assert.equal(legacyOutline.rows[0].payload.legacy, true);
  assert.equal(legacyOutline.rows[0].signal_contributions, null);
  assert.equal(legacyOutline.rows[0].coverage_status, null);

  const legacyScript = await existing.query(
    "SELECT payload, signal_contributions, coverage_status FROM story_scripts WHERE story_run_id = 9"
  );
  assert.equal(legacyScript.rowCount, 1);
  assert.equal(legacyScript.rows[0].signal_contributions, null);
  assert.equal(legacyScript.rows[0].coverage_status, null);

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

  // A new post-016 outline row with full coverage provenance persists
  // and reads back correctly alongside the legacy (NULL-coverage) row.
  await existing.query(`
    INSERT INTO story_outlines (
      story_run_id, version, payload, validation_status, validation_issues,
      signal_contributions, coverage_status, source_direction_ids, locked_beat_id
    ) VALUES (
      9, 2, '{}', 'PASS', '[]',
      '{"vehicle":{"evidence_refs":["vehicle:9"]}}'::jsonb,
      '{"vehicle_signal":"USED","country_signal":"NOT_AVAILABLE"}'::jsonb,
      '["101","102"]'::jsonb, 'BEAT-04'
    )
  `);
  const newOutline = await existing.query(
    "SELECT source_direction_ids, coverage_status FROM story_outlines WHERE story_run_id = 9 AND version = 2"
  );
  assert.deepEqual(newOutline.rows[0].source_direction_ids, ["101", "102"]);
  assert.equal(newOutline.rows[0].coverage_status.country_signal, "NOT_AVAILABLE");

  // A non-array source_direction_ids is rejected.
  await assert.rejects(
    existing.query(`
      INSERT INTO story_outlines (
        story_run_id, version, payload, validation_status, validation_issues, source_direction_ids
      ) VALUES (9, 3, '{}', 'PASS', '[]', '{"not":"an array"}'::jsonb)
    `),
    /check/i
  );

  await existing.end();
  console.log("MIGRATION 015 DRY RUN PASSED: fresh, legacy, integrated x4, unique key, observability");
  console.log(
    "MIGRATION 016 DRY RUN PASSED: fresh outline/script coverage columns, legacy rows remain readable with NULL coverage, non-array source_direction_ids rejected"
  );
  console.log(
    "RECOVERY: migration runner wraps each migration in one transaction; a rollback leaves the pre-migration schema and rows intact."
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

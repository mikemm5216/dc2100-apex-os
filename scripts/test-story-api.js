const assert = require("node:assert/strict");
const { URLSearchParams } = require("node:url");

const {
  createStoryRunHandler,
  listStoryRuns,
  getStoryRun,
  approveCandidateHandler,
  selectDirectionHandler,
  lockOutlineHandler,
  lockScriptHandler,
  regenerateHandler,
  cancelHandler,
  resumeHandler
} = require("../lib/story/api");

// ---------------------------------------------------------
// In-memory mock database. Dispatches on SQL text substrings,
// the same pattern used by scripts/test-autoflow-api.js -- no
// real Postgres connection is required here.
// ---------------------------------------------------------

let clock = 0;
function fixedNow() {
  clock += 1;
  return new Date(2026, 0, 1, 0, 0, clock);
}

function createMockDb({ candidates = {} } = {}) {
  const state = {
    candidates: new Map(Object.entries(candidates)),
    runs: new Map(),
    directions: new Map(),
    outlines: new Map(),
    scripts: new Map(),
    attempts: [],
    events: [],
    nextRunId: 1,
    nextDirectionId: 1,
    nextOutlineId: 1,
    nextScriptId: 1,
    nextEventId: 1
  };

  let snapshot = null;

  function cloneState(source) {
    return {
      runs: new Map([...source.runs].map(([k, v]) => [k, { ...v }])),
      directions: new Map([...source.directions].map(([k, v]) => [k, { ...v }])),
      outlines: new Map([...source.outlines].map(([k, v]) => [k, { ...v }])),
      scripts: new Map([...source.scripts].map(([k, v]) => [k, { ...v }])),
      attempts: source.attempts.map(a => ({ ...a })),
      events: source.events.map(e => ({ ...e })),
      nextRunId: source.nextRunId,
      nextDirectionId: source.nextDirectionId,
      nextOutlineId: source.nextOutlineId,
      nextScriptId: source.nextScriptId,
      nextEventId: source.nextEventId
    };
  }

  function conflictError(constraint) {
    const error = new Error(
      `duplicate key value violates unique constraint "${constraint}"`
    );
    error.code = "23505";
    error.constraint = constraint;
    return error;
  }

  async function query(sql, values = []) {
    const trimmed = String(sql).trim();
    const upper = trimmed.toUpperCase();

    if (upper === "BEGIN") {
      snapshot = cloneState(state);
      return { rows: [], rowCount: 0 };
    }

    if (upper === "COMMIT") {
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }

    if (upper === "ROLLBACK") {
      if (snapshot) {
        state.runs = snapshot.runs;
        state.directions = snapshot.directions;
        state.outlines = snapshot.outlines;
        state.scripts = snapshot.scripts;
        state.attempts = snapshot.attempts;
        state.events = snapshot.events;
        state.nextRunId = snapshot.nextRunId;
        state.nextDirectionId = snapshot.nextDirectionId;
        state.nextOutlineId = snapshot.nextOutlineId;
        state.nextScriptId = snapshot.nextScriptId;
        state.nextEventId = snapshot.nextEventId;
        snapshot = null;
      }
      return { rows: [], rowCount: 0 };
    }

    // ------------------ vehicle_fusion_candidates (join) ------------------

    if (
      trimmed.includes("FROM vehicle_fusion_candidates vfc") &&
      trimmed.includes("JOIN vehicles v")
    ) {
      const candidate = state.candidates.get(String(values[0]));
      return candidate ? { rows: [{ ...candidate }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (trimmed.includes("SELECT id FROM vehicle_fusion_candidates")) {
      const candidate = state.candidates.get(String(values[0]));
      return candidate ? { rows: [{ id: candidate.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    // ------------------ story_pipeline_runs: idempotency / active checks ------------------

    if (trimmed.includes("FROM story_pipeline_runs WHERE idempotency_key = $1")) {
      const found = [...state.runs.values()].find(
        r => r.idempotency_key === values[0]
      );
      return found ? { rows: [{ ...found }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (
      trimmed.includes("FROM story_pipeline_runs") &&
      trimmed.includes("fusion_candidate_id = $1") &&
      trimmed.includes("NOT IN")
    ) {
      const found = [...state.runs.values()].filter(
        r =>
          String(r.fusion_candidate_id) === String(values[0]) &&
          !["COMPLETED", "FAILED", "CANCELLED"].includes(r.status)
      );
      return { rows: found.map(r => ({ id: r.id, status: r.status })), rowCount: found.length };
    }

    // ------------------ story_pipeline_runs: insert ------------------

    if (trimmed.startsWith("INSERT INTO story_pipeline_runs")) {
      const [idempotencyKey, fusionCandidateId, snapshotJson, snapshotHash] = values;
      const now = fixedNow();
      const id = state.nextRunId++;

      const row = {
        id,
        idempotency_key: idempotencyKey,
        fusion_candidate_id: Number(fusionCandidateId),
        status: "AWAITING_CANDIDATE_APPROVAL",
        current_stage: "AWAITING_CANDIDATE_APPROVAL",
        candidate_snapshot: JSON.parse(snapshotJson),
        candidate_snapshot_hash: snapshotHash,
        canon_version: null,
        rules_version: null,
        season_version: null,
        canon_hash: null,
        candidate_slot_id: null,
        beat_id: null,
        apex_stage: null,
        creator_notes: null,
        forbidden_elements: [],
        review_language: null,
        script_language: null,
        selected_direction_ids: [],
        selected_script_id: null,
        failure_stage: null,
        error_code: null,
        error_message: null,
        worker_id: null,
        lease_expires_at: null,
        attempt_count: 0,
        created_at: now,
        updated_at: now,
        completed_at: null,
        cancelled_at: null
      };

      state.runs.set(id, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ story_pipeline_runs: fetch ------------------

    if (
      trimmed.includes("FROM story_pipeline_runs WHERE id = $1") &&
      trimmed.includes("FOR UPDATE")
    ) {
      const row = state.runs.get(Number(values[0]));
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (trimmed === "SELECT * FROM story_pipeline_runs WHERE id = $1") {
      const row = state.runs.get(Number(values[0]));
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    // ------------------ Gate 1: approveCandidate ------------------

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'QUEUED_DIRECTIONS'") &&
      trimmed.includes("candidate_slot_id")
    ) {
      const [
        candidateSlotId, beatId, apexStage, creatorNotes,
        forbiddenElements, reviewLanguage, scriptLanguage, runId
      ] = values;

      const row = state.runs.get(Number(runId));
      row.status = "QUEUED_DIRECTIONS";
      row.current_stage = "QUEUED_DIRECTIONS";
      row.candidate_slot_id = candidateSlotId;
      row.beat_id = beatId;
      row.apex_stage = apexStage;
      row.creator_notes = creatorNotes;
      row.forbidden_elements = JSON.parse(forbiddenElements);
      row.review_language = reviewLanguage;
      row.script_language = scriptLanguage;
      row.updated_at = fixedNow();

      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ Gate 2: selectDirection ------------------

    if (
      trimmed.includes("FROM story_directions") &&
      trimmed.includes("id = ANY($2::bigint[])") &&
      trimmed.includes("superseded_at IS NULL")
    ) {
      const [runId, ids] = values;
      const idSet = new Set(ids.map(String));

      const matches = [...state.directions.values()].filter(
        d =>
          d.story_run_id === Number(runId) &&
          idSet.has(String(d.id)) &&
          d.superseded_at === null
      );

      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'QUEUED_OUTLINE'")
    ) {
      const [selectedIdsJson, runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = "QUEUED_OUTLINE";
      row.current_stage = "QUEUED_OUTLINE";
      row.selected_direction_ids = JSON.parse(selectedIdsJson);
      row.updated_at = fixedNow();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ Gate 3: lockOutline ------------------

    if (
      trimmed.includes("FROM story_outlines") &&
      trimmed.includes("FOR UPDATE") &&
      trimmed.includes("story_run_id = $2")
    ) {
      const [outlineId, runId] = values;
      const row = state.outlines.get(Number(outlineId));

      const match =
        row &&
        row.story_run_id === Number(runId) &&
        row.superseded_at === null;

      return match ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (
      trimmed.startsWith("UPDATE story_outlines") &&
      trimmed.includes("locked_by")
    ) {
      const [approvedBy, outlineId] = values;
      const row = state.outlines.get(Number(outlineId));
      row.locked_by = approvedBy;
      row.locked_at = fixedNow();
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'QUEUED_SCRIPTS'")
    ) {
      const [runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = "QUEUED_SCRIPTS";
      row.current_stage = "QUEUED_SCRIPTS";
      row.updated_at = fixedNow();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ Gate 4: lockScript ------------------

    if (
      trimmed.includes("FROM story_scripts") &&
      trimmed.includes("FOR UPDATE") &&
      trimmed.includes("story_run_id = $2")
    ) {
      const [scriptId, runId] = values;
      const row = state.scripts.get(Number(scriptId));

      const match =
        row &&
        row.story_run_id === Number(runId) &&
        row.superseded_at === null;

      return match ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (
      trimmed.startsWith("UPDATE story_scripts") &&
      trimmed.includes("locked_by")
    ) {
      const [approvedBy, scriptId] = values;
      const row = state.scripts.get(Number(scriptId));
      row.locked_by = approvedBy;
      row.locked_at = fixedNow();
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'COMPLETED'") &&
      trimmed.includes("selected_script_id")
    ) {
      const [scriptId, runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = "COMPLETED";
      row.current_stage = "COMPLETED";
      row.selected_script_id = Number(scriptId);
      row.completed_at = fixedNow();
      row.updated_at = fixedNow();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ regenerateStage ------------------

    if (
      trimmed.startsWith("UPDATE story_directions") &&
      trimmed.includes("SET superseded_at = NOW()")
    ) {
      const [runId] = values;
      for (const d of state.directions.values()) {
        if (d.story_run_id === Number(runId) && d.superseded_at === null) {
          d.superseded_at = fixedNow();
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (
      trimmed.startsWith("UPDATE story_outlines") &&
      trimmed.includes("SET superseded_at = NOW()")
    ) {
      const [runId] = values;
      for (const o of state.outlines.values()) {
        if (o.story_run_id === Number(runId) && o.superseded_at === null) {
          o.superseded_at = fixedNow();
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (
      trimmed.startsWith("UPDATE story_scripts") &&
      trimmed.includes("SET superseded_at = NOW()")
    ) {
      const [runId] = values;
      for (const s of state.scripts.values()) {
        if (s.story_run_id === Number(runId) && s.superseded_at === null) {
          s.superseded_at = fixedNow();
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("current_stage = $1") &&
      !trimmed.includes("worker_id")
    ) {
      const queuedStatus = values[0];
      const runId = values[values.length - 1];
      const row = state.runs.get(Number(runId));
      row.status = queuedStatus;
      row.current_stage = queuedStatus;
      row.updated_at = fixedNow();

      if (trimmed.includes("selected_direction_ids = '[]'")) {
        row.selected_direction_ids = [];
      }

      if (trimmed.includes("selected_script_id = NULL")) {
        row.selected_script_id = null;
      }

      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ cancelRun ------------------

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'CANCELLED'")
    ) {
      const [runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = "CANCELLED";
      row.current_stage = "CANCELLED";
      row.cancelled_at = fixedNow();
      row.updated_at = fixedNow();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ resumeRun ------------------

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("failure_stage = NULL")
    ) {
      const [queuedStatus, runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = queuedStatus;
      row.current_stage = queuedStatus;
      row.failure_stage = null;
      row.error_code = null;
      row.error_message = null;
      row.worker_id = null;
      row.lease_expires_at = null;
      row.updated_at = fixedNow();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ events ------------------

    if (trimmed.startsWith("INSERT INTO story_pipeline_events")) {
      const [runId, eventType, stage, payloadJson] = values;
      const id = state.nextEventId++;
      state.events.push({
        id,
        story_run_id: Number(runId),
        event_type: eventType,
        stage,
        payload: JSON.parse(payloadJson),
        created_at: fixedNow()
      });
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.includes("FROM story_pipeline_events") &&
      trimmed.includes("event_type = 'REGENERATE_REQUESTED'")
    ) {
      const [runId, stage] = values;
      const matches = state.events
        .filter(
          e =>
            e.story_run_id === Number(runId) &&
            e.event_type === "REGENERATE_REQUESTED" &&
            e.stage === stage
        )
        .sort((a, b) => b.id - a.id);

      return matches.length > 0
        ? { rows: [{ payload: matches[0].payload }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (
      trimmed.includes("FROM story_pipeline_events") &&
      trimmed.includes("story_run_id = $1")
    ) {
      const matches = state.events
        .filter(e => e.story_run_id === Number(values[0]))
        .sort((a, b) => a.id - b.id);

      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    // ------------------ list / detail reads ------------------

    if (
      trimmed.includes("COUNT(*) OVER() AS total_count") &&
      trimmed.includes("FROM story_pipeline_runs")
    ) {
      const all = [...state.runs.values()].sort((a, b) => b.id - a.id);
      const limit = values[values.length - 2];
      const offset = values[values.length - 1];
      const page = all.slice(offset, offset + limit);

      return {
        rows: page.map(r => ({ ...r, total_count: all.length })),
        rowCount: page.length
      };
    }

    if (
      trimmed.includes("FROM story_directions") &&
      trimmed.includes("WHERE story_run_id = $1") &&
      trimmed.includes("ORDER BY version DESC")
    ) {
      const matches = [...state.directions.values()].filter(
        d => d.story_run_id === Number(values[0])
      );
      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    if (
      trimmed.includes("FROM story_outlines") &&
      trimmed.includes("WHERE story_run_id = $1") &&
      trimmed.includes("ORDER BY version DESC") &&
      !trimmed.includes("FOR UPDATE")
    ) {
      const matches = [...state.outlines.values()].filter(
        o => o.story_run_id === Number(values[0])
      );
      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    if (
      trimmed.includes("FROM story_scripts") &&
      trimmed.includes("WHERE story_run_id = $1") &&
      trimmed.includes("ORDER BY version DESC") &&
      !trimmed.includes("FOR UPDATE")
    ) {
      const matches = [...state.scripts.values()].filter(
        s => s.story_run_id === Number(values[0])
      );
      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    if (trimmed.includes("FROM story_generation_attempts")) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unhandled mock query: ${trimmed.slice(0, 160)}`);
  }

  return {
    query,
    async connect() {
      return { query, release() {} };
    },
    _state: state
  };
}

function seedCandidate(id, overrides = {}) {
  return {
    id,
    vehicle_id: 1,
    vehicle_code: "VH-1",
    vehicle_name: "Test Vehicle",
    country_id: 1,
    country_code: "US",
    country_name: "United States",
    country_news_signal_id: 10,
    country_news_title: "Some real news title",
    country_news_url: "https://example.com/news",
    country_news_category: "TECH",
    person_id: null,
    person_slug: null,
    person_canonical_name: null,
    vehicle_person_link_id: null,
    person_link_tier: null,
    missing_signals: ["NO_PERSON_SIGNAL"],
    is_complete: false,
    fusion_evidence: {},
    fusion_score: 72.5,
    fusion_version: "1.0.0",
    created_at: new Date(),
    ...overrides
  };
}

function directionRow(runId, id, overrides = {}) {
  return {
    id,
    story_run_id: Number(runId),
    version: 1,
    direction_key: `DIRECTION-${id}`,
    direction_type: "VEHICLE_POWER",
    payload: {},
    validation_status: "PASS",
    validation_issues: [],
    superseded_at: null,
    created_at: new Date(),
    ...overrides
  };
}

function outlineRow(runId, id, overrides = {}) {
  return {
    id,
    story_run_id: Number(runId),
    version: 1,
    payload: {},
    validation_status: "PASS",
    validation_issues: [],
    locked_by: null,
    locked_at: null,
    superseded_at: null,
    created_at: new Date(),
    ...overrides
  };
}

function scriptRow(runId, id, overrides = {}) {
  return {
    id,
    story_run_id: Number(runId),
    version: 1,
    variant_type: "VEHICLE_FIRST",
    payload: {},
    word_count: 90,
    estimated_duration_seconds: 35,
    validation_status: "PASS",
    validation_issues: [],
    locked_by: null,
    locked_at: null,
    superseded_at: null,
    created_at: new Date(),
    ...overrides
  };
}

const VALID_GATE1_BODY = {
  approved_by: "michael",
  candidate_slot_id: "CANDIDATE_SLOT_01",
  beat_id: "BEAT-04",
  apex_stage: "GLOBAL_QUALIFIERS",
  review_language: "zh-TW",
  script_language: "en"
};

async function run() {
  // -------------------------------------------------------
  // Create run.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    const result = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.status, "AWAITING_CANDIDATE_APPROVAL");
    assert.equal(result.payload.data.fusion_candidate_id, "1");
  }

  // -------------------------------------------------------
  // Idempotency replay.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    const first = await createStoryRunHandler(
      pool,
      { fusion_candidate_id: 1 },
      { idempotencyKey: "key-abc" }
    );

    const second = await createStoryRunHandler(
      pool,
      { fusion_candidate_id: 1 },
      { idempotencyKey: "key-abc" }
    );

    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 200);
    assert.equal(second.payload.replayed, true);
    assert.equal(second.payload.data.id, first.payload.data.id);
  }

  // -------------------------------------------------------
  // Idempotency conflict (same key, different candidate).
  // -------------------------------------------------------
  {
    const pool = createMockDb({
      candidates: { 1: seedCandidate(1), 2: seedCandidate(2) }
    });

    await createStoryRunHandler(
      pool,
      { fusion_candidate_id: 1 },
      { idempotencyKey: "key-xyz" }
    );

    const conflict = await createStoryRunHandler(
      pool,
      { fusion_candidate_id: 2 },
      { idempotencyKey: "key-xyz" }
    );

    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.payload.error, "IDEMPOTENCY_CONFLICT");
  }

  // -------------------------------------------------------
  // Missing Fusion Candidate.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: {} });

    const result = await createStoryRunHandler(pool, { fusion_candidate_id: 999 }, {});

    assert.equal(result.statusCode, 404);
    assert.equal(result.payload.error, "FUSION_CANDIDATE_NOT_FOUND");
  }

  // -------------------------------------------------------
  // Duplicate active run.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const second = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});

    assert.equal(second.statusCode, 409);
    assert.equal(second.payload.error, "ACTIVE_STORY_RUN_EXISTS");
  }

  // -------------------------------------------------------
  // Gate 1 valid.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    const result = await approveCandidateHandler(pool, runId, VALID_GATE1_BODY);

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "QUEUED_DIRECTIONS");
  }

  // -------------------------------------------------------
  // Gate 1 wrong state (already queued).
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    await approveCandidateHandler(pool, runId, VALID_GATE1_BODY);
    const second = await approveCandidateHandler(pool, runId, VALID_GATE1_BODY);

    assert.equal(second.statusCode, 409);
    assert.equal(second.payload.error, "INVALID_STORY_STATE");
  }

  // -------------------------------------------------------
  // Gate 2 single select.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;
    await approveCandidateHandler(pool, runId, VALID_GATE1_BODY);

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(1, directionRow(runId, 1));

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1],
      selection_mode: "SINGLE"
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "QUEUED_OUTLINE");
    assert.deepEqual(result.payload.data.selected_direction_ids, ["1"]);
  }

  // -------------------------------------------------------
  // Gate 2 merge select.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(1, directionRow(runId, 1));
    pool._state.directions.set(2, directionRow(runId, 2, { direction_type: "COUNTRY_CONFLICT" }));

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1, 2],
      selection_mode: "MERGE",
      merge_notes: "Combine both."
    });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.payload.data.selected_direction_ids, ["1", "2"]);
  }

  // -------------------------------------------------------
  // Gate 2: selecting a BLOCKED direction rejected.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(
      1,
      directionRow(runId, 1, { validation_status: "BLOCKED" })
    );

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1],
      selection_mode: "SINGLE"
    });

    assert.equal(result.statusCode, 422);
    assert.equal(result.payload.error, "VALIDATION_BLOCKED");
  }

  // -------------------------------------------------------
  // Gate 3 valid lock.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_OUTLINE_LOCK";
    pool._state.outlines.set(1, outlineRow(runId, 1));

    const result = await lockOutlineHandler(pool, runId, {
      approved_by: "michael",
      outline_id: 1,
      lock_note: "Approved for scripts."
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "QUEUED_SCRIPTS");
    assert.equal(pool._state.outlines.get(1).locked_by, "michael");
  }

  // -------------------------------------------------------
  // Gate 3 wrong outline (does not exist / superseded).
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_OUTLINE_LOCK";
    pool._state.outlines.set(1, outlineRow(runId, 1, { superseded_at: new Date() }));

    const result = await lockOutlineHandler(pool, runId, {
      approved_by: "michael",
      outline_id: 1
    });

    assert.equal(result.statusCode, 409);
    assert.equal(result.payload.error, "ARTIFACT_NOT_LOCKABLE");
  }

  // -------------------------------------------------------
  // Gate 4 valid lock.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_SCRIPT_LOCK";
    pool._state.scripts.set(1, scriptRow(runId, 1));

    const result = await lockScriptHandler(pool, runId, {
      approved_by: "michael",
      script_id: 1,
      lock_note: "Final."
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "COMPLETED");
    assert.equal(result.payload.data.selected_script_id, "1");
  }

  // -------------------------------------------------------
  // Gate 4: a BLOCKED script cannot be locked.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_SCRIPT_LOCK";
    pool._state.scripts.set(1, scriptRow(runId, 1, { validation_status: "BLOCKED" }));

    const result = await lockScriptHandler(pool, runId, {
      approved_by: "michael",
      script_id: 1
    });

    assert.equal(result.statusCode, 422);
    assert.equal(result.payload.error, "VALIDATION_BLOCKED");
  }

  // -------------------------------------------------------
  // Regenerate retains history (old artifact superseded, not
  // deleted).
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_OUTLINE_LOCK";
    pool._state.outlines.set(1, outlineRow(runId, 1));

    const result = await regenerateHandler(pool, runId, {
      approved_by: "michael",
      stage: "OUTLINE",
      revision_notes: "Make it punchier."
    });

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.status, "QUEUED_OUTLINE");

    const oldOutline = pool._state.outlines.get(1);
    assert.ok(oldOutline.superseded_at !== null, "old outline must be superseded, not deleted");
    assert.ok(pool._state.outlines.has(1), "old outline row must still exist");
  }

  // -------------------------------------------------------
  // Cancel.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    const result = await cancelHandler(pool, runId, { reason: "no longer needed" });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "CANCELLED");
  }

  // -------------------------------------------------------
  // Resume.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    const row = pool._state.runs.get(Number(runId));
    row.status = "FAILED";
    row.failure_stage = "OUTLINE";

    const result = await resumeHandler(pool, runId);

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.status, "QUEUED_OUTLINE");
    assert.equal(result.payload.data.failure_stage, null);
  }

  // -------------------------------------------------------
  // List / detail.
  // -------------------------------------------------------
  {
    const pool = createMockDb({
      candidates: { 1: seedCandidate(1), 2: seedCandidate(2) }
    });

    await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    await createStoryRunHandler(pool, { fusion_candidate_id: 2 }, {});

    const listResult = await listStoryRuns(pool, new URLSearchParams());
    assert.equal(listResult.statusCode, 200);
    assert.equal(listResult.payload.count, 2);

    const detailResult = await getStoryRun(pool, 1);
    assert.equal(detailResult.statusCode, 200);
    assert.equal(detailResult.payload.data.run.id, "1");
    assert.equal(detailResult.payload.data.can_approve_candidate, true);
    assert.equal(detailResult.payload.data.can_cancel, true);
    assert.equal(detailResult.payload.data.can_resume, false);
  }

  // -------------------------------------------------------
  // Invalid ID (detail of a nonexistent run).
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: {} });

    const result = await getStoryRun(pool, 9999);

    assert.equal(result.statusCode, 404);
    assert.equal(result.payload.error, "STORY_RUN_NOT_FOUND");
  }

  // -------------------------------------------------------
  // Invalid JSON body shape (not an object).
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    const result = await createStoryRunHandler(pool, "not-an-object", {});

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.error, "VALIDATION_ERROR");
  }

  console.log("TASK 3.4E STORY API TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

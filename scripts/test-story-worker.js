const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { pollStoryQueue } = require("../lib/story/worker");
const {
  claimNextStoryRun,
  executeDirectionsGeneration,
  executeOutlineGeneration,
  executeScriptsGeneration,
  regenerateStage,
  resumeRun,
  cancelRun,
  withStageOwnership
} = require("../lib/story/engine");
const { CanonError } = require("../lib/story/canon");

// ---------------------------------------------------------
// No real Postgres connection is used anywhere in this file.
// The bulk of these cases inject a fake processNextStoryRun,
// exactly like scripts/test-autoflow-worker.js does for
// AutoFlow. A small dedicated in-memory mock pool (covering
// only story_pipeline_runs, the one table claimNextStoryRun
// touches) is used for the stale-lease-recovery case, which
// genuinely needs claim/lease SQL semantics.
// ---------------------------------------------------------

function createLogSink() {
  const infoLogs = [];
  const errorLogs = [];

  return {
    infoLogs,
    errorLogs,
    log(event, fields = {}) {
      infoLogs.push({ event, ...fields });
    },
    logError(event, error, fields = {}) {
      errorLogs.push({
        event,
        error: String(error?.message || "Unknown worker error"),
        code: error?.code || null,
        ...fields
      });
    }
  };
}

const FAKE_POOL = { fake_pool: true };

// ---------------------------------------------------------
// Minimal in-memory mock pool for story_pipeline_runs, used
// only by the stale-lease-recovery integration test below.
// ---------------------------------------------------------

// ---------------------------------------------------------
// Full in-memory mock pool covering every table the worker
// touches: story_pipeline_runs, story_directions,
// story_outlines, story_scripts, story_generation_attempts,
// story_pipeline_events. Supports claim/lease semantics,
// Regenerate, Resume, Cancel, and the atomic ownership-checked
// persist path (withStageOwnership) engine.js now uses for
// every generation stage.
// ---------------------------------------------------------

function createMockStoryPool(initialRows, { directions = [], outlines = [] } = {}) {
  const state = {
    runs: new Map(initialRows.map(row => [row.id, { ...row }])),
    directions: new Map(directions.map(row => [row.id, { ...row }])),
    outlines: new Map(outlines.map(row => [row.id, { ...row }])),
    scripts: new Map(),
    events: [],
    nextDirectionId: 1000,
    nextOutlineId: 2000,
    nextScriptId: 3000,
    nextEventId: 1
  };

  let snapshot = null;

  function cloneState() {
    return {
      runs: new Map([...state.runs].map(([k, v]) => [k, { ...v }])),
      directions: new Map([...state.directions].map(([k, v]) => [k, { ...v }])),
      outlines: new Map([...state.outlines].map(([k, v]) => [k, { ...v }])),
      scripts: new Map([...state.scripts].map(([k, v]) => [k, { ...v }])),
      events: state.events.map(e => ({ ...e }))
    };
  }

  async function query(sql, values = []) {
    const trimmed = String(sql).trim();
    const upper = trimmed.toUpperCase();

    if (upper === "BEGIN") {
      snapshot = cloneState();
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
        state.events = snapshot.events;
        snapshot = null;
      }
      return { rows: [], rowCount: 0 };
    }

    // ------------------ claim ------------------

    if (
      trimmed.includes("FROM story_pipeline_runs") &&
      trimmed.includes("FOR UPDATE SKIP LOCKED")
    ) {
      const [queuedStatuses, generatingStatuses] = values;
      const now = new Date();

      const matches = [...state.runs.values()].filter(row => {
        if (queuedStatuses.includes(row.status)) return true;

        if (
          generatingStatuses.includes(row.status) &&
          row.lease_expires_at !== null &&
          new Date(row.lease_expires_at) < now
        ) {
          return true;
        }

        return false;
      });

      matches.sort(
        (a, b) =>
          new Date(a.created_at) - new Date(b.created_at) || a.id - b.id
      );

      const match = matches[0];

      return match
        ? { rows: [{ ...match }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (trimmed.includes("lease_expires_at = NOW() + ($3")) {
      const [status, workerId, leaseMs, attemptCount, stageAttemptCount, id] = values;
      const row = state.runs.get(id);

      row.status = status;
      row.current_stage = status;
      row.worker_id = workerId;
      row.lease_expires_at = new Date(Date.now() + Number(leaseMs));
      row.attempt_count = attemptCount;
      row.stage_attempt_count = stageAttemptCount;
      row.updated_at = new Date();

      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (trimmed.includes("STAGE_MAX_ATTEMPTS_EXCEEDED")) {
      const [stage, message, attemptCount, stageAttemptCount, id] = values;
      const row = state.runs.get(id);

      row.status = "FAILED";
      row.current_stage = "FAILED";
      row.failure_stage = stage;
      row.error_code = "STAGE_MAX_ATTEMPTS_EXCEEDED";
      row.error_message = message;
      row.attempt_count = attemptCount;
      row.stage_attempt_count = stageAttemptCount;
      row.worker_id = null;
      row.lease_expires_at = null;

      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ fetchRunForUpdate / fetchRun ------------------

    if (
      trimmed.includes("FROM story_pipeline_runs WHERE id = $1") &&
      trimmed.includes("FOR UPDATE")
    ) {
      const row = state.runs.get(Number(values[0]));

      if (!row) {
        return { rows: [], rowCount: 0 };
      }

      const leaseIsValid =
        row.lease_expires_at !== null &&
        row.lease_expires_at !== undefined &&
        new Date(row.lease_expires_at) > new Date();

      return {
        rows: [{ ...row, lease_is_valid: leaseIsValid }],
        rowCount: 1
      };
    }

    if (trimmed === "SELECT * FROM story_pipeline_runs WHERE id = $1") {
      const row = state.runs.get(Number(values[0]));
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    // ------------------ regenerateStage ------------------

    if (
      trimmed.startsWith("UPDATE story_directions") &&
      trimmed.includes("SET superseded_at = NOW()")
    ) {
      const [runId] = values;
      for (const d of state.directions.values()) {
        if (d.story_run_id === Number(runId) && d.superseded_at === null) {
          d.superseded_at = new Date();
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
          o.superseded_at = new Date();
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
          s.superseded_at = new Date();
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
      row.stage_attempt_count = 0;
      row.updated_at = new Date();

      if (trimmed.includes("selected_direction_ids = '[]'")) {
        row.selected_direction_ids = [];
      }
      if (trimmed.includes("selection_mode = NULL")) {
        row.selection_mode = null;
      }
      if (trimmed.includes("merge_notes = NULL")) {
        row.merge_notes = null;
      }
      if (trimmed.includes("selected_script_id = NULL")) {
        row.selected_script_id = null;
      }

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
      row.updated_at = new Date();
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
      row.cancelled_at = new Date();
      row.updated_at = new Date();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ latestRevisionNotes ------------------

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

    // ------------------ story_directions (selected, for Outline prompt) ------------------

    if (
      trimmed.includes("FROM story_directions") &&
      trimmed.includes("id = ANY($2::bigint[])") &&
      trimmed.includes("ORDER BY id ASC")
    ) {
      const [runId, ids] = values;
      const idSet = new Set((ids || []).map(String));

      const matches = [...state.directions.values()]
        .filter(d => d.story_run_id === Number(runId) && idSet.has(String(d.id)))
        .sort((a, b) => a.id - b.id);

      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    // ------------------ story_outlines (locked, for Scripts prompt) ------------------

    if (
      trimmed.includes("FROM story_outlines") &&
      trimmed.includes("locked_at IS NOT NULL")
    ) {
      const [runId] = values;
      const matches = [...state.outlines.values()]
        .filter(o => o.story_run_id === Number(runId) && o.locked_at !== null)
        .sort((a, b) => new Date(b.locked_at) - new Date(a.locked_at));

      return matches.length > 0
        ? { rows: [{ ...matches[0] }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    // ------------------ nextArtifactVersion ------------------

    if (trimmed.includes("COALESCE(MAX(version), 0)")) {
      const [runId] = values;
      const table = /FROM (story_\w+)/.exec(trimmed)[1];
      const map = state[table.replace("story_", "")];

      const maxVersion = [...map.values()]
        .filter(row => row.story_run_id === Number(runId))
        .reduce((max, row) => Math.max(max, row.version), 0);

      return { rows: [{ max_version: maxVersion }], rowCount: 1 };
    }

    // ------------------ artifact inserts ------------------

    if (trimmed.startsWith("INSERT INTO story_directions")) {
      const [runId, version, directionKey, directionType, payload, validationStatus, validationIssues] = values;
      const id = state.nextDirectionId++;
      state.directions.set(id, {
        id,
        story_run_id: Number(runId),
        version,
        direction_key: directionKey,
        direction_type: directionType,
        payload: JSON.parse(payload),
        validation_status: validationStatus,
        validation_issues: JSON.parse(validationIssues),
        superseded_at: null,
        created_at: new Date()
      });
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.startsWith("INSERT INTO story_outlines")) {
      const [runId, version, payload, validationStatus, validationIssues] = values;
      const id = state.nextOutlineId++;
      state.outlines.set(id, {
        id,
        story_run_id: Number(runId),
        version,
        payload: JSON.parse(payload),
        validation_status: validationStatus,
        validation_issues: JSON.parse(validationIssues),
        locked_by: null,
        locked_at: null,
        superseded_at: null,
        created_at: new Date()
      });
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.startsWith("INSERT INTO story_scripts")) {
      const [runId, version, variantType, payload, wordCount, duration, validationStatus, validationIssues] = values;
      const id = state.nextScriptId++;
      state.scripts.set(id, {
        id,
        story_run_id: Number(runId),
        version,
        variant_type: variantType,
        payload: JSON.parse(payload),
        word_count: wordCount,
        estimated_duration_seconds: duration,
        validation_status: validationStatus,
        validation_issues: JSON.parse(validationIssues),
        locked_by: null,
        locked_at: null,
        superseded_at: null,
        created_at: new Date()
      });
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.startsWith("INSERT INTO story_generation_attempts")) {
      return { rows: [], rowCount: 1 };
    }

    // ------------------ post-generation run advance (AWAITING_*) ------------------

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      /SET\s+status = 'AWAITING_/.test(trimmed) &&
      !trimmed.includes("worker_id = NULL AND")
    ) {
      const [runId] = values;
      const row = state.runs.get(Number(runId));
      const nextStatus = /status = '([A-Z_]+)'/.exec(trimmed)[1];

      row.status = nextStatus;
      row.current_stage = nextStatus;
      row.worker_id = null;
      row.lease_expires_at = null;
      row.updated_at = new Date();

      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ generation failure persist ------------------

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'FAILED'") &&
      trimmed.includes("failure_stage = $1")
    ) {
      const [stage, errorCode, errorMessage, runId] = values;
      const row = state.runs.get(Number(runId));

      row.status = "FAILED";
      row.current_stage = "FAILED";
      row.failure_stage = stage;
      row.error_code = errorCode;
      row.error_message = errorMessage;
      row.worker_id = null;
      row.lease_expires_at = null;
      row.updated_at = new Date();

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
        created_at: new Date()
      });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled mock query: ${trimmed.slice(0, 160)}`);
  }

  return {
    async connect() {
      return { query, release() {} };
    },
    query,
    _state: state
  };
}

async function run() {
  // -------------------------------------------------------
  // Case 1: no run at all -> unprocessed, silent.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollStoryQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextStoryRun: async () => null
    });

    assert.equal(processed, false);
    assert.deepEqual(sink.infoLogs, []);
  }

  // -------------------------------------------------------
  // Case 2: human waiting (every run sits in an AWAITING_*
  // Human Gate, invisible to claim) -> also null, also
  // silent. No 250ms spam log while a human gate is pending.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollStoryQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextStoryRun: async () => null
    });

    assert.equal(processed, false);
    assert.deepEqual(sink.infoLogs, []);
  }

  // -------------------------------------------------------
  // Case 3: directions generated -> material, logged.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollStoryQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextStoryRun: async () => ({
        outcome: "STAGE_ADVANCED",
        stage: "DIRECTIONS",
        run: { id: 1 }
      })
    });

    assert.equal(processed, true);
    assert.equal(sink.infoLogs.length, 1);
    assert.equal(sink.infoLogs[0].event, "story_directions_generated");
  }

  // -------------------------------------------------------
  // Case 4: outline generated.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollStoryQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextStoryRun: async () => ({
        outcome: "STAGE_ADVANCED",
        stage: "OUTLINE",
        run: { id: 2 }
      })
    });

    assert.equal(processed, true);
    assert.equal(sink.infoLogs[0].event, "story_outline_generated");
  }

  // -------------------------------------------------------
  // Case 5: scripts generated.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollStoryQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextStoryRun: async () => ({
        outcome: "STAGE_ADVANCED",
        stage: "SCRIPTS",
        run: { id: 3 }
      })
    });

    assert.equal(processed, true);
    assert.equal(sink.infoLogs[0].event, "story_scripts_generated");
  }

  // -------------------------------------------------------
  // Case 6: provider failure is a material failure (must be
  // logged and reported processed, not silently dropped).
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollStoryQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextStoryRun: async () => ({
        outcome: "RUN_FAILED",
        stage: "OUTLINE",
        runId: "9",
        errorCode: "PROVIDER_UPSTREAM_ERROR"
      })
    });

    assert.equal(processed, true);
    assert.equal(sink.infoLogs[0].event, "story_generation_failed");
    assert.equal(sink.infoLogs[0].run_id, "9");
    assert.equal(sink.infoLogs[0].code, "PROVIDER_UPSTREAM_ERROR");
  }

  // -------------------------------------------------------
  // Case 7: NO_CHANGE must never block the next queue in the
  // fair-rotation loop.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollStoryQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextStoryRun: async () => ({ outcome: "NO_CHANGE" })
    });

    assert.equal(processed, false);
    assert.deepEqual(sink.infoLogs, []);
  }

  {
    const sink = createLogSink();
    let nextPollerCalled = false;

    async function fakeStoryPoller() {
      return pollStoryQueue({
        pool: FAKE_POOL,
        workerId: "test-worker",
        log: sink.log,
        logError: sink.logError,
        processNextStoryRun: async () => ({ outcome: "NO_CHANGE" })
      });
    }

    async function fakeNextPoller() {
      nextPollerCalled = true;
      return true;
    }

    const pollers = [fakeStoryPoller, fakeNextPoller];
    let processedRun = false;

    for (let i = 0; i < pollers.length && !processedRun; i += 1) {
      processedRun = Boolean(await pollers[i]());
    }

    assert.equal(nextPollerCalled, true);
    assert.equal(processedRun, true);
  }

  // -------------------------------------------------------
  // Case 8: workerId reaches the engine call unmodified, and
  // the pool is forwarded untouched (worker.js never calls
  // pool.connect/query itself -- only the injected function
  // does).
  // -------------------------------------------------------
  {
    const sink = createLogSink();
    let receivedPool = null;
    let receivedOptions = null;

    await pollStoryQueue({
      pool: FAKE_POOL,
      workerId: "test-worker-42",
      log: sink.log,
      logError: sink.logError,
      processNextStoryRun: async (pool, options) => {
        receivedPool = pool;
        receivedOptions = options;
        return null;
      }
    });

    assert.equal(receivedPool, FAKE_POOL);
    assert.equal(receivedOptions.workerId, "test-worker-42");
  }

  // -------------------------------------------------------
  // Case 9: schema not migrated yet (42P01) -> logs
  // story_schema_waiting, never throws.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollStoryQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextStoryRun: async () => {
        const error = new Error('relation "story_pipeline_runs" does not exist');
        error.code = "42P01";
        throw error;
      }
    });

    assert.equal(processed, false);
    assert.equal(sink.infoLogs.length, 1);
    assert.equal(sink.infoLogs[0].event, "story_schema_waiting");
    assert.deepEqual(sink.errorLogs, []);
  }

  // -------------------------------------------------------
  // Case 10: unexpected error is reported via logError, not
  // swallowed, while still returning false.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollStoryQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextStoryRun: async () => {
        throw new Error("connection reset");
      }
    });

    assert.equal(processed, false);
    assert.equal(sink.errorLogs.length, 1);
    assert.equal(sink.errorLogs[0].event, "story_poll_failed");
  }

  // -------------------------------------------------------
  // Case 11: fair rotation -- the five pre-existing queues
  // must remain reachable with Story added as a sixth poller.
  // -------------------------------------------------------
  {
    const sink = createLogSink();
    const calledQueues = [];

    async function fakeScannerPoller() {
      calledQueues.push("scanner");
      return false;
    }
    async function fakeCountryNewsPoller() {
      calledQueues.push("country_news");
      return false;
    }
    async function fakePersonPoller() {
      calledQueues.push("person");
      return false;
    }
    async function fakeFusionPoller() {
      calledQueues.push("fusion");
      return false;
    }
    async function fakeAutoflowPoller() {
      calledQueues.push("autoflow");
      return false;
    }
    async function fakeStoryPoller() {
      calledQueues.push("story");
      return pollStoryQueue({
        pool: FAKE_POOL,
        workerId: "test-worker",
        log: sink.log,
        logError: sink.logError,
        processNextStoryRun: async () => ({
          outcome: "STAGE_ADVANCED",
          stage: "DIRECTIONS",
          run: { id: 5 }
        })
      });
    }

    const pollers = [
      fakeScannerPoller,
      fakeCountryNewsPoller,
      fakePersonPoller,
      fakeFusionPoller,
      fakeAutoflowPoller,
      fakeStoryPoller
    ];

    let processedRun = false;

    for (let i = 0; i < pollers.length && !processedRun; i += 1) {
      processedRun = Boolean(await pollers[i]());
    }

    assert.equal(processedRun, true);
    assert.deepEqual(calledQueues, [
      "scanner",
      "country_news",
      "person",
      "fusion",
      "autoflow",
      "story"
    ]);
  }

  // -------------------------------------------------------
  // Case 12 (engine-level, structural): provider requests
  // must never run inside a DB transaction. Every
  // executeXGeneration function must call deps.generateJson
  // but never open its own transaction (claimNextStoryRun is
  // the only function that does BEGIN/COMMIT, and it always
  // commits before generation starts).
  // -------------------------------------------------------
  {
    const engineSource = fs.readFileSync(
      path.join(__dirname, "..", "lib", "story", "engine.js"),
      "utf8"
    );

    for (const fnName of [
      "executeDirectionsGeneration",
      "executeOutlineGeneration",
      "executeScriptsGeneration"
    ]) {
      const start = engineSource.indexOf(`async function ${fnName}`);
      assert.ok(start > -1, `${fnName} not found`);

      const nextFnMatch = engineSource
        .slice(start + 10)
        .match(/\nasync function |\nfunction /);

      const end = nextFnMatch
        ? start + 10 + nextFnMatch.index
        : engineSource.length;

      const body = engineSource.slice(start, end);

      assert.ok(
        body.includes("deps.generateJson("),
        `${fnName} must call deps.generateJson`
      );
      assert.ok(
        !body.includes('"BEGIN"') && !body.includes("'BEGIN'"),
        `${fnName} must not open its own DB transaction`
      );
    }
  }

  // -------------------------------------------------------
  // Case 13 (engine-level, integration): stale lease
  // recovery. A GENERATING_DIRECTIONS run whose lease expired
  // in the past must be reclaimed by a new worker, with
  // worker_id updated and attempt_count incremented -- proving
  // a crashed worker's claim is never permanently stuck.
  // -------------------------------------------------------
  {
    const past = new Date(Date.now() - 60000);

    const pool = createMockStoryPool([
      {
        id: 42,
        status: "GENERATING_DIRECTIONS",
        current_stage: "GENERATING_DIRECTIONS",
        worker_id: "dead-worker",
        lease_expires_at: past,
        attempt_count: 1,
        stage_attempt_count: 1,
        created_at: new Date(Date.now() - 120000)
      }
    ]);

    const claimed = await claimNextStoryRun(pool, "new-worker", {
      leaseDurationMs: 300000
    });

    assert.ok(claimed);
    assert.equal(claimed.outcome, "CLAIMED");
    assert.equal(claimed.stage, "DIRECTIONS");
    assert.equal(claimed.run.worker_id, "new-worker");
    assert.equal(claimed.run.attempt_count, 2);
    assert.equal(claimed.run.stage_attempt_count, 2);
    assert.ok(new Date(claimed.run.lease_expires_at) > new Date());
  }

  function baseRunRow(overrides = {}) {
    return {
      id: 1,
      idempotency_key: null,
      fusion_candidate_id: 1,
      status: "QUEUED_DIRECTIONS",
      current_stage: "QUEUED_DIRECTIONS",
      candidate_snapshot: {
        fusion_candidate_id: "1",
        vehicle: { id: "1", code: "VH-1", name: "Test Vehicle" },
        country: { id: "1", code: "US", name: "United States" },
        country_news: { id: "10", title: "News", url: "https://example.com" },
        person: null,
        vehicle_person_link: null,
        historical_resonance: null,
        missing_signals: ["NO_PERSON_SIGNAL"],
        no_person_signal: true,
        is_complete: false,
        fusion_score: 70,
        fusion_version: "1.0.0",
        evidence: [{ id: "vehicle:1", type: "VEHICLE" }]
      },
      candidate_snapshot_hash: "sha256:fixed",
      canon_version: "1.0.0",
      rules_version: "1.0.0",
      season_version: "1.0.0",
      canon_hash: "sha256:locked-canon-hash",
      candidate_slot_id: "CANDIDATE_SLOT_01",
      beat_id: "BEAT-01",
      apex_stage: "GLOBAL_QUALIFIERS",
      creator_notes: null,
      forbidden_elements: [],
      review_language: "en",
      script_language: "en",
      selected_direction_ids: [],
      selection_mode: null,
      merge_notes: null,
      selected_script_id: null,
      failure_stage: null,
      error_code: null,
      error_message: null,
      worker_id: "worker-a",
      lease_expires_at: new Date(Date.now() + 300000),
      attempt_count: 0,
      stage_attempt_count: 0,
      created_at: new Date(Date.now() - 1000),
      updated_at: new Date(),
      completed_at: null,
      cancelled_at: null,
      ...overrides
    };
  }

  const FAKE_CANON_BUNDLE = {
    canon_version: "1.0.0",
    rules_version: "1.0.0",
    season_version: "1.0.0",
    canon_hash: "sha256:locked-canon-hash",
    story_bible: "bible",
    apex_rules: "rules",
    season_outline: "outline",
    state_model: "state model"
  };

  function makeDirectionPayload(type) {
    return {
      direction_key: `DIRECTION-${type}`,
      direction_type: type,
      title: "T",
      review_summary: "s",
      hook: "h",
      logline: "l",
      core_conflict: "c",
      why_now: "w",
      vehicle_transformation: {
        evidence_vehicle: "Real Car",
        canon_vehicle_name: "Fictional Vehicle",
        preserved_traits: [],
        changed_traits: [],
        official_partnership_implied: false
      },
      character_concept: {
        canon_driver_name: "Fictional Driver",
        canon_team_name: "Fictional Team",
        motivation: "m",
        internal_conflict: "i"
      },
      evidence_refs: ["vehicle:1"],
      canon_connections: [],
      season_function: "sf",
      beat_connection: "bc",
      proposed_state_changes: [],
      risk_flags: []
    };
  }

  function fourDirections() {
    return [
      makeDirectionPayload("VEHICLE_POWER"),
      makeDirectionPayload("COUNTRY_CONFLICT"),
      makeDirectionPayload("PERSON_CULTURE"),
      makeDirectionPayload("APEX_PROGRESSION")
    ];
  }

  // =========================================================
  // Section 1 fix: stage_attempt_count semantics.
  // =========================================================

  // Normal DIRECTIONS -> OUTLINE -> SCRIPTS never exceeds the
  // per-stage ceiling, even though the lifetime attempt_count
  // grows past 3.
  {
    const pool = createMockStoryPool([
      baseRunRow({ status: "QUEUED_DIRECTIONS", worker_id: null, lease_expires_at: null })
    ]);

    const claim1 = await claimNextStoryRun(pool, "w1");
    assert.equal(claim1.outcome, "CLAIMED");
    assert.equal(claim1.run.stage_attempt_count, 1);
    assert.equal(claim1.run.attempt_count, 1);

    // Simulate Gate 2 advancing to the next stage (resets
    // stage_attempt_count, as selectDirection now does).
    const row = pool._state.runs.get(1);
    row.status = "QUEUED_OUTLINE";
    row.stage_attempt_count = 0;
    row.worker_id = null;
    row.lease_expires_at = null;

    const claim2 = await claimNextStoryRun(pool, "w1");
    assert.equal(claim2.outcome, "CLAIMED");
    assert.equal(claim2.run.stage_attempt_count, 1);
    assert.equal(claim2.run.attempt_count, 2);

    row.status = "QUEUED_SCRIPTS";
    row.stage_attempt_count = 0;
    row.worker_id = null;
    row.lease_expires_at = null;

    const claim3 = await claimNextStoryRun(pool, "w1");
    assert.equal(claim3.outcome, "CLAIMED");
    assert.equal(claim3.run.stage_attempt_count, 1);
    assert.equal(claim3.run.attempt_count, 3);
  }

  // First Script batch, then regenerate SCRIPTS -> can claim
  // again even though stage_attempt_count was already at the
  // ceiling.
  {
    const pool = createMockStoryPool([
      baseRunRow({
        status: "AWAITING_SCRIPT_LOCK",
        worker_id: null,
        lease_expires_at: null,
        stage_attempt_count: 3
      })
    ]);

    const regenerated = await regenerateStage(pool, 1, {
      approved_by: "michael",
      stage: "SCRIPTS",
      revision_notes: "try again"
    });

    assert.equal(regenerated.status, "QUEUED_SCRIPTS");
    assert.equal(regenerated.stage_attempt_count, 0);

    const claimed = await claimNextStoryRun(pool, "w1");
    assert.equal(claimed.outcome, "CLAIMED");
    assert.equal(claimed.run.stage_attempt_count, 1);
  }

  // Regenerate DIRECTIONS, then still able to proceed through
  // Outline and Scripts (stage_attempt_count keeps resetting
  // per stage).
  {
    const pool = createMockStoryPool([
      baseRunRow({
        status: "AWAITING_DIRECTION_SELECTION",
        worker_id: null,
        lease_expires_at: null,
        stage_attempt_count: 2
      })
    ]);

    await regenerateStage(pool, 1, {
      approved_by: "michael",
      stage: "DIRECTIONS",
      revision_notes: "more distinct"
    });

    assert.equal(pool._state.runs.get(1).stage_attempt_count, 0);

    const claimDirections = await claimNextStoryRun(pool, "w1");
    assert.equal(claimDirections.outcome, "CLAIMED");
    assert.equal(claimDirections.run.stage_attempt_count, 1);

    const row = pool._state.runs.get(1);
    row.status = "QUEUED_OUTLINE";
    row.stage_attempt_count = 0;
    row.worker_id = null;
    row.lease_expires_at = null;

    const claimOutline = await claimNextStoryRun(pool, "w1");
    assert.equal(claimOutline.outcome, "CLAIMED");
    assert.equal(claimOutline.run.stage_attempt_count, 1);
  }

  // A failed OUTLINE run resumed must NOT reset (and must not
  // be confused with) whatever attempts DIRECTIONS used --
  // stage_attempt_count only ever reflects OUTLINE's own count.
  {
    const pool = createMockStoryPool([
      baseRunRow({
        status: "FAILED",
        failure_stage: "OUTLINE",
        worker_id: null,
        lease_expires_at: null,
        attempt_count: 6,
        stage_attempt_count: 2
      })
    ]);

    const resumed = await resumeRun(pool, 1);
    assert.equal(resumed.status, "QUEUED_OUTLINE");
    // Resume preserves the stage's own attempt count -- it is
    // not reset to 0 (only Regenerate does that).
    assert.equal(resumed.stage_attempt_count, 2);

    const claimed = await claimNextStoryRun(pool, "w1");
    assert.equal(claimed.outcome, "CLAIMED");
    assert.equal(claimed.run.stage_attempt_count, 3);
  }

  // Same stage: only the 4th claim attempt trips
  // STAGE_MAX_ATTEMPTS_EXCEEDED.
  {
    const pool = createMockStoryPool([
      baseRunRow({ status: "QUEUED_DIRECTIONS", worker_id: null, lease_expires_at: null })
    ]);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const claimed = await claimNextStoryRun(pool, "w1");
      assert.equal(claimed.outcome, "CLAIMED");
      assert.equal(claimed.run.stage_attempt_count, attempt);

      // Simulate the generation failing and being resumed,
      // without resetting stage_attempt_count.
      const row = pool._state.runs.get(1);
      row.status = "QUEUED_DIRECTIONS";
      row.worker_id = null;
      row.lease_expires_at = null;
    }

    const fourthClaim = await claimNextStoryRun(pool, "w1");
    assert.equal(fourthClaim.outcome, "RUN_FAILED");
    assert.equal(fourthClaim.run.error_code, "STAGE_MAX_ATTEMPTS_EXCEEDED");
    assert.equal(fourthClaim.run.stage_attempt_count, 4);
  }

  // =========================================================
  // Section 3 fix: Canon Bundle locked at Gate 1 -- every
  // generation stage must fail closed if Canon drifted.
  // =========================================================

  // Directions generation uses the exact locked hash (happy
  // path proves the mismatch check doesn't false-positive).
  {
    const pool = createMockStoryPool([
      baseRunRow({ status: "GENERATING_DIRECTIONS" })
    ]);

    const result = await executeDirectionsGeneration(
      pool,
      pool._state.runs.get(1),
      {
        loadCanonBundle: () => FAKE_CANON_BUNDLE,
        generateJson: async () => ({
          data: fourDirections(),
          provider: "gemini",
          model: "test-model",
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          latencyMs: 10
        })
      }
    );

    assert.equal(result.outcome, "STAGE_ADVANCED");
    assert.equal(result.run.status, "AWAITING_DIRECTION_SELECTION");
  }

  // Outline generation fails closed with CANON_CHANGED_DURING_RUN
  // when the freshly-loaded bundle's hash differs from the
  // run's locked hash -- the provider is never called.
  {
    const pool = createMockStoryPool([
      baseRunRow({ status: "GENERATING_OUTLINE" })
    ]);

    let providerCalled = false;

    const result = await executeOutlineGeneration(
      pool,
      pool._state.runs.get(1),
      {
        loadCanonBundle: () => ({
          ...FAKE_CANON_BUNDLE,
          canon_hash: "sha256:different-hash-now"
        }),
        generateJson: async () => {
          providerCalled = true;
          throw new Error("must never be called");
        }
      }
    );

    assert.equal(providerCalled, false);
    assert.equal(result.outcome, "RUN_FAILED");
    assert.equal(result.stage, "OUTLINE");

    const row = pool._state.runs.get(1);
    assert.equal(row.status, "FAILED");
    assert.equal(row.error_code, "CANON_CHANGED_DURING_RUN");
  }

  // Scripts generation also fails closed on Canon drift.
  {
    const pool = createMockStoryPool(
      [baseRunRow({ status: "GENERATING_SCRIPTS" })],
      {
        outlines: [
          {
            id: 500,
            story_run_id: 1,
            version: 1,
            payload: { outline_title: "T" },
            validation_status: "PASS",
            validation_issues: [],
            locked_by: "michael",
            locked_at: new Date(),
            superseded_at: null,
            created_at: new Date()
          }
        ]
      }
    );

    let providerCalled = false;

    const result = await executeScriptsGeneration(
      pool,
      pool._state.runs.get(1),
      {
        loadCanonBundle: () => ({
          ...FAKE_CANON_BUNDLE,
          rules_version: "2.0.0"
        }),
        generateJson: async () => {
          providerCalled = true;
          throw new Error("must never be called");
        }
      }
    );

    assert.equal(providerCalled, false);
    assert.equal(result.outcome, "RUN_FAILED");

    const row = pool._state.runs.get(1);
    assert.equal(row.error_code, "CANON_CHANGED_DURING_RUN");
  }

  // Regenerate does not bypass the locked Canon check -- a
  // Regenerate-queued run still fails closed on Canon drift.
  {
    const pool = createMockStoryPool([
      baseRunRow({ status: "AWAITING_DIRECTION_SELECTION", worker_id: null, lease_expires_at: null })
    ]);

    await regenerateStage(pool, 1, {
      approved_by: "michael",
      stage: "DIRECTIONS",
      revision_notes: "again"
    });

    const claimed = await claimNextStoryRun(pool, "w1");
    assert.equal(claimed.outcome, "CLAIMED");

    const result = await executeDirectionsGeneration(
      pool,
      claimed.run,
      {
        loadCanonBundle: () => ({
          ...FAKE_CANON_BUNDLE,
          canon_hash: "sha256:drifted-after-regenerate"
        }),
        generateJson: async () => {
          throw new Error("must never be called");
        }
      }
    );

    assert.equal(result.outcome, "RUN_FAILED");
    assert.equal(pool._state.runs.get(1).error_code, "CANON_CHANGED_DURING_RUN");
  }

  // =========================================================
  // Section 2 fix: the worker's provider input receives the
  // exact merge_notes persisted at Gate 2, not a guess derived
  // from selected_direction_ids.length.
  // =========================================================
  {
    const pool = createMockStoryPool(
      [
        baseRunRow({
          status: "GENERATING_OUTLINE",
          selected_direction_ids: ["1000", "1001"],
          selection_mode: "MERGE",
          merge_notes: "Exact merge instructions from Gate 2."
        })
      ],
      {
        directions: [
          { id: 1000, story_run_id: 1, version: 1, direction_key: "DIRECTION-1", direction_type: "VEHICLE_POWER", payload: makeDirectionPayload("VEHICLE_POWER"), validation_status: "PASS", validation_issues: [], superseded_at: null, created_at: new Date() },
          { id: 1001, story_run_id: 1, version: 1, direction_key: "DIRECTION-2", direction_type: "COUNTRY_CONFLICT", payload: makeDirectionPayload("COUNTRY_CONFLICT"), validation_status: "PASS", validation_issues: [], superseded_at: null, created_at: new Date() }
        ]
      }
    );

    let capturedInput = null;

    const longOutline = "A".repeat(100);

    await executeOutlineGeneration(
      pool,
      pool._state.runs.get(1),
      {
        loadCanonBundle: () => FAKE_CANON_BUNDLE,
        generateJson: async ({ input }) => {
          capturedInput = input;
          return {
            data: {
              outline_title: "T",
              review_summary: "s",
              opening_situation: longOutline,
              inciting_incident: longOutline,
              vehicle_and_driver_introduction: longOutline,
              world_conflict: longOutline,
              qualifier_challenge: longOutline,
              escalation: longOutline,
              choice_or_sacrifice: longOutline,
              outcome: longOutline,
              canon_state_impact: {
                state: "PROPOSED_STATE_CHANGE",
                target_state: "QUALIFIER_ENTERED",
                entity_type: "DRIVER",
                previous_state: "CANDIDATE_APPROVED",
                evidence_refs: ["vehicle:1"],
                reason: "r"
              },
              next_episode_hook: longOutline,
              evidence_map: ["vehicle:1"],
              canon_constraints: [],
              forbidden_elements_respected: [],
              short_structure: { hook_seconds: 3, estimated_duration_seconds: 35, narrative_beats: ["b"] }
            },
            provider: "gemini",
            model: "test-model",
            inputTokens: 1,
            outputTokens: 1,
            totalTokens: 2,
            latencyMs: 10
          };
        }
      }
    );

    assert.ok(capturedInput);
    assert.equal(capturedInput.merge_notes, "Exact merge instructions from Gate 2.");
    assert.equal(capturedInput.selection_mode, "MERGE");
  }

  // =========================================================
  // Section 6 fix: atomic artifact persist, ownership-checked.
  // =========================================================

  // Cancel during the provider call leaves zero active
  // artifacts -- no directions row is ever written.
  {
    const pool = createMockStoryPool([
      baseRunRow({ status: "GENERATING_DIRECTIONS" })
    ]);

    const claimedRun = pool._state.runs.get(1);

    const result = await executeDirectionsGeneration(pool, claimedRun, {
      loadCanonBundle: () => FAKE_CANON_BUNDLE,
      generateJson: async () => {
        // Simulate a cancel arriving while the provider call is
        // in flight.
        await cancelRun(pool, 1, { reason: "no longer needed" });

        return {
          data: fourDirections(),
          provider: "gemini",
          model: "test-model",
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          latencyMs: 10
        };
      }
    });

    assert.equal(result.outcome, "NO_CHANGE");
    assert.equal(pool._state.directions.size, 0);
    assert.equal(pool._state.runs.get(1).status, "CANCELLED");
  }

  // A stale worker (lease already reclaimed by another worker)
  // cannot persist -- the reclaimed worker is the only writer.
  {
    const pool = createMockStoryPool([
      baseRunRow({ status: "GENERATING_DIRECTIONS", worker_id: "worker-a" })
    ]);

    const staleRun = { ...pool._state.runs.get(1) };

    const result = await executeDirectionsGeneration(pool, staleRun, {
      loadCanonBundle: () => FAKE_CANON_BUNDLE,
      generateJson: async () => {
        // Simulate worker-b reclaiming the run's lease while
        // worker-a's (stale) provider call is still in flight.
        const row = pool._state.runs.get(1);
        row.worker_id = "worker-b";
        row.lease_expires_at = new Date(Date.now() + 300000);

        return {
          data: fourDirections(),
          provider: "gemini",
          model: "test-model",
          inputTokens: 1,
          outputTokens: 1,
          totalTokens: 2,
          latencyMs: 10
        };
      }
    });

    assert.equal(result.outcome, "NO_CHANGE");
    assert.equal(pool._state.directions.size, 0);
    assert.equal(pool._state.runs.get(1).worker_id, "worker-b");
  }

  // No duplicate version under a simulated concurrent claim:
  // once worker-a's stale persist is rejected, worker-b's own
  // (successful) persist for the same stage produces exactly
  // one version 1 batch, never two.
  {
    const pool = createMockStoryPool([
      baseRunRow({ status: "GENERATING_DIRECTIONS", worker_id: "worker-a" })
    ]);

    const staleRun = { ...pool._state.runs.get(1) };

    await executeDirectionsGeneration(pool, staleRun, {
      loadCanonBundle: () => FAKE_CANON_BUNDLE,
      generateJson: async () => {
        const row = pool._state.runs.get(1);
        row.worker_id = "worker-b";
        row.lease_expires_at = new Date(Date.now() + 300000);
        return {
          data: fourDirections(),
          provider: "gemini",
          model: "test-model",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, latencyMs: 10
        };
      }
    });

    assert.equal(pool._state.directions.size, 0);

    const freshRun = pool._state.runs.get(1);

    const result = await executeDirectionsGeneration(pool, freshRun, {
      loadCanonBundle: () => FAKE_CANON_BUNDLE,
      generateJson: async () => ({
        data: fourDirections(),
        provider: "gemini",
        model: "test-model",
        inputTokens: 1, outputTokens: 1, totalTokens: 2, latencyMs: 10
      })
    });

    assert.equal(result.outcome, "STAGE_ADVANCED");
    assert.equal(pool._state.directions.size, 4);

    const versions = new Set(
      [...pool._state.directions.values()].map(d => d.version)
    );
    assert.deepEqual([...versions], [1]);
  }

  // CAS/ownership failure leaves no orphan generation_attempts
  // row either -- persist is all-or-nothing.
  {
    const pool = createMockStoryPool([
      baseRunRow({ status: "GENERATING_DIRECTIONS", worker_id: "worker-a" })
    ]);

    const staleRun = { ...pool._state.runs.get(1) };
    let insertAttemptsCalls = 0;

    const originalQuery = pool.query;
    pool.query = async (sql, values) => {
      if (String(sql).trim().startsWith("INSERT INTO story_generation_attempts")) {
        insertAttemptsCalls += 1;
      }
      return originalQuery(sql, values);
    };
    pool.connect = async () => ({ query: pool.query, release() {} });

    await executeDirectionsGeneration(pool, staleRun, {
      loadCanonBundle: () => FAKE_CANON_BUNDLE,
      generateJson: async () => {
        const row = pool._state.runs.get(1);
        row.status = "CANCELLED";
        row.worker_id = null;
        return {
          data: fourDirections(),
          provider: "gemini",
          model: "test-model",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, latencyMs: 10
        };
      }
    });

    assert.equal(insertAttemptsCalls, 0);
  }

  // Successful persist writes artifacts + generation attempt +
  // event + status transition atomically (all present together).
  {
    const pool = createMockStoryPool([
      baseRunRow({ status: "GENERATING_DIRECTIONS" })
    ]);

    const result = await executeDirectionsGeneration(
      pool,
      pool._state.runs.get(1),
      {
        loadCanonBundle: () => FAKE_CANON_BUNDLE,
        generateJson: async () => ({
          data: fourDirections(),
          provider: "gemini",
          model: "test-model",
          inputTokens: 1, outputTokens: 1, totalTokens: 2, latencyMs: 10
        })
      }
    );

    assert.equal(result.outcome, "STAGE_ADVANCED");
    assert.equal(pool._state.directions.size, 4);
    assert.equal(
      pool._state.events.some(e => e.event_type === "STORY_DIRECTIONS_GENERATED"),
      true
    );
    assert.equal(result.run.status, "AWAITING_DIRECTION_SELECTION");
  }

  console.log("TASK 3.4E STORY WORKER TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

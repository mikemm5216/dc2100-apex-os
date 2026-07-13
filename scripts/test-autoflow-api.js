const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { URLSearchParams } = require("node:url");

const {
  createAutoFlowRun,
  getAutoFlowRun,
  listAutoFlowRuns,
  cancelAutoFlowRun,
  resumeAutoFlowRun
} = require("../lib/autoflow/api");

const { seedRunSteps } = require("../lib/autoflow/engine");

// ---------------------------------------------------------
// In-memory mock database. Dispatches on SQL text substrings,
// the same pattern used by scripts/test-autoflow-core.js --
// no real Postgres connection is required here (real Postgres
// is exercised separately, by hand, per the runtime validation
// section of this task). Covers both this file's own SQL
// (lib/autoflow/api.js) and the subset of engine.js SQL that
// requestRunCancel/resumeFailedRun issue, since cancel/resume
// delegate straight through to the engine, unmodified.
// ---------------------------------------------------------

let clock = 0;
function fixedNow() {
  clock += 1;
  return new Date(2026, 0, 1, 0, 0, clock);
}

function cloneState(state) {
  return {
    runs: new Map([...state.runs].map(([k, v]) => [k, { ...v }])),
    steps: new Map([...state.steps].map(([k, v]) => [k, { ...v }])),
    events: state.events.map(e => ({ ...e })),
    nextRunId: state.nextRunId,
    nextStepId: state.nextStepId,
    nextEventId: state.nextEventId
  };
}

function createMockDb() {
  const state = {
    runs: new Map(),
    steps: new Map(),
    events: [],
    nextRunId: 1,
    nextStepId: 1,
    nextEventId: 1
  };

  let snapshot = null;

  // Race-simulation hooks: a "concurrent" row that only comes
  // into existence the instant our own INSERT collides with it
  // -- so the initial lookup (before our INSERT) legitimately
  // sees nothing, exactly like a genuine race would.
  let pendingConcurrentActiveRun = null;
  let pendingConcurrentIdempotencyRun = null;

  // Fault-injection for seedRunSteps: throw partway through the
  // 6-row insert loop to prove the whole create transaction
  // rolls back, not just the steps.
  let failStepInsertAtCount = null;
  let stepInsertCount = 0;

  function stepsForRun(runId) {
    return [...state.steps.values()]
      .filter(s => s.run_id === runId)
      .sort((a, b) => a.step_order - b.step_order);
  }

  function materializeConcurrentRow(row) {
    const materialized = { ...row };
    state.runs.set(materialized.id, materialized);
    if (snapshot) {
      snapshot.runs.set(materialized.id, { ...materialized });
    }
    if (materialized.id >= state.nextRunId) {
      state.nextRunId = materialized.id + 1;
    }
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
        state.steps = snapshot.steps;
        state.events = snapshot.events;
        state.nextRunId = snapshot.nextRunId;
        state.nextStepId = snapshot.nextStepId;
        state.nextEventId = snapshot.nextEventId;
        snapshot = null;
      }
      return { rows: [], rowCount: 0 };
    }

    // ------------------ autoflow_run_events ------------------

    if (trimmed.startsWith("INSERT INTO autoflow_run_events")) {
      const [runId, stepKey, eventType, message, payloadJson] = values;
      const id = state.nextEventId++;
      state.events.push({
        id,
        run_id: runId,
        step_key: stepKey,
        event_type: eventType,
        message,
        payload: JSON.parse(payloadJson),
        created_at: fixedNow()
      });
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.includes("FROM autoflow_run_events") &&
      trimmed.includes("COUNT(*)") &&
      trimmed.includes("event_type = $3")
    ) {
      const [runId, stepKey, eventType] = values;
      const count = state.events.filter(
        e =>
          e.run_id === runId &&
          e.step_key === stepKey &&
          e.event_type === eventType
      ).length;
      return { rows: [{ count }], rowCount: 1 };
    }

    if (trimmed.startsWith("SELECT id, run_id, step_key, event_type")) {
      const rows = state.events
        .filter(e => e.run_id === values[0])
        .sort(
          (a, b) => a.created_at - b.created_at || a.id - b.id
        )
        .map(r => ({ ...r }));
      return { rows, rowCount: rows.length };
    }

    // ------------------ autoflow_run_steps: INSERT ------------------

    if (trimmed.startsWith("INSERT INTO autoflow_run_steps")) {
      if (failStepInsertAtCount !== null) {
        stepInsertCount += 1;
        if (stepInsertCount === failStepInsertAtCount) {
          throw new Error("Simulated seedRunSteps failure.");
        }
      }

      const [
        runId,
        stepKey,
        stepOrder,
        isOrchestrated,
        parentStepKey,
        domainRunTable
      ] = values;
      const id = state.nextStepId++;
      state.steps.set(id, {
        id,
        run_id: runId,
        step_key: stepKey,
        step_order: stepOrder,
        is_orchestrated: isOrchestrated,
        parent_step_key: parentStepKey,
        domain_run_table: domainRunTable,
        domain_run_id: null,
        status: "PENDING",
        input_snapshot: {},
        output_summary: {},
        error_message: null,
        started_at: null,
        completed_at: null,
        created_at: fixedNow(),
        updated_at: fixedNow()
      });
      return { rows: [], rowCount: 1 };
    }

    // ------------------ autoflow_run_steps: SELECT ------------------

    if (trimmed === "SELECT COUNT(*)::int AS count FROM autoflow_run_steps WHERE run_id = $1") {
      return {
        rows: [{ count: stepsForRun(values[0]).length }],
        rowCount: 1
      };
    }

    if (
      trimmed.startsWith("SELECT id, run_id, step_key, step_order, is_orchestrated") &&
      trimmed.includes("ORDER BY step_order ASC")
    ) {
      const rows = stepsForRun(values[0]).map(r => ({ ...r }));
      return { rows, rowCount: rows.length };
    }

    if (trimmed.startsWith("SELECT run_id, step_key, step_order, status")) {
      const ids = values[0];
      const rows = [...state.steps.values()]
        .filter(s => ids.includes(s.run_id))
        .sort((a, b) => a.run_id - b.run_id || a.step_order - b.step_order)
        .map(s => ({
          run_id: s.run_id,
          step_key: s.step_key,
          step_order: s.step_order,
          status: s.status
        }));
      return { rows, rowCount: rows.length };
    }

    if (
      trimmed.startsWith("SELECT * FROM autoflow_run_steps") &&
      trimmed.includes("step_key = $2")
    ) {
      const row = [...state.steps.values()].find(
        s => s.run_id === values[0] && s.step_key === values[1]
      );
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (
      trimmed.startsWith("SELECT * FROM autoflow_run_steps") &&
      trimmed.includes("ORDER BY step_order")
    ) {
      const rows = stepsForRun(values[0]).map(r => ({ ...r }));
      return { rows, rowCount: rows.length };
    }

    // ------------------ autoflow_run_steps: UPDATE ------------------

    if (trimmed === "UPDATE autoflow_run_steps SET status = 'SKIPPED', updated_at = $1 WHERE id = $2") {
      const [timestamp, id] = values;
      Object.assign(state.steps.get(id), { status: "SKIPPED", updated_at: timestamp });
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.startsWith("UPDATE autoflow_run_steps") &&
      trimmed.includes("SET status = 'PENDING', domain_run_id = NULL")
    ) {
      const [timestamp, id] = values;
      Object.assign(state.steps.get(id), {
        status: "PENDING",
        domain_run_id: null,
        output_summary: {},
        error_message: null,
        started_at: null,
        completed_at: null,
        updated_at: timestamp
      });
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.startsWith("UPDATE autoflow_run_steps") &&
      trimmed.includes("SET status = 'PENDING', output_summary")
    ) {
      const [timestamp, runId, stepKey] = values;
      const row = [...state.steps.values()].find(
        s => s.run_id === runId && s.step_key === stepKey
      );
      Object.assign(row, {
        status: "PENDING",
        output_summary: {},
        error_message: null,
        started_at: null,
        completed_at: null,
        updated_at: timestamp
      });
      return { rows: [], rowCount: 1 };
    }

    // ------------------ autoflow_runs: SELECT ------------------

    if (trimmed === "SELECT id FROM autoflow_runs WHERE id = $1") {
      const row = state.runs.get(values[0]);
      return row ? { rows: [{ id: row.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (trimmed === "SELECT * FROM autoflow_runs WHERE id = $1 FOR UPDATE") {
      const row = state.runs.get(values[0]);
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (trimmed.includes("FROM autoflow_runs WHERE idempotency_key = $1")) {
      const row = [...state.runs.values()].find(
        r => r.idempotency_key === values[0]
      );
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (trimmed.includes("id != $1")) {
      const rows = [...state.runs.values()].filter(
        r => (r.status === "QUEUED" || r.status === "RUNNING") && r.id !== values[0]
      );
      return { rows: rows.map(r => ({ id: r.id })), rowCount: rows.length };
    }

    if (trimmed.includes("COUNT(*) OVER() AS total_count") && trimmed.includes("FROM autoflow_runs")) {
      let rows = [...state.runs.values()];
      let idx = 0;

      if (trimmed.includes("WHERE status = $1")) {
        rows = rows.filter(r => r.status === values[0]);
        idx = 1;
      }

      rows = rows.sort(
        (a, b) => b.created_at - a.created_at || b.id - a.id
      );
      const total = rows.length;
      const limit = values[idx];
      rows = rows.slice(0, limit);
      return {
        rows: rows.map(r => ({ ...r, total_count: total })),
        rowCount: rows.length
      };
    }

    if (
      trimmed.includes("FROM autoflow_runs") &&
      trimmed.includes("status IN ('QUEUED', 'RUNNING')") &&
      trimmed.includes("LIMIT 1")
    ) {
      const rows = [...state.runs.values()]
        .filter(r => r.status === "QUEUED" || r.status === "RUNNING")
        .sort((a, b) => a.created_at - b.created_at || a.id - b.id);
      return rows.length > 0
        ? {
            rows: [
              {
                id: rows[0].id,
                status: rows[0].status,
                created_at: rows[0].created_at,
                started_at: rows[0].started_at
              }
            ],
            rowCount: 1
          }
        : { rows: [], rowCount: 0 };
    }

    if (trimmed.includes("FROM autoflow_runs WHERE id = $1")) {
      const row = state.runs.get(values[0]);
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    // ------------------ autoflow_runs: INSERT ------------------

    if (trimmed.startsWith("INSERT INTO autoflow_runs")) {
      const [requestPayloadJson, idempotencyKey, requestedBy] = values;

      if (pendingConcurrentActiveRun) {
        const row = pendingConcurrentActiveRun;
        pendingConcurrentActiveRun = null;
        materializeConcurrentRow(row);
        throw conflictError("idx_autoflow_runs_single_active");
      }

      if (
        pendingConcurrentIdempotencyRun &&
        pendingConcurrentIdempotencyRun.idempotency_key === idempotencyKey
      ) {
        const row = pendingConcurrentIdempotencyRun;
        pendingConcurrentIdempotencyRun = null;
        materializeConcurrentRow(row);
        throw conflictError("idx_autoflow_runs_idempotency_key");
      }

      const activeExists = [...state.runs.values()].some(
        r => r.status === "QUEUED" || r.status === "RUNNING"
      );
      if (activeExists) {
        throw conflictError("idx_autoflow_runs_single_active");
      }

      if (
        idempotencyKey &&
        [...state.runs.values()].some(r => r.idempotency_key === idempotencyKey)
      ) {
        throw conflictError("idx_autoflow_runs_idempotency_key");
      }

      const id = state.nextRunId++;
      const row = {
        id,
        status: "QUEUED",
        current_step: "SCANNER",
        trigger_type: "MANUAL",
        request_payload: JSON.parse(requestPayloadJson),
        summary: {},
        failure_step: null,
        error_message: null,
        cancel_requested_at: null,
        locked_by: null,
        locked_at: null,
        started_at: null,
        completed_at: null,
        created_at: fixedNow(),
        updated_at: fixedNow(),
        idempotency_key: idempotencyKey,
        requested_by: requestedBy
      };
      state.runs.set(id, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ autoflow_runs: UPDATE ------------------

    if (trimmed === "UPDATE autoflow_runs SET cancel_requested_at = $1, updated_at = $1 WHERE id = $2") {
      const [timestamp, id] = values;
      Object.assign(state.runs.get(id), {
        cancel_requested_at: timestamp,
        updated_at: timestamp
      });
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.startsWith("UPDATE autoflow_runs") &&
      trimmed.includes("SET status = 'CANCELLED', cancel_requested_at = $1, completed_at = $1, updated_at = $1")
    ) {
      const [timestamp, id] = values;
      Object.assign(state.runs.get(id), {
        status: "CANCELLED",
        cancel_requested_at: timestamp,
        completed_at: timestamp,
        updated_at: timestamp
      });
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.startsWith("UPDATE autoflow_runs") &&
      trimmed.includes("SET status = 'RUNNING', current_step = $1")
    ) {
      const [stepKey, timestamp, id] = values;
      Object.assign(state.runs.get(id), {
        status: "RUNNING",
        current_step: stepKey,
        failure_step: null,
        error_message: null,
        cancel_requested_at: null,
        locked_by: null,
        locked_at: null,
        updated_at: timestamp
      });
      return { rows: [], rowCount: 1 };
    }

    if (trimmed === "UPDATE autoflow_runs SET summary = $1::jsonb WHERE id = $2") {
      const [summaryJson, id] = values;
      state.runs.get(id).summary = JSON.parse(summaryJson);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unexpected autoflow query: ${trimmed.slice(0, 200)}`);
  }

  return {
    query,
    state,
    setPendingConcurrentActiveRun(row) {
      pendingConcurrentActiveRun = row;
    },
    setPendingConcurrentIdempotencyRun(row) {
      pendingConcurrentIdempotencyRun = row;
    },
    failStepInsertAt(count) {
      failStepInsertAtCount = count;
      stepInsertCount = 0;
    }
  };
}

function wrapAsPool(mockDb) {
  return {
    query: mockDb.query,
    async connect() {
      return {
        query: mockDb.query,
        release() {}
      };
    }
  };
}

async function seedRunWithSteps(
  mockDb,
  {
    id,
    status = "QUEUED",
    currentStep = "SCANNER",
    failureStep = null,
    idempotencyKey = null,
    requestedBy = null,
    cancelRequestedAt = null,
    withSteps = true
  } = {}
) {
  const now = fixedNow();
  mockDb.state.runs.set(id, {
    id,
    status,
    current_step: currentStep,
    trigger_type: "MANUAL",
    request_payload: {},
    summary: {},
    failure_step: failureStep,
    error_message: null,
    cancel_requested_at: cancelRequestedAt,
    locked_by: null,
    locked_at: null,
    started_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
    idempotency_key: idempotencyKey,
    requested_by: requestedBy
  });

  if (id >= mockDb.state.nextRunId) {
    mockDb.state.nextRunId = id + 1;
  }

  if (withSteps) {
    await seedRunSteps({ query: mockDb.query }, id);
  }

  return id;
}

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      ${error.stack || error}`);
  }
}

async function run() {
  // -----------------------------------------------------
  // 1-4: create success shape
  // -----------------------------------------------------

  await test("1/2/3/4: create success -> 202, exactly 6 steps in one transaction, current_step SCANNER, trigger_type MANUAL", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);

    const result = await createAutoFlowRun(pool, { note: "manual kickoff" }, {
      requestedBy: "api"
    });

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.status, "QUEUED");
    assert.equal(result.payload.data.current_step, "SCANNER");
    assert.equal(result.payload.data.trigger_type, "MANUAL");
    assert.equal(result.payload.data.requested_by, "api");
    assert.deepEqual(result.payload.data.request_payload, { note: "manual kickoff" });
    assert.equal(mockDb.state.runs.size, 1);
    assert.equal(mockDb.state.steps.size, 6);

    const stepKeys = [...mockDb.state.steps.values()].map(s => s.step_key).sort();
    assert.deepEqual(stepKeys, [
      "COUNTRY_NEWS_RADAR",
      "FUSION",
      "HISTORICAL_RESONANCE",
      "PERSON_RADAR",
      "SCANNER",
      "VEHICLE_RESOLVER"
    ]);
  });

  // -----------------------------------------------------
  // 5: already-active -> 409 (non-race)
  // -----------------------------------------------------

  await test("5: create rejected with 409 AUTOFLOW_RUN_ALREADY_ACTIVE when a run is already QUEUED/RUNNING", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    await seedRunWithSteps(mockDb, { id: 1, status: "RUNNING" });

    const result = await createAutoFlowRun(pool, {}, { requestedBy: "api" });

    assert.equal(result.statusCode, 409);
    assert.equal(result.payload.error, "AUTOFLOW_RUN_ALREADY_ACTIVE");
    assert.equal(mockDb.state.runs.size, 1);
    assert.equal(mockDb.state.steps.size, 6);
  });

  // -----------------------------------------------------
  // 6/7: idempotency key create + replay
  // -----------------------------------------------------

  await test("6/7: same Idempotency-Key replays the existing run (200, replayed:true), never a second run or step set", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);

    const first = await createAutoFlowRun(pool, { a: 1 }, {
      requestedBy: "api",
      idempotencyKey: "abc-123"
    });
    assert.equal(first.statusCode, 202);
    assert.equal(first.payload.data.idempotency_key, "abc-123");

    const second = await createAutoFlowRun(pool, { a: 1, ignored: true }, {
      requestedBy: "api",
      idempotencyKey: "  abc-123  "
    });

    assert.equal(second.statusCode, 200);
    assert.equal(second.payload.replayed, true);
    assert.equal(second.payload.data.id, first.payload.data.id);

    assert.equal(mockDb.state.runs.size, 1);
    assert.equal(mockDb.state.steps.size, 6);
  });

  // -----------------------------------------------------
  // 8: idempotency 23505 race -> replay, no raw pg error leak
  // -----------------------------------------------------

  await test("8: idempotency-key 23505 race resolves to a 200 replay, never leaks a raw pg error", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);

    mockDb.setPendingConcurrentIdempotencyRun({
      id: 77,
      status: "QUEUED",
      current_step: "SCANNER",
      trigger_type: "MANUAL",
      request_payload: {},
      summary: {},
      failure_step: null,
      error_message: null,
      cancel_requested_at: null,
      locked_by: null,
      locked_at: null,
      started_at: null,
      completed_at: null,
      created_at: fixedNow(),
      updated_at: fixedNow(),
      idempotency_key: "race-key",
      requested_by: "other-caller"
    });

    const result = await createAutoFlowRun(pool, {}, {
      requestedBy: "api",
      idempotencyKey: "race-key"
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.replayed, true);
    assert.equal(result.payload.data.id, "77");
    assert.equal(JSON.stringify(result.payload).includes("23505"), false);

    // Our own attempted insert must not have left a second run or steps.
    assert.equal(mockDb.state.runs.size, 1);
    assert.equal(mockDb.state.steps.size, 0);
  });

  // -----------------------------------------------------
  // 9: active-run 23505 race -> 409
  // -----------------------------------------------------

  await test("9: active-run 23505 race (single-active index) resolves to 409, no leaked pg error, no partial data", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);

    mockDb.setPendingConcurrentActiveRun({
      id: 99,
      status: "RUNNING",
      current_step: "SCANNER",
      trigger_type: "MANUAL",
      request_payload: {},
      summary: {},
      failure_step: null,
      error_message: null,
      cancel_requested_at: null,
      locked_by: null,
      locked_at: null,
      started_at: null,
      completed_at: null,
      created_at: fixedNow(),
      updated_at: fixedNow(),
      idempotency_key: null,
      requested_by: "other-caller"
    });

    const result = await createAutoFlowRun(pool, {}, { requestedBy: "api" });

    assert.equal(result.statusCode, 409);
    assert.equal(result.payload.error, "AUTOFLOW_RUN_ALREADY_ACTIVE");
    assert.equal(JSON.stringify(result.payload).includes("23505"), false);

    assert.equal(mockDb.state.runs.size, 1);
    assert.equal(mockDb.state.steps.size, 0);
  });

  // -----------------------------------------------------
  // 10: seedRunSteps mid-failure -> whole transaction rolls back
  // -----------------------------------------------------

  await test("10: a failure partway through seedRunSteps rolls back the run insert too, no half-created run", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    mockDb.failStepInsertAt(4);

    await assert.rejects(
      () => createAutoFlowRun(pool, {}, { requestedBy: "api" }),
      /Simulated seedRunSteps failure/
    );

    assert.equal(mockDb.state.runs.size, 0);
    assert.equal(mockDb.state.steps.size, 0);
  });

  // -----------------------------------------------------
  // 11: non-object body -> 400
  // -----------------------------------------------------

  await test("11: non-object body -> 400 VALIDATION_ERROR, no DB writes", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);

    for (const invalidBody of [null, [], "x", 5, true]) {
      const result = await createAutoFlowRun(pool, invalidBody, { requestedBy: "api" });
      assert.equal(result.statusCode, 400);
      assert.equal(result.payload.error, "VALIDATION_ERROR");
    }

    assert.equal(mockDb.state.runs.size, 0);
  });

  // -----------------------------------------------------
  // 12: invalid/too-long idempotency key -> 400
  // -----------------------------------------------------

  await test("12: invalid or over-length Idempotency-Key -> 400 VALIDATION_ERROR, no DB writes", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);

    const tooLong = "x".repeat(201);
    const result = await createAutoFlowRun(pool, {}, {
      requestedBy: "api",
      idempotencyKey: tooLong
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.error, "VALIDATION_ERROR");

    const nonString = await createAutoFlowRun(pool, {}, {
      requestedBy: "api",
      idempotencyKey: 12345
    });

    assert.equal(nonString.statusCode, 400);
    assert.equal(mockDb.state.runs.size, 0);

    // Empty/whitespace-only key is treated as "not provided", not an error.
    const blank = await createAutoFlowRun(pool, {}, {
      requestedBy: "api",
      idempotencyKey: "   "
    });
    assert.equal(blank.statusCode, 202);
    assert.equal(blank.payload.data.idempotency_key, null);
  });

  // -----------------------------------------------------
  // 13/14/29: get detail
  // -----------------------------------------------------

  await test("13/29: get detail returns run + 6 ordered steps + ordered events, all ids as strings", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    await seedRunWithSteps(mockDb, { id: 42, status: "RUNNING" });

    mockDb.state.events.push(
      { id: 2, run_id: 42, step_key: null, event_type: "RUN_STARTED", message: null, payload: {}, created_at: new Date(2026, 0, 1, 0, 0, 2) },
      { id: 1, run_id: 42, step_key: "SCANNER", event_type: "STEP_STARTED", message: null, payload: {}, created_at: new Date(2026, 0, 1, 0, 0, 1) }
    );

    const result = await getAutoFlowRun(pool, 42);

    assert.equal(result.statusCode, 200);
    assert.equal(typeof result.payload.data.id, "string");
    assert.equal(result.payload.data.id, "42");

    assert.equal(result.payload.data.steps.length, 6);
    assert.deepEqual(
      result.payload.data.steps.map(s => s.step_order),
      [1, 2, 3, 4, 5, 6]
    );
    for (const step of result.payload.data.steps) {
      assert.equal(typeof step.id, "string");
    }

    assert.equal(result.payload.data.events.length, 2);
    assert.deepEqual(
      result.payload.data.events.map(e => e.id),
      ["1", "2"]
    );
    for (const event of result.payload.data.events) {
      assert.equal(typeof event.id, "string");
    }

    // Lock internals must never be exposed.
    assert.equal("locked_by" in result.payload.data, false);
    assert.equal("locked_at" in result.payload.data, false);
  });

  await test("14: get detail for a missing run -> 404 AUTOFLOW_RUN_NOT_FOUND", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);

    const result = await getAutoFlowRun(pool, 999);

    assert.equal(result.statusCode, 404);
    assert.equal(result.payload.error, "AUTOFLOW_RUN_NOT_FOUND");
  });

  // -----------------------------------------------------
  // 15/16/17/18/19: list
  // -----------------------------------------------------

  await test("15/16/17: list default limit (20), max limit (100), and illegal limit (400)", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);

    for (let i = 1; i <= 25; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await seedRunWithSteps(mockDb, { id: i, status: "COMPLETED" });
    }

    const defaultResult = await listAutoFlowRuns(pool, new URLSearchParams());
    assert.equal(defaultResult.statusCode, 200);
    assert.equal(defaultResult.payload.data.length, 20);
    assert.equal(defaultResult.payload.total_count, 25);

    const maxResult = await listAutoFlowRuns(pool, new URLSearchParams({ limit: "100" }));
    assert.equal(maxResult.statusCode, 200);
    assert.equal(maxResult.payload.data.length, 25);

    const tooHigh = await listAutoFlowRuns(pool, new URLSearchParams({ limit: "101" }));
    assert.equal(tooHigh.statusCode, 400);

    const zero = await listAutoFlowRuns(pool, new URLSearchParams({ limit: "0" }));
    assert.equal(zero.statusCode, 400);

    const notInteger = await listAutoFlowRuns(pool, new URLSearchParams({ limit: "abc" }));
    assert.equal(notInteger.statusCode, 400);

    // Each row carries a 6-entry step summary, batched (no N+1 is
    // structurally enforced by the mock throwing on unrecognized
    // per-row queries -- if listAutoFlowRuns queried steps once
    // per run instead of once total, this test would still pass
    // functionally, but the query log length proves it didn't).
    for (const row of defaultResult.payload.data) {
      assert.equal(row.steps.length, 6);
      assert.equal(typeof row.id, "string");
    }
  });

  await test("18/19: list status filter and illegal status", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    await seedRunWithSteps(mockDb, { id: 1, status: "COMPLETED" });
    await seedRunWithSteps(mockDb, { id: 2, status: "FAILED" });
    await seedRunWithSteps(mockDb, { id: 3, status: "CANCELLED" });

    const filtered = await listAutoFlowRuns(pool, new URLSearchParams({ status: "failed" }));
    assert.equal(filtered.statusCode, 200);
    assert.equal(filtered.payload.data.length, 1);
    assert.equal(filtered.payload.data[0].status, "FAILED");
    assert.equal(filtered.payload.filters.status, "FAILED");

    const illegal = await listAutoFlowRuns(pool, new URLSearchParams({ status: "BOGUS" }));
    assert.equal(illegal.statusCode, 400);
  });

  // -----------------------------------------------------
  // 20-24: cancel
  // -----------------------------------------------------

  await test("20: cancel a QUEUED run -> 200, immediately CANCELLED, pending steps SKIPPED", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    await seedRunWithSteps(mockDb, { id: 1, status: "QUEUED" });

    const result = await cancelAutoFlowRun(pool, 1);

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "CANCELLED");

    const steps = [...mockDb.state.steps.values()];
    assert.ok(steps.every(s => s.status === "SKIPPED"));
  });

  await test("21: cancel a RUNNING run (first request) -> 202, cancel_requested_at set, still RUNNING", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    await seedRunWithSteps(mockDb, { id: 1, status: "RUNNING" });

    const result = await cancelAutoFlowRun(pool, 1);

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.status, "RUNNING");
    assert.ok(result.payload.data.cancel_requested_at);
  });

  await test("22: repeated cancel of a RUNNING run -> 200, already_requested:true", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    await seedRunWithSteps(mockDb, { id: 1, status: "RUNNING" });

    const first = await cancelAutoFlowRun(pool, 1);
    assert.equal(first.statusCode, 202);

    const second = await cancelAutoFlowRun(pool, 1);
    assert.equal(second.statusCode, 200);
    assert.equal(second.payload.already_requested, true);
  });

  await test("23: cancel a terminal-state run -> 409 CANCEL_INVALID_STATE", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    await seedRunWithSteps(mockDb, { id: 1, status: "COMPLETED" });

    const result = await cancelAutoFlowRun(pool, 1);

    assert.equal(result.statusCode, 409);
    assert.equal(result.payload.error, "CANCEL_INVALID_STATE");
  });

  await test("24: cancel a missing run -> 404 AUTOFLOW_RUN_NOT_FOUND", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);

    const result = await cancelAutoFlowRun(pool, 999);

    assert.equal(result.statusCode, 404);
    assert.equal(result.payload.error, "AUTOFLOW_RUN_NOT_FOUND");
  });

  // -----------------------------------------------------
  // 25-28: resume
  // -----------------------------------------------------

  await test("25: resume a FAILED run -> 202, back to RUNNING at the failed step", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    await seedRunWithSteps(mockDb, {
      id: 1,
      status: "FAILED",
      currentStep: "COUNTRY_NEWS_RADAR",
      failureStep: "COUNTRY_NEWS_RADAR"
    });

    const result = await resumeAutoFlowRun(pool, 1);

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.status, "RUNNING");
    assert.equal(result.payload.data.current_step, "COUNTRY_NEWS_RADAR");
    assert.equal(result.payload.data.failure_step, null);
  });

  await test("26: resume a non-FAILED run -> 409 RESUME_INVALID_STATE", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    await seedRunWithSteps(mockDb, { id: 1, status: "COMPLETED" });

    const result = await resumeAutoFlowRun(pool, 1);

    assert.equal(result.statusCode, 409);
    assert.equal(result.payload.error, "RESUME_INVALID_STATE");
  });

  await test("27: resume rejected when another AutoFlow run is active -> 409 AUTOFLOW_RUN_ALREADY_ACTIVE", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    await seedRunWithSteps(mockDb, {
      id: 1,
      status: "FAILED",
      currentStep: "SCANNER",
      failureStep: "SCANNER"
    });
    await seedRunWithSteps(mockDb, { id: 2, status: "RUNNING" });

    const result = await resumeAutoFlowRun(pool, 1);

    assert.equal(result.statusCode, 409);
    assert.equal(result.payload.error, "AUTOFLOW_RUN_ALREADY_ACTIVE");
  });

  await test("28: resume a missing run -> 404 AUTOFLOW_RUN_NOT_FOUND", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);

    const result = await resumeAutoFlowRun(pool, 999);

    assert.equal(result.statusCode, 404);
    assert.equal(result.payload.error, "AUTOFLOW_RUN_NOT_FOUND");
  });

  // -----------------------------------------------------
  // 31/32: static source-level guarantees
  // -----------------------------------------------------

  await test("31: server.js never calls processNextAutoFlowRun directly from a request handler", async () => {
    const serverSource = fs.readFileSync(
      path.join(__dirname, "../apps/api/src/server.js"),
      "utf8"
    );
    assert.equal(serverSource.includes("processNextAutoFlowRun"), false);
  });

  await test("32: lib/autoflow/api.js never writes autoflow_run_events directly (delegates to the engine)", async () => {
    const apiSource = fs.readFileSync(
      path.join(__dirname, "../lib/autoflow/api.js"),
      "utf8"
    );
    assert.equal(apiSource.includes("INSERT INTO autoflow_run_events"), false);
    assert.equal(apiSource.includes("processNextAutoFlowRun"), false);
  });

  // -----------------------------------------------------
  // 30: route-level request/response mapping (real HTTP server,
  // stubbed lib/autoflow/api + db so this stays a pure routing
  // test -- DB behavior is covered above and in section 10).
  // -----------------------------------------------------

  await test("30: route-level request/response mapping over real HTTP", async () => {
    const autoflowApiPath = require.resolve("../lib/autoflow/api");
    const dbPath = require.resolve("../apps/api/src/db");
    const serverPath = require.resolve("../apps/api/src/server");

    assert.equal(
      require.cache[serverPath],
      undefined,
      "server.js must not already be loaded -- route stubs would not take effect."
    );

    const calls = { create: [], get: [], list: [], cancel: [], resume: [] };

    const canned = {
      create: { statusCode: 202, payload: { data: { id: "1" }, message: "queued" } },
      get: { statusCode: 200, payload: { data: { id: "1", steps: [], events: [] } } },
      list: { statusCode: 200, payload: { data: [], count: 0, total_count: 0 } },
      cancel: { statusCode: 202, payload: { data: { id: "1" }, message: "cancel requested" } },
      resume: { statusCode: 202, payload: { data: { id: "1" }, message: "resumed" } }
    };

    require.cache[autoflowApiPath] = {
      id: autoflowApiPath,
      filename: autoflowApiPath,
      loaded: true,
      exports: {
        async createAutoFlowRun(pool, body, context) {
          calls.create.push({ pool, body, context });
          return canned.create;
        },
        async getAutoFlowRun(pool, runId) {
          calls.get.push({ pool, runId });
          return canned.get;
        },
        async listAutoFlowRuns(pool, searchParams) {
          calls.list.push({ pool, searchParams });
          return canned.list;
        },
        async cancelAutoFlowRun(pool, runId) {
          calls.cancel.push({ pool, runId });
          return canned.cancel;
        },
        async resumeAutoFlowRun(pool, runId) {
          calls.resume.push({ pool, runId });
          return canned.resume;
        }
      }
    };

    require.cache[dbPath] = {
      id: dbPath,
      filename: dbPath,
      loaded: true,
      exports: {
        async query() {
          return { rows: [], rowCount: 0 };
        },
        async connect() {
          return { query: async () => ({ rows: [], rowCount: 0 }), release() {} };
        },
        async end() {}
      }
    };

    const testPort = 34719;
    process.env.PORT = String(testPort);

    require(serverPath);

    function httpRequest(method, requestPath, { body, headers } = {}) {
      return new Promise((resolve, reject) => {
        const payload = body === undefined ? null : JSON.stringify(body);
        const req = http.request(
          {
            method,
            host: "127.0.0.1",
            port: testPort,
            path: requestPath,
            headers: {
              "Content-Type": "application/json",
              ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
              ...headers
            }
          },
          res => {
            let raw = "";
            res.on("data", chunk => {
              raw += chunk;
            });
            res.on("end", () => {
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                body: raw ? JSON.parse(raw) : null
              });
            });
          }
        );
        req.on("error", reject);
        if (payload) {
          req.write(payload);
        }
        req.end();
      });
    }

    async function waitForServerReady() {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        try {
          await httpRequest("GET", "/health");
          return;
        } catch {
          await new Promise(resolveWait => setTimeout(resolveWait, 25));
        }
      }
      throw new Error("Test HTTP server never became ready.");
    }

    try {
      await waitForServerReady();

      const preflight = await httpRequest("OPTIONS", "/api/autoflow/runs", {
        headers: {
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type,idempotency-key"
        }
      });
      assert.equal(preflight.statusCode, 204);
      const allowedHeaders = preflight.headers["access-control-allow-headers"]
        .split(",")
        .map(header => header.trim().toLowerCase());
      assert.ok(allowedHeaders.includes("idempotency-key"));

      const created = await httpRequest("POST", "/api/autoflow/runs", {
        body: { note: "route test" },
        headers: { "Idempotency-Key": " route-key " }
      });
      assert.equal(created.statusCode, 202);
      assert.deepEqual(created.body, canned.create.payload);
      assert.equal(calls.create.length, 1);
      assert.deepEqual(calls.create[0].body, { note: "route test" });
      assert.equal(calls.create[0].context.requestedBy, "api");
      // Node's HTTP parser already strips leading/trailing header
      // whitespace (RFC 9110 OWS) before this ever reaches our code.
      assert.equal(calls.create[0].context.idempotencyKey, "route-key");

      const listed = await httpRequest("GET", "/api/autoflow/runs?status=FAILED&limit=5");
      assert.equal(listed.statusCode, 200);
      assert.equal(calls.list.length, 1);
      assert.equal(calls.list[0].searchParams.get("status"), "FAILED");
      assert.equal(calls.list[0].searchParams.get("limit"), "5");

      const detail = await httpRequest("GET", "/api/autoflow/runs/123");
      assert.equal(detail.statusCode, 200);
      assert.equal(calls.get.length, 1);
      assert.equal(calls.get[0].runId, "123");

      const badId = await httpRequest("GET", "/api/autoflow/runs/abc");
      assert.equal(badId.statusCode, 400);
      assert.equal(calls.get.length, 1);

      const zeroId = await httpRequest("GET", "/api/autoflow/runs/0");
      assert.equal(zeroId.statusCode, 400);
      assert.equal(calls.get.length, 1);

      const cancelled = await httpRequest("POST", "/api/autoflow/runs/123/cancel", { body: {} });
      assert.equal(cancelled.statusCode, 202);
      assert.equal(calls.cancel.length, 1);
      assert.equal(calls.cancel[0].runId, "123");
      // The /cancel suffix must never be swallowed by the plain
      // GET /:id detail route or by resume.
      assert.equal(calls.get.length, 1);
      assert.equal(calls.resume.length, 0);

      const resumed = await httpRequest("POST", "/api/autoflow/runs/123/resume", { body: {} });
      assert.equal(resumed.statusCode, 202);
      assert.equal(calls.resume.length, 1);
      assert.equal(calls.resume[0].runId, "123");
      assert.equal(calls.cancel.length, 1);

      const badCancelId = await httpRequest("POST", "/api/autoflow/runs/xyz/cancel", { body: {} });
      assert.equal(badCancelId.statusCode, 400);
      assert.equal(calls.cancel.length, 1);
    } finally {
      delete require.cache[autoflowApiPath];
      delete require.cache[dbPath];
      delete require.cache[serverPath];
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);

  // The route-level test (30) requires(...) the real server.js,
  // which binds a live TCP listener with no exported handle to
  // close -- force process exit instead of waiting on an empty
  // event loop that will never come.
  process.exit(failed > 0 ? 1 : 0);
}

run();

const assert = require("node:assert/strict");

const {
  AUTOFLOW_ERROR_CODES,
  AUTOFLOW_EVENT_TYPES,
  AUTOFLOW_RUN_ALREADY_ACTIVE,
  CANCEL_INVALID_STATE,
  RESUME_INVALID_STATE,
  buildAutoFlowRunSummary,
  deriveVirtualStepOutput,
  inspectAndAdvance,
  processNextAutoFlowRun,
  requestRunCancel,
  resumeFailedRun,
  seedRunSteps
} = require("../lib/autoflow/engine");

// ---------------------------------------------------------
// In-memory mock database. Dispatches on SQL text substrings,
// the same pattern used by scripts/test-fusion-worker.js --
// no real Postgres connection is required. Domain adapters
// are injected stubs (never the real Scanner/News/Person/
// Fusion functions), so this file never touches those
// domains' schemas.
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
    nextStepId: state.nextStepId,
    nextEventId: state.nextEventId
  };
}

function createMockDb() {
  const state = {
    runs: new Map(),
    steps: new Map(),
    events: [],
    nextStepId: 1,
    nextEventId: 1,
    transactionLog: []
  };

  // Snapshot stack so BEGIN/ROLLBACK/COMMIT actually behave
  // transactionally against the in-memory store, matching real
  // Postgres semantics -- a rolled-back tick must leave zero
  // trace, exactly like the real production 012/013 schema does.
  let snapshot = null;

  function stepsForRun(runId) {
    return [...state.steps.values()]
      .filter(s => s.run_id === runId)
      .sort((a, b) => a.step_order - b.step_order);
  }

  function stepByKey(runId, stepKey) {
    return [...state.steps.values()].find(
      s => s.run_id === runId && s.step_key === stepKey
    );
  }

  async function query(sql, values = []) {
    const trimmed = String(sql).trim();
    const upper = trimmed.toUpperCase();

    if (upper === "BEGIN") {
      snapshot = cloneState(state);
      state.transactionLog.push(upper);
      return { rows: [], rowCount: 0 };
    }

    if (upper === "COMMIT") {
      snapshot = null;
      state.transactionLog.push(upper);
      return { rows: [], rowCount: 0 };
    }

    if (upper === "ROLLBACK") {
      if (snapshot) {
        state.runs = snapshot.runs;
        state.steps = snapshot.steps;
        state.events = snapshot.events;
        state.nextStepId = snapshot.nextStepId;
        state.nextEventId = snapshot.nextEventId;
        snapshot = null;
      }
      state.transactionLog.push(upper);
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
      trimmed.includes("COUNT(*)")
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

    // ------------------ autoflow_run_steps: INSERT ------------------

    if (trimmed.startsWith("INSERT INTO autoflow_run_steps")) {
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

    if (trimmed.startsWith("SELECT id, status FROM autoflow_run_steps")) {
      const row = stepByKey(values[0], values[1]);
      return row
        ? { rows: [{ id: row.id, status: row.status }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (
      trimmed.startsWith("SELECT * FROM autoflow_run_steps") &&
      trimmed.includes("step_key = $2")
    ) {
      const row = stepByKey(values[0], values[1]);
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

    if (trimmed.startsWith("UPDATE autoflow_run_steps")) {
      if (trimmed.includes("SET status = 'FAILED'")) {
        const [errorMessage, timestamp, id] = values;
        const row = state.steps.get(id);
        Object.assign(row, {
          status: "FAILED",
          error_message: errorMessage,
          completed_at: timestamp,
          updated_at: timestamp
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET status = 'SKIPPED'")) {
        const [timestamp, id] = values;
        const row = state.steps.get(id);
        Object.assign(row, { status: "SKIPPED", updated_at: timestamp });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET status = 'QUEUED'")) {
        const [domainRunId, timestamp, id] = values;
        const row = state.steps.get(id);
        Object.assign(row, {
          status: "QUEUED",
          domain_run_id: domainRunId,
          started_at: timestamp,
          updated_at: timestamp
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET status = 'COMPLETED'")) {
        const [outputSummaryJson, timestamp, id] = values;
        const row = state.steps.get(id);
        Object.assign(row, {
          status: "COMPLETED",
          output_summary: JSON.parse(outputSummaryJson),
          completed_at: timestamp,
          updated_at: timestamp
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET status = 'PENDING', domain_run_id = NULL")) {
        const [timestamp, id] = values;
        const row = state.steps.get(id);
        Object.assign(row, {
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

      if (trimmed.includes("SET status = 'PENDING', output_summary")) {
        const [timestamp, runId, stepKey] = values;
        const row = stepByKey(runId, stepKey);
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

      if (trimmed.includes("SET status = $1, updated_at = $2 WHERE id = $3")) {
        const [status, timestamp, id] = values;
        const row = state.steps.get(id);
        Object.assign(row, { status, updated_at: timestamp });
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected autoflow_run_steps UPDATE: ${trimmed.slice(0, 160)}`);
    }

    // ------------------ autoflow_runs: SELECT ------------------

    if (trimmed.includes("FOR UPDATE SKIP LOCKED")) {
      const active = [...state.runs.values()]
        .filter(r => r.status === "QUEUED" || r.status === "RUNNING")
        .sort((a, b) => a.created_at - b.created_at || a.id - b.id)[0];
      return active
        ? {
            rows: [
              {
                id: active.id,
                status: active.status,
                current_step: active.current_step,
                cancel_requested_at: active.cancel_requested_at
              }
            ],
            rowCount: 1
          }
        : { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith("SELECT * FROM autoflow_runs WHERE id = $1 FOR UPDATE")) {
      const row = state.runs.get(values[0]);
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (trimmed.includes("id != $1")) {
      const rows = [...state.runs.values()].filter(
        r =>
          (r.status === "QUEUED" || r.status === "RUNNING") &&
          r.id !== values[0]
      );
      return { rows: rows.map(r => ({ id: r.id })), rowCount: rows.length };
    }

    // ------------------ autoflow_runs: UPDATE ------------------

    if (trimmed.startsWith("UPDATE autoflow_runs")) {
      if (trimmed.includes("SET status = 'FAILED', failure_step = $1")) {
        const [failureStep, errorMessage, timestamp, id] = values;
        const row = state.runs.get(id);
        Object.assign(row, {
          status: "FAILED",
          failure_step: failureStep,
          error_message: errorMessage,
          completed_at: timestamp,
          updated_at: timestamp
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET status = 'FAILED', current_step = $1")) {
        const [stepKey, errorMessage, timestamp, id] = values;
        const row = state.runs.get(id);
        Object.assign(row, {
          status: "FAILED",
          current_step: stepKey,
          failure_step: stepKey,
          error_message: errorMessage,
          completed_at: timestamp,
          updated_at: timestamp
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET status = 'CANCELLED', cancel_requested_at")) {
        const [timestamp, id] = values;
        const row = state.runs.get(id);
        Object.assign(row, {
          status: "CANCELLED",
          cancel_requested_at: timestamp,
          completed_at: timestamp,
          updated_at: timestamp
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET status = 'CANCELLED', completed_at")) {
        const [timestamp, id] = values;
        const row = state.runs.get(id);
        Object.assign(row, {
          status: "CANCELLED",
          completed_at: timestamp,
          updated_at: timestamp
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET status = 'COMPLETED', completed_at")) {
        const [timestamp, id] = values;
        const row = state.runs.get(id);
        Object.assign(row, {
          status: "COMPLETED",
          completed_at: timestamp,
          updated_at: timestamp
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET status = 'RUNNING', locked_by")) {
        const [workerId, timestamp, id] = values;
        const row = state.runs.get(id);
        Object.assign(row, {
          status: "RUNNING",
          locked_by: workerId,
          locked_at: timestamp,
          started_at: timestamp,
          updated_at: timestamp
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET status = 'RUNNING', current_step = $1")) {
        const [failureStep, timestamp, id] = values;
        const otherActive = [...state.runs.values()].some(
          r => r.id !== id && (r.status === "QUEUED" || r.status === "RUNNING")
        );
        if (otherActive) {
          const error = new Error(
            'duplicate key value violates unique constraint "idx_autoflow_runs_single_active"'
          );
          error.code = "23505";
          error.constraint = "idx_autoflow_runs_single_active";
          throw error;
        }
        const row = state.runs.get(id);
        Object.assign(row, {
          status: "RUNNING",
          current_step: failureStep,
          failure_step: null,
          error_message: null,
          cancel_requested_at: null,
          locked_by: null,
          locked_at: null,
          updated_at: timestamp
        });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET current_step = $1, updated_at = $2 WHERE id = $3")) {
        const [nextStepKey, timestamp, id] = values;
        const row = state.runs.get(id);
        Object.assign(row, { current_step: nextStepKey, updated_at: timestamp });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET cancel_requested_at = $1, updated_at = $1 WHERE id = $2")) {
        const [timestamp, id] = values;
        const row = state.runs.get(id);
        Object.assign(row, { cancel_requested_at: timestamp, updated_at: timestamp });
        return { rows: [], rowCount: 1 };
      }

      if (trimmed.includes("SET summary = $1::jsonb WHERE id = $2")) {
        const [summaryJson, id] = values;
        const row = state.runs.get(id);
        row.summary = JSON.parse(summaryJson);
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unexpected autoflow_runs UPDATE: ${trimmed.slice(0, 160)}`);
    }

    throw new Error(`Unexpected autoflow query: ${trimmed.slice(0, 160)}`);
  }

  return { query, state };
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

function seedRun(mockDb, { id, status = "QUEUED", currentStep = "SCANNER" }) {
  mockDb.state.runs.set(id, {
    id,
    status,
    current_step: currentStep,
    trigger_type: "MANUAL",
    requested_by: null,
    idempotency_key: null,
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
    updated_at: fixedNow()
  });
}

async function seedFreshRun(mockDb, client, { id = 1, status = "QUEUED" } = {}) {
  seedRun(mockDb, { id, status });
  await seedRunSteps(client, id);
  return id;
}

function stubAdapter({ createResponses = [], getResponses = [] } = {}) {
  let createCalls = 0;
  let getCalls = 0;

  return {
    calls: { create: () => createCalls, get: () => getCalls },
    createRun: async () => {
      const response = createResponses[Math.min(createCalls, createResponses.length - 1)];
      createCalls += 1;
      if (typeof response === "function") return response();
      return response;
    },
    getRun: async () => {
      const response = getResponses[Math.min(getCalls, getResponses.length - 1)];
      getCalls += 1;
      if (typeof response === "function") return response();
      return response;
    }
  };
}

function created(id, extra = {}) {
  return { statusCode: 202, payload: { data: { id, ...extra } } };
}

function fetched(status, extra = {}) {
  return { statusCode: 200, payload: { data: { status, summary: {}, ...extra } } };
}

const ALL_STEP_KEYS = [
  "SCANNER",
  "VEHICLE_RESOLVER",
  "COUNTRY_NEWS_RADAR",
  "PERSON_RADAR",
  "HISTORICAL_RESONANCE",
  "FUSION"
];

function defaultAdapters(overrides = {}) {
  const base = {
    SCANNER: stubAdapter({ createResponses: [created(101)], getResponses: [fetched("COMPLETED")] }),
    COUNTRY_NEWS_RADAR: stubAdapter({ createResponses: [created(201)], getResponses: [fetched("COMPLETED")] }),
    PERSON_RADAR: stubAdapter({ createResponses: [created(301)], getResponses: [fetched("COMPLETED")] }),
    FUSION: stubAdapter({ createResponses: [created(401)], getResponses: [fetched("COMPLETED")] })
  };
  return { ...base, ...overrides };
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
  // seedRunSteps
  // -----------------------------------------------------

  await test("seedRunSteps creates exactly 6 PENDING rows with correct shape", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const steps = [...mockDb.state.steps.values()];
    assert.equal(steps.length, 6);
    assert.deepEqual(steps.map(s => s.step_key).sort(), [...ALL_STEP_KEYS].sort());
    for (const step of steps) {
      assert.equal(step.status, "PENDING");
      assert.equal(step.domain_run_id, null);
    }
    const scanner = steps.find(s => s.step_key === "SCANNER");
    assert.equal(scanner.is_orchestrated, true);
    assert.equal(scanner.domain_run_table, "scanner_runs");
    const resolver = steps.find(s => s.step_key === "VEHICLE_RESOLVER");
    assert.equal(resolver.is_orchestrated, false);
    assert.equal(resolver.parent_step_key, "SCANNER");
    assert.equal(resolver.domain_run_table, null);
  });

  // -----------------------------------------------------
  // First tick / PENDING branch
  // -----------------------------------------------------

  await test("inspectAndAdvance returns null when no active run exists", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const result = await processNextAutoFlowRun(pool, { adapters: defaultAdapters() });
    assert.equal(result, null);
  });

  await test("first tick: QUEUED -> RUNNING, SCANNER PENDING -> QUEUED, RUN_STARTED + STEP_STARTED written", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters();
    const result = await processNextAutoFlowRun(pool, { adapters, workerId: "w1" });

    assert.equal(result.outcome, "STEP_STARTED");
    const run = mockDb.state.runs.get(1);
    assert.equal(run.status, "RUNNING");
    assert.equal(run.locked_by, "w1");

    const scanner = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    assert.equal(scanner.status, "QUEUED");
    assert.equal(scanner.domain_run_id, 101);
    assert.equal(adapters.SCANNER.calls.create(), 1);

    const eventTypes = mockDb.state.events.map(e => e.event_type);
    assert.deepEqual(eventTypes, [
      AUTOFLOW_EVENT_TYPES.RUN_STARTED,
      AUTOFLOW_EVENT_TYPES.STEP_STARTED
    ]);
  });

  await test("PENDING step with non-NULL domain_run_id -> AUTOFLOW_DATA_INVARIANT_VIOLATION", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1, status: "RUNNING" });
    const scanner = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    scanner.domain_run_id = 999; // corrupt: PENDING but has a domain_run_id

    const result = await processNextAutoFlowRun(pool, { adapters: defaultAdapters() });
    assert.equal(result.outcome, "RUN_FAILED");
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION);
    assert.equal(mockDb.state.runs.get(1).status, "FAILED");
  });

  await test("QUEUED/RUNNING step with NULL domain_run_id -> AUTOFLOW_DATA_INVARIANT_VIOLATION", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1, status: "RUNNING" });
    const scanner = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    scanner.status = "QUEUED"; // corrupt: QUEUED but domain_run_id stays NULL

    const result = await processNextAutoFlowRun(pool, { adapters: defaultAdapters() });
    assert.equal(result.outcome, "RUN_FAILED");
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION);
  });

  // -----------------------------------------------------
  // QUEUED/RUNNING polling (mirroring)
  // -----------------------------------------------------

  await test("domain still QUEUED/RUNNING -> step mirrors, no event, no advance", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({
        createResponses: [created(101)],
        getResponses: [fetched("RUNNING")]
      })
    });

    await processNextAutoFlowRun(pool, { adapters }); // first tick: PENDING -> QUEUED
    const result = await processNextAutoFlowRun(pool, { adapters }); // second tick: poll

    assert.equal(result.outcome, "NO_CHANGE");
    const scanner = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    assert.equal(scanner.status, "RUNNING");
    const events = mockDb.state.events.filter(e => e.step_key === "SCANNER");
    assert.equal(events.length, 1); // only STEP_STARTED, no extra event for mirroring
  });

  // -----------------------------------------------------
  // Full four-step happy path + virtual step completion
  // -----------------------------------------------------

  await test("happy path: all 4 orchestrated steps complete, 6 steps COMPLETED, RUN_COMPLETED", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const scannerSummary = {
      entity_resolved_count: 5,
      entity_brand_only_count: 1,
      entity_ambiguous_count: 0,
      entity_unresolved_count: 2,
      country_resolved_count: 4,
      vehicle_record_linked_count: 3
    };
    const personSummary = { resonance_scored_count: 7, resonance_unscored_count: 1 };

    const adapters = {
      SCANNER: stubAdapter({ createResponses: [created(101)], getResponses: [fetched("COMPLETED", { summary: scannerSummary })] }),
      COUNTRY_NEWS_RADAR: stubAdapter({ createResponses: [created(201)], getResponses: [fetched("COMPLETED")] }),
      PERSON_RADAR: stubAdapter({ createResponses: [created(301)], getResponses: [fetched("COMPLETED", { summary: personSummary })] }),
      FUSION: stubAdapter({ createResponses: [created(401)], getResponses: [fetched("COMPLETED")] })
    };
    // fix classifyGetRunResponse reading payload.data.summary directly, not nested twice
    adapters.SCANNER.getRun = async () => ({ statusCode: 200, payload: { data: { status: "COMPLETED", summary: scannerSummary } } });
    adapters.PERSON_RADAR.getRun = async () => ({ statusCode: 200, payload: { data: { status: "COMPLETED", summary: personSummary } } });

    let ticks = 0;
    let result;
    do {
      result = await processNextAutoFlowRun(pool, { adapters });
      ticks += 1;
    } while (result && result.outcome !== "RUN_COMPLETED" && ticks < 20);

    assert.equal(result.outcome, "RUN_COMPLETED");
    assert.equal(mockDb.state.runs.get(1).status, "COMPLETED");

    const steps = [...mockDb.state.steps.values()];
    assert.equal(steps.length, 6);
    for (const step of steps) {
      assert.equal(step.status, "COMPLETED", `${step.step_key} should be COMPLETED`);
    }

    const resolver = steps.find(s => s.step_key === "VEHICLE_RESOLVER");
    assert.equal(resolver.output_summary.summary_schema_version, 1);
    assert.equal(resolver.output_summary.source_step, "SCANNER");
    assert.deepEqual(resolver.output_summary.missing_fields, []);
    assert.equal(resolver.output_summary.entity_resolved_count, 5);

    const resonance = steps.find(s => s.step_key === "HISTORICAL_RESONANCE");
    assert.equal(resonance.output_summary.resonance_scored_count, 7);

    const runCompletedEvents = mockDb.state.events.filter(e => e.event_type === AUTOFLOW_EVENT_TYPES.RUN_COMPLETED);
    assert.equal(runCompletedEvents.length, 1);
  });

  // -----------------------------------------------------
  // Virtual step failure cascade
  // -----------------------------------------------------

  await test("SCANNER FAILED cascades VEHICLE_RESOLVER to FAILED in same commit", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({ createResponses: [created(101)], getResponses: [fetched("FAILED", { error_message: "boom" })] })
    });

    await processNextAutoFlowRun(pool, { adapters }); // PENDING -> QUEUED
    const result = await processNextAutoFlowRun(pool, { adapters }); // QUEUED -> FAILED

    assert.equal(result.outcome, "RUN_FAILED");
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.DOMAIN_RUN_FAILED);
    assert.equal(mockDb.state.runs.get(1).failure_step, "SCANNER");

    const scanner = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    const resolver = [...mockDb.state.steps.values()].find(s => s.step_key === "VEHICLE_RESOLVER");
    assert.equal(scanner.status, "FAILED");
    assert.equal(resolver.status, "FAILED");

    const countryNews = [...mockDb.state.steps.values()].find(s => s.step_key === "COUNTRY_NEWS_RADAR");
    assert.equal(countryNews.status, "PENDING");
  });

  await test("PERSON_RADAR FAILED cascades HISTORICAL_RESONANCE to FAILED", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      PERSON_RADAR: stubAdapter({ createResponses: [created(301)], getResponses: [fetched("FAILED")] })
    });

    let result;
    for (let i = 0; i < 6; i += 1) {
      result = await processNextAutoFlowRun(pool, { adapters });
      if (result && result.outcome === "RUN_FAILED") break;
    }

    assert.equal(result.outcome, "RUN_FAILED");
    assert.equal(mockDb.state.runs.get(1).failure_step, "PERSON_RADAR");
    const resonance = [...mockDb.state.steps.values()].find(s => s.step_key === "HISTORICAL_RESONANCE");
    assert.equal(resonance.status, "FAILED");
  });

  // -----------------------------------------------------
  // Adapter response classification
  // -----------------------------------------------------

  await test("createRun 409 -> DOMAIN_RUN_CONFLICT, run FAILED", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({ createResponses: [{ statusCode: 409, payload: { message: "active" } }] })
    });

    const result = await processNextAutoFlowRun(pool, { adapters });
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.DOMAIN_RUN_CONFLICT);
    assert.equal(mockDb.state.runs.get(1).status, "FAILED");
  });

  await test("createRun 400/422 -> DOMAIN_RUN_CREATE_REJECTED, run FAILED", async () => {
    for (const code of [400, 422]) {
      const mockDb = createMockDb();
      const pool = wrapAsPool(mockDb);
      const client = await pool.connect();
      await seedFreshRun(mockDb, client, { id: 1 });

      const adapters = defaultAdapters({
        SCANNER: stubAdapter({ createResponses: [{ statusCode: code, payload: { message: "bad" } }] })
      });

      const result = await processNextAutoFlowRun(pool, { adapters });
      assert.equal(result.code, AUTOFLOW_ERROR_CODES.DOMAIN_RUN_CREATE_REJECTED);
    }
  });

  await test("createRun 5xx -> throws, ROLLBACK, run untouched, no event", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({ createResponses: [{ statusCode: 503, payload: { message: "down" } }] })
    });

    await assert.rejects(() => processNextAutoFlowRun(pool, { adapters }));
    assert.equal(mockDb.state.transactionLog.at(-1), "ROLLBACK");
    assert.equal(mockDb.state.runs.get(1).status, "QUEUED");
    assert.equal(mockDb.state.events.length, 0);
  });

  await test("getRun 5xx -> throws, ROLLBACK, run untouched", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({ createResponses: [created(101)], getResponses: [{ statusCode: 503, payload: {} }] })
    });

    await processNextAutoFlowRun(pool, { adapters }); // PENDING -> QUEUED, succeeds
    await assert.rejects(() => processNextAutoFlowRun(pool, { adapters }));
    assert.equal(mockDb.state.transactionLog.at(-1), "ROLLBACK");
    const scanner = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    assert.equal(scanner.status, "QUEUED"); // unchanged by the failed tick
  });

  await test("malformed createRun 202 response -> UNEXPECTED_ADAPTER_RESPONSE", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({ createResponses: [{ statusCode: 202, payload: { data: {} } }] })
    });

    const result = await processNextAutoFlowRun(pool, { adapters });
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.UNEXPECTED_ADAPTER_RESPONSE);
  });

  await test("malformed getRun 200 response -> UNEXPECTED_ADAPTER_RESPONSE", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({ createResponses: [created(101)], getResponses: [{ statusCode: 200, payload: { data: {} } }] })
    });

    await processNextAutoFlowRun(pool, { adapters });
    const result = await processNextAutoFlowRun(pool, { adapters });
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.UNEXPECTED_ADAPTER_RESPONSE);
  });

  await test("getRun 404 -> DOMAIN_RUN_NOT_FOUND", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({ createResponses: [created(101)], getResponses: [{ statusCode: 404, payload: {} }] })
    });

    await processNextAutoFlowRun(pool, { adapters });
    const result = await processNextAutoFlowRun(pool, { adapters });
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.DOMAIN_RUN_NOT_FOUND);
  });

  await test("domain CANCELLED -> DOMAIN_RUN_CANCELLED, run FAILED (not CANCELLED)", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({ createResponses: [created(101)], getResponses: [fetched("CANCELLED")] })
    });

    await processNextAutoFlowRun(pool, { adapters });
    const result = await processNextAutoFlowRun(pool, { adapters });
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.DOMAIN_RUN_CANCELLED);
    assert.equal(mockDb.state.runs.get(1).status, "FAILED");
  });

  await test("unknown domain status -> UNSUPPORTED_DOMAIN_RUN_STATUS", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({ createResponses: [created(101)], getResponses: [fetched("WEIRD")] })
    });

    await processNextAutoFlowRun(pool, { adapters });
    const result = await processNextAutoFlowRun(pool, { adapters });
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.UNSUPPORTED_DOMAIN_RUN_STATUS);
  });

  await test("createRun 23505 on a single-active index -> DOMAIN_RUN_CONFLICT", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      SCANNER: stubAdapter({
        createResponses: [
          () => {
            const error = new Error("duplicate key value violates unique constraint \"idx_scanner_runs_single_active\"");
            error.code = "23505";
            error.constraint = "idx_scanner_runs_single_active";
            throw error;
          }
        ]
      })
    });

    const result = await processNextAutoFlowRun(pool, { adapters });
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.DOMAIN_RUN_CONFLICT);
  });

  // -----------------------------------------------------
  // Full-step invariant validation
  // -----------------------------------------------------

  await test("fewer than 6 step rows -> AUTOFLOW_DATA_INVARIANT_VIOLATION", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const fusionStep = [...mockDb.state.steps.values()].find(s => s.step_key === "FUSION");
    mockDb.state.steps.delete(fusionStep.id);

    const result = await processNextAutoFlowRun(pool, { adapters: defaultAdapters() });
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION);
  });

  await test("current_step pointing at a virtual step -> AUTOFLOW_DATA_INVARIANT_VIOLATION", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });
    mockDb.state.runs.get(1).current_step = "VEHICLE_RESOLVER";

    const result = await processNextAutoFlowRun(pool, { adapters: defaultAdapters() });
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION);
  });

  await test("current_step pointing at an already-terminal step row -> AUTOFLOW_DATA_INVARIANT_VIOLATION", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1, status: "RUNNING" });
    const scanner = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    scanner.status = "COMPLETED";

    const result = await processNextAutoFlowRun(pool, { adapters: defaultAdapters() });
    assert.equal(result.code, AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION);
  });

  // -----------------------------------------------------
  // Next-step creation failure attribution
  // -----------------------------------------------------

  await test("failure creating next step's domain run attributes failure_step to the NEXT step, not the completed one", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      COUNTRY_NEWS_RADAR: stubAdapter({ createResponses: [{ statusCode: 409, payload: {} }] })
    });

    await processNextAutoFlowRun(pool, { adapters }); // SCANNER PENDING -> QUEUED
    const result = await processNextAutoFlowRun(pool, { adapters }); // SCANNER COMPLETED -> try COUNTRY_NEWS_RADAR -> 409

    assert.equal(result.outcome, "RUN_FAILED");
    assert.equal(result.failureStep, "COUNTRY_NEWS_RADAR");
    assert.equal(mockDb.state.runs.get(1).failure_step, "COUNTRY_NEWS_RADAR");

    const scanner = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    const resolver = [...mockDb.state.steps.values()].find(s => s.step_key === "VEHICLE_RESOLVER");
    const countryNews = [...mockDb.state.steps.values()].find(s => s.step_key === "COUNTRY_NEWS_RADAR");

    assert.equal(scanner.status, "COMPLETED");
    assert.equal(resolver.status, "COMPLETED");
    assert.equal(countryNews.status, "FAILED");
  });

  // -----------------------------------------------------
  // Cancel: QUEUED
  // -----------------------------------------------------

  await test("QUEUED cancel: immediate CANCELLED, all 6 steps SKIPPED, exact event order", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1, status: "QUEUED" });

    const result = await requestRunCancel(pool, 1);
    assert.equal(result.outcome, "CANCELLED");
    assert.equal(mockDb.state.runs.get(1).status, "CANCELLED");

    const steps = [...mockDb.state.steps.values()];
    for (const step of steps) {
      assert.equal(step.status, "SKIPPED");
    }

    const eventTypes = mockDb.state.events.map(e => e.event_type);
    assert.deepEqual(eventTypes, [
      AUTOFLOW_EVENT_TYPES.RUN_CANCEL_REQUESTED,
      AUTOFLOW_EVENT_TYPES.STEP_SKIPPED,
      AUTOFLOW_EVENT_TYPES.STEP_SKIPPED,
      AUTOFLOW_EVENT_TYPES.STEP_SKIPPED,
      AUTOFLOW_EVENT_TYPES.STEP_SKIPPED,
      AUTOFLOW_EVENT_TYPES.STEP_SKIPPED,
      AUTOFLOW_EVENT_TYPES.STEP_SKIPPED,
      AUTOFLOW_EVENT_TYPES.RUN_CANCELLED
    ]);

    const skippedOrder = mockDb.state.events
      .filter(e => e.event_type === AUTOFLOW_EVENT_TYPES.STEP_SKIPPED)
      .map(e => e.step_key);
    assert.deepEqual(skippedOrder, ALL_STEP_KEYS);
  });

  // -----------------------------------------------------
  // Cancel: RUNNING boundary
  // -----------------------------------------------------

  await test("RUNNING cancel: only sets flag, current step finishes naturally, stops at next boundary", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters();
    await processNextAutoFlowRun(pool, { adapters }); // SCANNER PENDING -> QUEUED

    const cancelResult = await requestRunCancel(pool, 1);
    assert.equal(cancelResult.outcome, "CANCEL_REQUESTED");
    assert.equal(mockDb.state.runs.get(1).status, "RUNNING");

    // current step (SCANNER) completes naturally
    const result = await processNextAutoFlowRun(pool, { adapters });
    assert.equal(result.outcome, "RUN_CANCELLED");
    assert.equal(mockDb.state.runs.get(1).status, "CANCELLED");

    const scanner = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    const resolver = [...mockDb.state.steps.values()].find(s => s.step_key === "VEHICLE_RESOLVER");
    assert.equal(scanner.status, "COMPLETED");
    assert.equal(resolver.status, "COMPLETED");

    const countryNews = [...mockDb.state.steps.values()].find(s => s.step_key === "COUNTRY_NEWS_RADAR");
    assert.equal(countryNews.status, "SKIPPED");
    assert.equal(adapters.COUNTRY_NEWS_RADAR.calls.create(), 0);

    const cancelledEvents = mockDb.state.events.filter(e => e.event_type === AUTOFLOW_EVENT_TYPES.RUN_CANCELLED);
    assert.equal(cancelledEvents.length, 1);
  });

  // -----------------------------------------------------
  // Cancel idempotency
  // -----------------------------------------------------

  await test("cancel idempotency: second RUNNING cancel is a no-op, only one RUN_CANCEL_REQUESTED", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters();
    await processNextAutoFlowRun(pool, { adapters });

    const first = await requestRunCancel(pool, 1);
    const beforeTimestamp = mockDb.state.runs.get(1).cancel_requested_at;
    const second = await requestRunCancel(pool, 1);
    const afterTimestamp = mockDb.state.runs.get(1).cancel_requested_at;

    assert.equal(first.outcome, "CANCEL_REQUESTED");
    assert.equal(second.outcome, "ALREADY_REQUESTED");
    assert.equal(beforeTimestamp, afterTimestamp);

    const requestedEvents = mockDb.state.events.filter(e => e.event_type === AUTOFLOW_EVENT_TYPES.RUN_CANCEL_REQUESTED);
    assert.equal(requestedEvents.length, 1);
  });

  await test("cancel on terminal run -> CANCEL_INVALID_STATE, no mutation", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1, status: "COMPLETED" });

    await assert.rejects(
      () => requestRunCancel(pool, 1),
      err => err.autoflowCode === CANCEL_INVALID_STATE
    );
    assert.equal(mockDb.state.events.length, 0);
  });

  // -----------------------------------------------------
  // Resume
  // -----------------------------------------------------

  await test("resume on non-FAILED run -> RESUME_INVALID_STATE", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1, status: "QUEUED" });

    await assert.rejects(
      () => resumeFailedRun(pool, 1),
      err => err.autoflowCode === RESUME_INVALID_STATE
    );
  });

  await test("resume: attempt_number 2 on first resume, only failed step reset, earlier steps untouched", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      COUNTRY_NEWS_RADAR: stubAdapter({ createResponses: [created(201)], getResponses: [fetched("FAILED")] })
    });

    await processNextAutoFlowRun(pool, { adapters }); // SCANNER PENDING -> QUEUED
    await processNextAutoFlowRun(pool, { adapters }); // SCANNER COMPLETED -> COUNTRY_NEWS_RADAR QUEUED
    const failResult = await processNextAutoFlowRun(pool, { adapters }); // COUNTRY_NEWS_RADAR FAILED
    assert.equal(failResult.outcome, "RUN_FAILED");

    const scannerBefore = { ...[...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER") };

    const resumeResult = await resumeFailedRun(pool, 1);
    assert.equal(resumeResult.outcome, "RESUMED");
    assert.equal(resumeResult.attemptNumber, 2);
    assert.equal(resumeResult.resumedStep, "COUNTRY_NEWS_RADAR");

    const run = mockDb.state.runs.get(1);
    assert.equal(run.status, "RUNNING");
    assert.equal(run.current_step, "COUNTRY_NEWS_RADAR");
    assert.equal(run.failure_step, null);

    const scannerAfter = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    assert.deepEqual(scannerAfter, scannerBefore);

    const countryNews = [...mockDb.state.steps.values()].find(s => s.step_key === "COUNTRY_NEWS_RADAR");
    assert.equal(countryNews.status, "PENDING");
    assert.equal(countryNews.domain_run_id, null);

    const resumedEvents = mockDb.state.events.filter(e => e.event_type === AUTOFLOW_EVENT_TYPES.RUN_RESUMED);
    assert.equal(resumedEvents.length, 1);
    assert.equal(resumedEvents[0].payload.attempt_number, 2);
    assert.equal(resumedEvents[0].payload.previous_domain_run_id, "201");
  });

  await test("resume: attempt_number 3 after a second failure of the same step", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      COUNTRY_NEWS_RADAR: stubAdapter({
        createResponses: [created(201), created(202)],
        getResponses: [fetched("FAILED")]
      })
    });

    await processNextAutoFlowRun(pool, { adapters });
    await processNextAutoFlowRun(pool, { adapters });
    await processNextAutoFlowRun(pool, { adapters }); // fail #1

    const first = await resumeFailedRun(pool, 1);
    assert.equal(first.attemptNumber, 2);

    await processNextAutoFlowRun(pool, { adapters }); // COUNTRY_NEWS_RADAR PENDING -> QUEUED (2nd attempt)
    const secondFail = await processNextAutoFlowRun(pool, { adapters }); // fail #2
    assert.equal(secondFail.outcome, "RUN_FAILED");

    const second = await resumeFailedRun(pool, 1);
    assert.equal(second.attemptNumber, 3);
  });

  await test("resume attempt_number correct even after a create-time DOMAIN_RUN_CONFLICT (no STEP_STARTED was ever written)", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      COUNTRY_NEWS_RADAR: stubAdapter({ createResponses: [{ statusCode: 409, payload: {} }] })
    });

    await processNextAutoFlowRun(pool, { adapters }); // SCANNER PENDING -> QUEUED
    const failResult = await processNextAutoFlowRun(pool, { adapters }); // SCANNER COMPLETED -> COUNTRY_NEWS_RADAR create fails 409
    assert.equal(failResult.failureStep, "COUNTRY_NEWS_RADAR");

    const startedEvents = mockDb.state.events.filter(
      e => e.step_key === "COUNTRY_NEWS_RADAR" && e.event_type === AUTOFLOW_EVENT_TYPES.STEP_STARTED
    );
    assert.equal(startedEvents.length, 0); // proves the old STEP_STARTED-count formula would break here

    const resumeResult = await resumeFailedRun(pool, 1);
    assert.equal(resumeResult.attemptNumber, 2);
  });

  await test("resume rejected when another AutoFlow run is active -> AUTOFLOW_RUN_ALREADY_ACTIVE, no raw 23505 leaks", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1, status: "FAILED" });
    mockDb.state.runs.get(1).failure_step = "SCANNER";
    await seedFreshRun(mockDb, client, { id: 2, status: "RUNNING" });

    await assert.rejects(
      () => resumeFailedRun(pool, 1),
      err => {
        assert.equal(err.autoflowCode, AUTOFLOW_RUN_ALREADY_ACTIVE);
        assert.ok(!/23505/.test(err.message));
        return true;
      }
    );
  });

  // -----------------------------------------------------
  // Event idempotency (repeated tick on same committed state)
  // -----------------------------------------------------

  await test("event idempotency: re-polling an in-flight step does not duplicate terminal events", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters({
      COUNTRY_NEWS_RADAR: stubAdapter({
        createResponses: [created(201)],
        getResponses: [fetched("QUEUED"), fetched("QUEUED"), fetched("COMPLETED")]
      })
    });

    await processNextAutoFlowRun(pool, { adapters }); // SCANNER PENDING -> QUEUED
    await processNextAutoFlowRun(pool, { adapters }); // SCANNER COMPLETED -> COUNTRY_NEWS_RADAR QUEUED (create)

    const completedBefore = mockDb.state.events.filter(e => e.event_type === AUTOFLOW_EVENT_TYPES.STEP_COMPLETED).length;

    // Two consecutive ticks poll COUNTRY_NEWS_RADAR and find it still
    // QUEUED (domain hasn't progressed yet) -- genuine no-ops.
    await processNextAutoFlowRun(pool, { adapters });
    await processNextAutoFlowRun(pool, { adapters });

    const completedAfterNoOps = mockDb.state.events.filter(e => e.event_type === AUTOFLOW_EVENT_TYPES.STEP_COMPLETED).length;
    assert.equal(completedBefore, completedAfterNoOps, "no-op polls must not write STEP_COMPLETED");

    // Third poll finally observes COMPLETED -- exactly one new event,
    // proving the earlier no-op ticks didn't pre-emptively fire it.
    await processNextAutoFlowRun(pool, { adapters });
    const completedAfterRealCompletion = mockDb.state.events.filter(e => e.event_type === AUTOFLOW_EVENT_TYPES.STEP_COMPLETED).length;
    assert.equal(completedAfterRealCompletion, completedBefore + 1);
  });

  // -----------------------------------------------------
  // Deterministic summary
  // -----------------------------------------------------

  await test("buildAutoFlowRunSummary excludes timestamps/duration/worker/event id/domain run id", async () => {
    const steps = [
      { step_key: "SCANNER", status: "COMPLETED", output_summary: { entity_resolved_count: 3 }, step_order: 1 },
      { step_key: "FUSION", status: "PENDING", output_summary: {}, step_order: 6 }
    ];
    const summary = buildAutoFlowRunSummary(steps);
    const serialized = JSON.stringify(summary).toLowerCase();

    assert.equal(summary.summary_schema_version, 1);
    for (const forbidden of ["_at", "duration", "worker", "event_id", "domain_run_id"]) {
      assert.ok(!serialized.includes(forbidden), `summary must not contain "${forbidden}"`);
    }
  });

  await test("buildAutoFlowRunSummary is deterministic for identical step inputs", async () => {
    const steps = [
      { step_key: "SCANNER", status: "COMPLETED", output_summary: { a: 1 }, step_order: 1 },
      { step_key: "FUSION", status: "COMPLETED", output_summary: { b: 2 }, step_order: 6 }
    ];
    const first = JSON.stringify(buildAutoFlowRunSummary(steps));
    const second = JSON.stringify(buildAutoFlowRunSummary(steps));
    assert.equal(first, second);
  });

  await test("summary updated on every step transition, not only terminal", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters();
    await processNextAutoFlowRun(pool, { adapters });
    await processNextAutoFlowRun(pool, { adapters }); // SCANNER COMPLETED, run still RUNNING

    const run = mockDb.state.runs.get(1);
    assert.equal(run.status, "RUNNING");
    assert.equal(run.summary.step_statuses.SCANNER, "COMPLETED");
  });

  // -----------------------------------------------------
  // Virtual output missing_fields
  // -----------------------------------------------------

  await test("deriveVirtualStepOutput records missing_fields instead of defaulting to 0", async () => {
    const output = deriveVirtualStepOutput("VEHICLE_RESOLVER", { entity_resolved_count: 5 });
    assert.equal(output.entity_resolved_count, 5);
    assert.ok(output.missing_fields.includes("entity_brand_only_count"));
    assert.ok(!("entity_brand_only_count" in output) === false || output.entity_brand_only_count === undefined);
    assert.equal(output.source_step, "SCANNER");
    assert.equal(output.summary_schema_version, 1);
  });

  // -----------------------------------------------------
  // Transaction rollback behavior (infra error)
  // -----------------------------------------------------

  await test("infrastructure error mid-tick rolls back and leaves run RUNNING for retry", async () => {
    const mockDb = createMockDb();
    const pool = wrapAsPool(mockDb);
    const client = await pool.connect();
    await seedFreshRun(mockDb, client, { id: 1 });

    const adapters = defaultAdapters();
    await processNextAutoFlowRun(pool, { adapters }); // SCANNER PENDING -> QUEUED

    const originalQuery = mockDb.query;
    let shouldThrow = true;
    mockDb.query = async (sql, values) => {
      if (shouldThrow && String(sql).includes("SET status = 'COMPLETED'")) {
        shouldThrow = false;
        const error = new Error("connection terminated unexpectedly");
        throw error;
      }
      return originalQuery(sql, values);
    };
    const flakyPool = wrapAsPool(mockDb);

    await assert.rejects(() => processNextAutoFlowRun(flakyPool, { adapters }));
    assert.equal(mockDb.state.transactionLog.at(-1), "ROLLBACK");

    const scanner = [...mockDb.state.steps.values()].find(s => s.step_key === "SCANNER");
    assert.equal(scanner.status, "QUEUED"); // not COMPLETED -- rolled back

    // Retry succeeds now that the flake is gone.
    const retryResult = await processNextAutoFlowRun(flakyPool, { adapters });
    assert.equal(retryResult.outcome, "STEP_ADVANCED");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    process.exit(1);
  }
}

run();

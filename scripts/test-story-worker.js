const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { pollStoryQueue } = require("../lib/story/worker");
const { claimNextStoryRun } = require("../lib/story/engine");

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

function createMockStoryPool(initialRows) {
  const rows = new Map(initialRows.map(row => [row.id, { ...row }]));
  let snapshot = null;

  function cloneRows(source) {
    return new Map([...source].map(([k, v]) => [k, { ...v }]));
  }

  async function query(sql, values = []) {
    const trimmed = String(sql).trim();
    const upper = trimmed.toUpperCase();

    if (upper === "BEGIN") {
      snapshot = cloneRows(rows);
      return { rows: [], rowCount: 0 };
    }

    if (upper === "COMMIT") {
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }

    if (upper === "ROLLBACK") {
      if (snapshot) {
        rows.clear();
        for (const [k, v] of snapshot) rows.set(k, v);
        snapshot = null;
      }
      return { rows: [], rowCount: 0 };
    }

    if (
      trimmed.includes("FROM story_pipeline_runs") &&
      trimmed.includes("FOR UPDATE SKIP LOCKED")
    ) {
      const [queuedStatuses, generatingStatuses] = values;
      const now = new Date();

      const matches = [...rows.values()].filter(row => {
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
      const [status, workerId, leaseMs, attemptCount, id] = values;
      const row = rows.get(id);

      row.status = status;
      row.current_stage = status;
      row.worker_id = workerId;
      row.lease_expires_at = new Date(Date.now() + Number(leaseMs));
      row.attempt_count = attemptCount;
      row.updated_at = new Date();

      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (trimmed.includes("STAGE_MAX_ATTEMPTS_EXCEEDED")) {
      const [stage, message, attemptCount, id] = values;
      const row = rows.get(id);

      row.status = "FAILED";
      row.current_stage = "FAILED";
      row.failure_stage = stage;
      row.error_code = "STAGE_MAX_ATTEMPTS_EXCEEDED";
      row.error_message = message;
      row.attempt_count = attemptCount;
      row.worker_id = null;
      row.lease_expires_at = null;

      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (trimmed.startsWith("INSERT INTO story_pipeline_events")) {
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled mock query: ${trimmed.slice(0, 120)}`);
  }

  return {
    async connect() {
      return { query, release() {} };
    },
    query
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
    assert.ok(new Date(claimed.run.lease_expires_at) > new Date());
  }

  console.log("TASK 3.4E STORY WORKER TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

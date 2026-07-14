const assert = require("node:assert/strict");

const { pollAutoFlowQueue } = require("../lib/autoflow/worker");

// ---------------------------------------------------------
// No real Postgres connection is used anywhere in this file.
// `pool` is only ever forwarded, untouched, to whatever fake
// processNextAutoFlowRun a case injects.
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

async function run() {
  // -------------------------------------------------------
  // Case 1: no active AutoFlow run at all (engine returns
  // null). Poller must report unprocessed and stay quiet.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollAutoFlowQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextAutoFlowRun: async () => null
    });

    assert.equal(processed, false);
    assert.deepEqual(sink.infoLogs, []);
    assert.deepEqual(sink.errorLogs, []);
  }

  // -------------------------------------------------------
  // Case 2: AutoFlow is waiting on an in-flight Domain run
  // (NO_CHANGE). This is the core regression guard — a
  // NO_CHANGE tick must NEVER be reported as processed, or
  // pollQueues() would stop before the Scanner/News/Person/
  // Fusion queue gets a turn, starving the very run AutoFlow
  // is waiting on.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollAutoFlowQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextAutoFlowRun: async () => ({
        outcome: "NO_CHANGE",
        runId: 1,
        stepKey: "SCANNER",
        domainStatus: "QUEUED"
      })
    });

    assert.equal(processed, false);

    // NO_CHANGE must not spam a general info log every
    // 250ms poll — no log call is expected for it.
    assert.deepEqual(sink.infoLogs, []);
  }

  // -------------------------------------------------------
  // Case 3: STEP_STARTED is a material transition.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollAutoFlowQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextAutoFlowRun: async () => ({
        outcome: "STEP_STARTED",
        runId: 1,
        stepKey: "SCANNER"
      })
    });

    assert.equal(processed, true);
    assert.equal(sink.infoLogs.length, 1);
    assert.equal(sink.infoLogs[0].event, "autoflow_step_started");
    assert.equal(sink.infoLogs[0].run_id, "1");
    assert.equal(sink.infoLogs[0].step_key, "SCANNER");
  }

  // -------------------------------------------------------
  // Case 4: STEP_ADVANCED is a material transition.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollAutoFlowQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextAutoFlowRun: async () => ({
        outcome: "STEP_ADVANCED",
        runId: 1,
        toStep: "COUNTRY_NEWS_RADAR"
      })
    });

    assert.equal(processed, true);
    assert.equal(sink.infoLogs.length, 1);
    assert.equal(sink.infoLogs[0].event, "autoflow_step_advanced");
    assert.equal(sink.infoLogs[0].run_id, "1");
    assert.equal(sink.infoLogs[0].to_step, "COUNTRY_NEWS_RADAR");
  }

  // -------------------------------------------------------
  // Case 5: RUN_COMPLETED.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollAutoFlowQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextAutoFlowRun: async () => ({
        outcome: "RUN_COMPLETED",
        runId: 7
      })
    });

    assert.equal(processed, true);
    assert.equal(sink.infoLogs.length, 1);
    assert.equal(sink.infoLogs[0].event, "autoflow_run_completed");
    assert.equal(sink.infoLogs[0].run_id, "7");
  }

  // -------------------------------------------------------
  // Case 6: RUN_FAILED must surface failure_step and code.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollAutoFlowQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextAutoFlowRun: async () => ({
        outcome: "RUN_FAILED",
        runId: 1,
        failureStep: "PERSON_RADAR",
        code: "DOMAIN_RUN_FAILED"
      })
    });

    assert.equal(processed, true);
    assert.equal(sink.infoLogs.length, 1);
    assert.equal(sink.infoLogs[0].event, "autoflow_run_failed");
    assert.equal(sink.infoLogs[0].run_id, "1");
    assert.equal(sink.infoLogs[0].failure_step, "PERSON_RADAR");
    assert.equal(sink.infoLogs[0].code, "DOMAIN_RUN_FAILED");
  }

  // -------------------------------------------------------
  // Case 7: RUN_CANCELLED.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollAutoFlowQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextAutoFlowRun: async () => ({
        outcome: "RUN_CANCELLED",
        runId: 3
      })
    });

    assert.equal(processed, true);
    assert.equal(sink.infoLogs.length, 1);
    assert.equal(sink.infoLogs[0].event, "autoflow_run_cancelled");
    assert.equal(sink.infoLogs[0].run_id, "3");
  }

  // -------------------------------------------------------
  // Case 8: workerId must reach the engine call as
  // { workerId }, the same contract every other Domain
  // poller in jobs/worker/index.js already relies on.
  // -------------------------------------------------------
  {
    const sink = createLogSink();
    let receivedPool = null;
    let receivedOptions = null;

    await pollAutoFlowQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextAutoFlowRun: async (pool, options) => {
        receivedPool = pool;
        receivedOptions = options;
        return null;
      }
    });

    assert.equal(receivedPool, FAKE_POOL);
    assert.deepEqual(receivedOptions, { workerId: "test-worker" });
  }

  // -------------------------------------------------------
  // Case 9: schema not migrated yet (42P01) must not crash
  // the worker — it logs autoflow_schema_waiting and returns
  // unprocessed, exactly like every other Domain queue.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollAutoFlowQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextAutoFlowRun: async () => {
        const error = new Error(
          'relation "autoflow_runs" does not exist'
        );
        error.code = "42P01";
        throw error;
      }
    });

    assert.equal(processed, false);
    assert.equal(sink.infoLogs.length, 1);
    assert.equal(sink.infoLogs[0].event, "autoflow_schema_waiting");
    assert.deepEqual(sink.errorLogs, []);
  }

  // -------------------------------------------------------
  // Case 10: an unexpected error must be reported (not
  // swallowed) via logError, while still returning false so
  // the other four queues get to run on the same poll cycle.
  // -------------------------------------------------------
  {
    const sink = createLogSink();

    const processed = await pollAutoFlowQueue({
      pool: FAKE_POOL,
      workerId: "test-worker",
      log: sink.log,
      logError: sink.logError,
      processNextAutoFlowRun: async () => {
        throw new Error("connection reset");
      }
    });

    assert.equal(processed, false);
    assert.equal(sink.errorLogs.length, 1);
    assert.equal(sink.errorLogs[0].event, "autoflow_poll_failed");
    assert.equal(sink.errorLogs[0].error, "connection reset");
  }

  // -------------------------------------------------------
  // Case 11: fair rotation / no starvation. This mirrors the
  // real pollQueues() loop in jobs/worker/index.js: iterate
  // the pollers in order and stop at the first one that
  // reports processed = true. An AutoFlow poller that
  // (incorrectly) treated NO_CHANGE as processed would stop
  // the cycle here and the Domain poller below would never
  // run — this test fails loudly if that regression appears.
  // -------------------------------------------------------
  {
    const sink = createLogSink();
    let domainPollerCalled = false;

    async function fakeAutoFlowPoller() {
      return pollAutoFlowQueue({
        pool: FAKE_POOL,
        workerId: "test-worker",
        log: sink.log,
        logError: sink.logError,
        processNextAutoFlowRun: async () => ({
          outcome: "NO_CHANGE",
          runId: 1,
          stepKey: "SCANNER",
          domainStatus: "QUEUED"
        })
      });
    }

    async function fakeDomainPoller() {
      domainPollerCalled = true;
      return true;
    }

    const pollers = [fakeAutoFlowPoller, fakeDomainPoller];

    let processedRun = false;

    for (
      let index = 0;
      index < pollers.length && !processedRun;
      index += 1
    ) {
      processedRun = Boolean(await pollers[index]());
    }

    assert.equal(domainPollerCalled, true);
    assert.equal(processedRun, true);
  }

  // -------------------------------------------------------
  // Case 12: material transition fast follow-up. When
  // AutoFlow itself reports a material transition, the
  // scheduler must treat that poll cycle as processed
  // (eligible for the existing 250ms fast follow-up) without
  // needing to fall through to the next Domain poller.
  // -------------------------------------------------------
  {
    const sink = createLogSink();
    let domainPollerCalled = false;

    async function fakeAutoFlowPoller() {
      return pollAutoFlowQueue({
        pool: FAKE_POOL,
        workerId: "test-worker",
        log: sink.log,
        logError: sink.logError,
        processNextAutoFlowRun: async () => ({
          outcome: "STEP_STARTED",
          runId: 1,
          stepKey: "SCANNER"
        })
      });
    }

    async function fakeDomainPoller() {
      domainPollerCalled = true;
      return true;
    }

    const pollers = [fakeAutoFlowPoller, fakeDomainPoller];

    let processedRun = false;

    for (
      let index = 0;
      index < pollers.length && !processedRun;
      index += 1
    ) {
      processedRun = Boolean(await pollers[index]());
    }

    assert.equal(processedRun, true);
    assert.equal(domainPollerCalled, false);
  }

  console.log("TASK 3.3G.4 AUTOFLOW WORKER TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

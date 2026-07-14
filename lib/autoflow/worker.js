const { processNextAutoFlowRun } = require("./engine");

// AutoFlow's own tick only inspects/advances the AutoFlow
// state machine — it never runs Scanner, Country News,
// Person Radar, or Fusion logic itself. A NO_CHANGE outcome
// means AutoFlow is watching a Domain run that is still
// QUEUED/RUNNING, so it must be treated as unprocessed:
// returning true here would stop pollQueues() before the
// Domain queue ever gets a turn, starving the run AutoFlow
// is waiting on.
const MATERIAL_OUTCOMES = new Set([
  "STEP_STARTED",
  "STEP_ADVANCED",
  "RUN_COMPLETED",
  "RUN_FAILED",
  "RUN_CANCELLED"
]);

function buildLogFields(result) {
  const fields = {};

  if (result.runId !== undefined && result.runId !== null) {
    fields.run_id = String(result.runId);
  }

  if (result.stepKey !== undefined) {
    fields.step_key = result.stepKey;
  }

  if (result.toStep !== undefined) {
    fields.to_step = result.toStep;
  }

  if (result.failureStep !== undefined) {
    fields.failure_step = result.failureStep;
  }

  if (result.code !== undefined) {
    fields.code = result.code;
  }

  return fields;
}

async function pollAutoFlowQueue({
  pool,
  workerId,
  log,
  logError,
  processNextAutoFlowRun: processNextAutoFlowRunFn = processNextAutoFlowRun
}) {
  try {
    const result = await processNextAutoFlowRunFn(pool, { workerId });

    if (!result) {
      return false;
    }

    if (result.outcome === "NO_CHANGE") {
      return false;
    }

    if (!MATERIAL_OUTCOMES.has(result.outcome)) {
      return false;
    }

    const eventByOutcome = {
      STEP_STARTED: "autoflow_step_started",
      STEP_ADVANCED: "autoflow_step_advanced",
      RUN_COMPLETED: "autoflow_run_completed",
      RUN_FAILED: "autoflow_run_failed",
      RUN_CANCELLED: "autoflow_run_cancelled"
    };

    log(eventByOutcome[result.outcome], buildLogFields(result));

    return true;
  } catch (error) {
    if (error?.code === "42P01") {
      log("autoflow_schema_waiting", {
        message: "AutoFlow migration has not been applied yet."
      });
    } else {
      logError("autoflow_poll_failed", error);
    }

    return false;
  }
}

module.exports = {
  pollAutoFlowQueue
};

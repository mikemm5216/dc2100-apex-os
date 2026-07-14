const { processNextStoryRun } = require("./engine");

// Story Pipeline's own tick only claims and advances QUEUED_*
// story runs -- it never touches Scanner, Country News, Person
// Radar, Fusion, or AutoFlow state. A run sitting in any
// AWAITING_* (Human Gate) status is invisible to the claim
// query, so "no run claimed" already means either genuinely no
// work or a run waiting on a human -- both must report
// unprocessed without logging, to avoid spamming a log line
// every 250ms poll while a human gate is pending.
const STAGE_STARTED_EVENT = {
  DIRECTIONS: "story_directions_started",
  OUTLINE: "story_outline_started",
  SCRIPTS: "story_scripts_started"
};

const STAGE_ADVANCED_EVENT = {
  DIRECTIONS: "story_directions_generated",
  OUTLINE: "story_outline_generated",
  SCRIPTS: "story_scripts_generated"
};

async function pollStoryQueue({
  pool,
  workerId,
  log,
  logError,
  processNextStoryRun: processNextStoryRunFn = processNextStoryRun
}) {
  try {
    const result = await processNextStoryRunFn(pool, {
      workerId,
      onStageStarted(stage, run) {
        const event = STAGE_STARTED_EVENT[stage];

        if (event) {
          log(event, { run_id: String(run.id), stage });
        }
      }
    });

    if (!result) {
      return false;
    }

    if (result.outcome === "NO_CHANGE") {
      return false;
    }

    if (result.outcome === "RUN_FAILED") {
      log("story_generation_failed", {
        run_id: result.runId,
        stage: result.stage,
        code: result.errorCode
      });

      return true;
    }

    if (result.outcome === "RUN_CANCELLED") {
      log("story_run_cancelled", { run_id: result.runId });
      return true;
    }

    if (result.outcome === "RUN_RESUMED") {
      log("story_run_resumed", { run_id: result.runId });
      return true;
    }

    if (result.outcome === "STAGE_ADVANCED") {
      const event = STAGE_ADVANCED_EVENT[result.stage];

      log(event || "story_stage_advanced", {
        run_id: String(result.run.id),
        stage: result.stage
      });

      return true;
    }

    return false;
  } catch (error) {
    if (error?.code === "42P01") {
      log("story_schema_waiting", {
        message: "Story pipeline migration has not been applied yet."
      });
    } else {
      logError("story_poll_failed", error);
    }

    return false;
  }
}

module.exports = {
  pollStoryQueue
};

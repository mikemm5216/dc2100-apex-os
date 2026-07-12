const os = require("node:os");
const {
  randomUUID
} = require("node:crypto");

const { Pool } = require("pg");

const {
  processNextRun
} = require("../../lib/scanner/engine");

const {
  processNextCountryNewsRun
} = require("../../lib/news/engine");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

function parseInterval(value, fallback) {
  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < 1000 ||
    parsed > 60000
  ) {
    return fallback;
  }

  return parsed;
}

const pollIntervalMs = parseInterval(
  process.env.SCANNER_POLL_INTERVAL_MS,
  5000
);

const workerId =
  process.env.WORKER_ID ||
  [
    os.hostname(),
    process.pid,
    randomUUID().slice(0, 8)
  ].join(":");

let shuttingDown = false;
let pollTimer = null;
let heartbeatTimer = null;
let activePoll = Promise.resolve();

function log(event, fields = {}) {
  console.log(
    JSON.stringify({
      event,
      service: "apex-worker",
      worker_id: workerId,
      timestamp: new Date().toISOString(),
      ...fields
    })
  );
}

function logError(event, error, fields = {}) {
  console.error(
    JSON.stringify({
      event,
      service: "apex-worker",
      worker_id: workerId,
      timestamp: new Date().toISOString(),
      error: String(
        error?.message ||
        "Unknown worker error"
      ),
      code: error?.code || null,
      ...fields
    })
  );
}

function scheduleNextPoll(delayMs) {
  if (shuttingDown) {
    return;
  }

  pollTimer = setTimeout(() => {
    activePoll = pollScannerQueue();
  }, delayMs);
}

// Country News queue: only polled when the Vehicle
// Scanner queue is idle, so vehicle scanning always keeps
// priority inside the single worker loop.
async function pollCountryNewsQueue() {
  try {
    const result =
      await processNextCountryNewsRun(
        pool,
        {
          workerId,
          onRunStarted(run) {
            log(
              "country_news_run_started",
              {
                run_id: String(run.id)
              }
            );
          },
          onCountryCompleted(country, state) {
            log(
              "country_news_country_completed",
              {
                country_code:
                  country.country_code,
                completed_country_count:
                  state.completedCountryCount,
                failed_country_count:
                  state.failedCountryCount
              }
            );
          }
        }
      );

    if (!result) {
      return false;
    }

    for (const item of result.errors || []) {
      if (item.scope === "query") {
        log(
          "country_news_query_failed",
          {
            run_id: result.runId,
            country_code: item.country_code,
            query_key: item.query_key,
            code: item.code,
            message: item.message
          }
        );
      }
    }

    const completionEvent =
      result.status === "COMPLETED"
        ? "country_news_run_completed"
        : "country_news_run_failed";

    log(
      completionEvent,
      {
        run_id: result.runId,
        status: result.status,
        country_count: result.countryCount,
        completed_country_count:
          result.completedCountryCount,
        failed_country_count:
          result.failedCountryCount,
        query_count: result.queryCount,
        succeeded_query_count:
          result.succeededQueryCount,
        item_count: result.itemCount,
        mention_inserted_count:
          result.mentionInsertedCount,
        mention_updated_count:
          result.mentionUpdatedCount,
        cluster_inserted_count:
          result.clusterInsertedCount,
        cluster_updated_count:
          result.clusterUpdatedCount,
        breakout_count: result.breakoutCount,
        active_count: result.activeCount,
        watch_count: result.watchCount,
        low_signal_count:
          result.lowSignalCount,
        high_transformation_count:
          result.highTransformationCount,
        medium_transformation_count:
          result.mediumTransformationCount,
        low_transformation_count:
          result.lowTransformationCount
      }
    );

    return true;
  } catch (error) {
    if (error?.code === "42P01") {
      log(
        "country_news_schema_waiting",
        {
          message:
            "Country news migration has not been applied yet."
        }
      );
    } else {
      logError(
        "country_news_poll_failed",
        error
      );
    }

    return false;
  }
}

async function pollScannerQueue() {
  if (shuttingDown) {
    return;
  }

  let processedRun = false;

  try {
    const result = await processNextRun(
      pool,
      {
        workerId,
        apiKey:
          process.env.YOUTUBE_API_KEY
      }
    );

    if (result) {
      processedRun = true;

      log(
        "scanner_run_completed",
        {
          run_id: result.runId,
          status: result.status,
          source_count:
            result.sourceCount,
          resolved_source_count:
            result.resolvedSourceCount,
          failed_source_count:
            result.failedSourceCount,
          video_count:
            result.videoCount,
          inserted_count:
            result.insertedCount,
          updated_count:
            result.updatedCount,
          shorts_accepted:
            result.shortsAccepted,
          long_videos_rejected:
            result.longVideosRejected,
          proven_count:
            result.provenCount,
          rising_count:
            result.risingCount,
          watch_count:
            result.watchCount,
          unqualified_count:
            result.unqualifiedCount,
          qualified_count:
            result.qualifiedCount,
          entity_resolved_count:
            result.entityResolvedCount,
          entity_brand_only_count:
            result.entityBrandOnlyCount,
          entity_ambiguous_count:
            result.entityAmbiguousCount,
          entity_unresolved_count:
            result.entityUnresolvedCount,
          entity_not_applicable_count:
            result.entityNotApplicableCount,
          country_resolved_count:
            result.countryResolvedCount,
          vehicle_record_linked_count:
            result.vehicleRecordLinkedCount,
          quota_units_estimated:
            result.quotaUnits
        }
      );
    }
  } catch (error) {
    if (error?.code === "42P01") {
      log(
        "scanner_schema_waiting",
        {
          message:
            "Scanner migration has not been applied yet."
        }
      );
    } else {
      logError(
        "scanner_poll_failed",
        error
      );
    }
  }

  // Vehicle Scanner keeps priority: the Country News
  // queue only runs when no vehicle run was claimed.
  if (!processedRun && !shuttingDown) {
    const processedNewsRun =
      await pollCountryNewsQueue();

    processedRun =
      processedRun || processedNewsRun;
  }

  scheduleNextPoll(
    processedRun
      ? 250
      : pollIntervalMs
  );
}

async function boot() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required."
    );
  }

  if (!process.env.YOUTUBE_API_KEY) {
    throw new Error(
      "YOUTUBE_API_KEY is required."
    );
  }

  await pool.query("SELECT 1");

  log(
    "worker_ready",
    {
      database: "connected",
      scanner_poll_interval_ms:
        pollIntervalMs
    }
  );

  heartbeatTimer = setInterval(() => {
    log("worker_heartbeat");
  }, 300000);

  scheduleNextPoll(0);
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  log(
    "worker_shutdown_started",
    {
      signal
    }
  );

  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }

  try {
    await activePoll;
  } catch {
    // Poll errors are already logged.
  }

  await pool.end();

  log(
    "worker_shutdown_completed",
    {
      signal
    }
  );

  process.exit(0);
}

boot().catch(error => {
  logError(
    "worker_boot_failed",
    error
  );

  process.exit(1);
});

process.on(
  "SIGTERM",
  () => shutdown("SIGTERM")
);

process.on(
  "SIGINT",
  () => shutdown("SIGINT")
);

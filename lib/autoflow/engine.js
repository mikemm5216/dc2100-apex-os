// =========================================================
// AUTOFLOW ORCHESTRATOR ENGINE
// Task 3.3G.2
//
// Pure orchestration layer over the four already-accepted
// domains (Scanner, Country News Radar, Person Radar,
// Fusion). This module never re-implements any domain's
// business logic -- it only calls each domain's existing
// createXRun/getXRun functions and reacts to their reported
// status.
//
// Vehicle Resolver and Historical Resonance are virtual
// display steps: they never get their own domain run. Their
// status/output always mirror their orchestrated parent
// (Scanner / Person Radar respectively).
// =========================================================

const {
  createScannerRun,
  getScannerRun
} = require("../scanner/api");

const {
  createCountryNewsRun,
  getCountryNewsRun
} = require("../news/api");

const {
  createPersonRadarRun,
  getPersonRadarRun
} = require("../person/api");

const {
  createFusionRun,
  getFusionRun
} = require("../fusion/api");

// =========================================================
// FIXED STEP DEFINITIONS
// =========================================================

const AUTOFLOW_STEP_ORDER = [
  "SCANNER",
  "VEHICLE_RESOLVER",
  "COUNTRY_NEWS_RADAR",
  "PERSON_RADAR",
  "HISTORICAL_RESONANCE",
  "FUSION"
];

const ORCHESTRATED_STEPS = [
  "SCANNER",
  "COUNTRY_NEWS_RADAR",
  "PERSON_RADAR",
  "FUSION"
];

const VIRTUAL_STEPS = [
  "VEHICLE_RESOLVER",
  "HISTORICAL_RESONANCE"
];

// Mirrors autoflow_run_steps_step_key_shape_valid in
// 012_autoflow_orchestrator.sql exactly -- single source of
// truth for step_order / is_orchestrated / parent_step_key /
// domain_run_table per step_key.
const STEP_DEFINITIONS = {
  SCANNER: {
    order: 1,
    isOrchestrated: true,
    parentStepKey: null,
    domainRunTable: "scanner_runs"
  },
  VEHICLE_RESOLVER: {
    order: 2,
    isOrchestrated: false,
    parentStepKey: "SCANNER",
    domainRunTable: null
  },
  COUNTRY_NEWS_RADAR: {
    order: 3,
    isOrchestrated: true,
    parentStepKey: null,
    domainRunTable: "country_news_runs"
  },
  PERSON_RADAR: {
    order: 4,
    isOrchestrated: true,
    parentStepKey: null,
    domainRunTable: "person_radar_runs"
  },
  HISTORICAL_RESONANCE: {
    order: 5,
    isOrchestrated: false,
    parentStepKey: "PERSON_RADAR",
    domainRunTable: null
  },
  FUSION: {
    order: 6,
    isOrchestrated: true,
    parentStepKey: null,
    domainRunTable: "fusion_runs"
  }
};

// Orchestrated parent -> its virtual child.
const VIRTUAL_CHILD_OF = {
  SCANNER: "VEHICLE_RESOLVER",
  PERSON_RADAR: "HISTORICAL_RESONANCE"
};

// Orchestrated step -> next orchestrated step (null = last).
const NEXT_ORCHESTRATED_STEP = {
  SCANNER: "COUNTRY_NEWS_RADAR",
  COUNTRY_NEWS_RADAR: "PERSON_RADAR",
  PERSON_RADAR: "FUSION",
  FUSION: null
};

// =========================================================
// EVENT / ERROR CODE VOCABULARY
//
// event_type has no DB CHECK constraint (deliberate, per
// 3.3G.1) -- this object is the enforced code-level
// convention instead.
// =========================================================

const AUTOFLOW_EVENT_TYPES = {
  RUN_STARTED: "RUN_STARTED",
  STEP_STARTED: "STEP_STARTED",
  STEP_COMPLETED: "STEP_COMPLETED",
  STEP_FAILED: "STEP_FAILED",
  STEP_SKIPPED: "STEP_SKIPPED",
  RUN_COMPLETED: "RUN_COMPLETED",
  RUN_FAILED: "RUN_FAILED",
  RUN_CANCEL_REQUESTED: "RUN_CANCEL_REQUESTED",
  RUN_CANCELLED: "RUN_CANCELLED",
  RUN_RESUMED: "RUN_RESUMED"
};

// Deterministic errors: a normal, committed FAILED
// transition (not a thrown/rolled-back exception).
const AUTOFLOW_ERROR_CODES = {
  DOMAIN_RUN_FAILED: "DOMAIN_RUN_FAILED",
  DOMAIN_RUN_CONFLICT: "DOMAIN_RUN_CONFLICT",
  DOMAIN_RUN_CREATE_REJECTED: "DOMAIN_RUN_CREATE_REJECTED",
  DOMAIN_RUN_NOT_FOUND: "DOMAIN_RUN_NOT_FOUND",
  DOMAIN_RUN_CANCELLED: "DOMAIN_RUN_CANCELLED",
  UNSUPPORTED_DOMAIN_RUN_STATUS: "UNSUPPORTED_DOMAIN_RUN_STATUS",
  UNEXPECTED_ADAPTER_RESPONSE: "UNEXPECTED_ADAPTER_RESPONSE",
  AUTOFLOW_DATA_INVARIANT_VIOLATION: "AUTOFLOW_DATA_INVARIANT_VIOLATION"
};

// Request-rejection errors: thrown by requestRunCancel /
// resumeFailedRun, never fail any run, just reject the call.
const RESUME_INVALID_STATE = "RESUME_INVALID_STATE";
const CANCEL_INVALID_STATE = "CANCEL_INVALID_STATE";
const AUTOFLOW_RUN_ALREADY_ACTIVE = "AUTOFLOW_RUN_ALREADY_ACTIVE";

// Partial unique indexes added by
// 013_domain_run_single_active_guard.sql -- a raw 23505 on
// one of these, hit while creating a domain run, is
// reclassified as DOMAIN_RUN_CONFLICT rather than leaking as
// an unhandled exception.
const SINGLE_ACTIVE_INDEX_NAMES = new Set([
  "idx_scanner_runs_single_active",
  "idx_country_news_runs_single_active",
  "idx_person_radar_runs_single_active",
  "idx_fusion_runs_single_active"
]);

// =========================================================
// VIRTUAL STEP OUTPUT MAPPING
// =========================================================

const VIRTUAL_STEP_SUMMARY_SCHEMA_VERSION = 1;

const VIRTUAL_STEP_FIELD_MAP = {
  VEHICLE_RESOLVER: {
    sourceStep: "SCANNER",
    fields: [
      "entity_resolved_count",
      "entity_brand_only_count",
      "entity_ambiguous_count",
      "entity_unresolved_count",
      "country_resolved_count",
      "vehicle_record_linked_count"
    ]
  },
  HISTORICAL_RESONANCE: {
    sourceStep: "PERSON_RADAR",
    fields: [
      "resonance_scored_count",
      "resonance_unscored_count"
    ]
  }
};

function deriveVirtualStepOutput(stepKey, parentSummary) {
  const map = VIRTUAL_STEP_FIELD_MAP[stepKey];

  if (!map) {
    throw new Error(
      `deriveVirtualStepOutput called for non-virtual step_key ${stepKey}.`
    );
  }

  const summary = parentSummary || {};
  const missingFields = [];
  const values = {};

  for (const field of map.fields) {
    if (Object.prototype.hasOwnProperty.call(summary, field)) {
      values[field] = summary[field];
    } else {
      missingFields.push(field);
    }
  }

  return {
    summary_schema_version: VIRTUAL_STEP_SUMMARY_SCHEMA_VERSION,
    source_step: map.sourceStep,
    missing_fields: missingFields,
    ...values
  };
}

// =========================================================
// DEFAULT DOMAIN ADAPTERS
//
// Every adapter fn only ever receives a transaction client
// (never the raw pool) and returns the domain's own
// {statusCode, payload} envelope unchanged. All four existing
// createXRun/getXRun functions call pool.query(...) only --
// never pool.connect() -- so a PoolClient is a drop-in
// substitute for the pool argument they expect.
// =========================================================

const DEFAULT_DOMAIN_ADAPTERS = {
  SCANNER: {
    table: "scanner_runs",
    createRun: client => createScannerRun(client, {}),
    getRun: (client, id) => getScannerRun(client, id)
  },
  COUNTRY_NEWS_RADAR: {
    table: "country_news_runs",
    createRun: client => createCountryNewsRun(client, {}),
    getRun: (client, id) => getCountryNewsRun(client, id)
  },
  PERSON_RADAR: {
    table: "person_radar_runs",
    createRun: client => createPersonRadarRun(client, {}),
    getRun: (client, id) => getPersonRadarRun(client, id)
  },
  FUSION: {
    table: "fusion_runs",
    createRun: client => createFusionRun(client, {}),
    getRun: (client, id) => getFusionRun(client, id)
  }
};

// =========================================================
// ADAPTER RESPONSE CLASSIFICATION
// =========================================================

function unwrapDomainResponse(result) {
  // createPersonRadarRun's validation-error path nests the
  // envelope under `.error`; every other path (all four
  // domains) is already flat {statusCode, payload}.
  const envelope = result && result.error ? result.error : result;

  if (!envelope || typeof envelope.statusCode !== "number") {
    return { statusCode: null, payload: null };
  }

  return {
    statusCode: envelope.statusCode,
    payload: envelope.payload
  };
}

function classifyCreateRunResponse(result) {
  const { statusCode, payload } = unwrapDomainResponse(result);

  if (statusCode === 202) {
    const id = payload && payload.data && payload.data.id;

    if (id === undefined || id === null) {
      return {
        outcome: "ERROR",
        code: AUTOFLOW_ERROR_CODES.UNEXPECTED_ADAPTER_RESPONSE,
        message: "createRun returned 202 without payload.data.id."
      };
    }

    return { outcome: "SUCCESS", domainRunId: id };
  }

  if (statusCode === 409) {
    return {
      outcome: "ERROR",
      code: AUTOFLOW_ERROR_CODES.DOMAIN_RUN_CONFLICT,
      message:
        (payload && payload.message) ||
        "Domain run already active."
    };
  }

  if (statusCode === 400 || statusCode === 422) {
    return {
      outcome: "ERROR",
      code: AUTOFLOW_ERROR_CODES.DOMAIN_RUN_CREATE_REJECTED,
      message:
        (payload && payload.message) ||
        "Domain run creation was rejected."
    };
  }

  if (
    typeof statusCode === "number" &&
    statusCode >= 500 &&
    statusCode < 600
  ) {
    const error = new Error(
      (payload && payload.message) ||
        "Domain create returned a transient server error."
    );
    error.transient = true;
    throw error;
  }

  return {
    outcome: "ERROR",
    code: AUTOFLOW_ERROR_CODES.UNEXPECTED_ADAPTER_RESPONSE,
    message: `createRun returned unexpected statusCode ${statusCode}.`
  };
}

function classifyGetRunResponse(result) {
  const { statusCode, payload } = unwrapDomainResponse(result);

  if (statusCode === 200) {
    const data = payload && payload.data;
    const domainStatus = data && data.status;

    if (!domainStatus) {
      return {
        outcome: "ERROR",
        code: AUTOFLOW_ERROR_CODES.UNEXPECTED_ADAPTER_RESPONSE,
        message: "getRun returned 200 without payload.data.status."
      };
    }

    return {
      outcome: "SUCCESS",
      domainStatus,
      summary: (data && data.summary) || {},
      errorMessage: (data && data.error_message) || null
    };
  }

  if (statusCode === 404) {
    return {
      outcome: "ERROR",
      code: AUTOFLOW_ERROR_CODES.DOMAIN_RUN_NOT_FOUND,
      message:
        (payload && payload.message) || "Domain run not found."
    };
  }

  if (
    typeof statusCode === "number" &&
    statusCode >= 500 &&
    statusCode < 600
  ) {
    const error = new Error(
      (payload && payload.message) ||
        "Domain getRun returned a transient server error."
    );
    error.transient = true;
    throw error;
  }

  return {
    outcome: "ERROR",
    code: AUTOFLOW_ERROR_CODES.UNEXPECTED_ADAPTER_RESPONSE,
    message: `getRun returned unexpected statusCode ${statusCode}.`
  };
}

// A raw 23505 from adapter.createRun() aborts the current
// PostgreSQL transaction block until a ROLLBACK TO SAVEPOINT is
// issued -- without this savepoint, the subsequent
// failStepAndRun() UPDATE/INSERT statements would themselves be
// rejected ("current transaction is aborted"), silently losing
// the STEP_FAILED/RUN_FAILED transition. The savepoint isolates
// just the createRun attempt so the rest of this tick's
// transaction can still commit normally.
async function invokeCreateRun(adapter, client) {
  await client.query("SAVEPOINT autoflow_domain_create");

  try {
    const result = await adapter.createRun(client);
    await client.query("RELEASE SAVEPOINT autoflow_domain_create");
    return classifyCreateRunResponse(result);
  } catch (error) {
    if (
      error &&
      error.code === "23505" &&
      SINGLE_ACTIVE_INDEX_NAMES.has(error.constraint)
    ) {
      await client.query("ROLLBACK TO SAVEPOINT autoflow_domain_create");
      await client.query("RELEASE SAVEPOINT autoflow_domain_create");

      return {
        outcome: "ERROR",
        code: AUTOFLOW_ERROR_CODES.DOMAIN_RUN_CONFLICT,
        message: `Domain run creation violated ${error.constraint}.`
      };
    }

    // Any other exception (including classifyCreateRunResponse's own
    // 5xx throw) is not swallowed here: the savepoint is left
    // un-released/un-rolled-back and the entire outer transaction
    // is rolled back by the caller, which discards it along with
    // everything else.
    throw error;
  }
}

async function invokeGetRun(adapter, client, domainRunId) {
  const result = await adapter.getRun(client, domainRunId);
  return classifyGetRunResponse(result);
}

// =========================================================
// SEED / SUMMARY / INVARIANT HELPERS
// =========================================================

async function seedRunSteps(client, runId) {
  for (const stepKey of AUTOFLOW_STEP_ORDER) {
    const def = STEP_DEFINITIONS[stepKey];

    await client.query(
      `
        INSERT INTO autoflow_run_steps (
          run_id, step_key, step_order, is_orchestrated,
          parent_step_key, domain_run_table
        )
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
      [
        runId,
        stepKey,
        def.order,
        def.isOrchestrated,
        def.parentStepKey,
        def.domainRunTable
      ]
    );
  }
}

function buildAutoFlowRunSummary(steps) {
  const stepStatuses = {};
  const stepOutputs = {};

  for (const step of steps) {
    stepStatuses[step.step_key] = step.status;
    stepOutputs[step.step_key] = step.output_summary || {};
  }

  return {
    summary_schema_version: 1,
    step_statuses: stepStatuses,
    step_outputs: stepOutputs
  };
}

function validateStepSet(steps, currentStep) {
  if (!Array.isArray(steps) || steps.length !== AUTOFLOW_STEP_ORDER.length) {
    return {
      valid: false,
      message: `Expected ${AUTOFLOW_STEP_ORDER.length} step rows, found ${steps ? steps.length : 0}.`
    };
  }

  const byKey = new Map(steps.map(row => [row.step_key, row]));

  for (const stepKey of AUTOFLOW_STEP_ORDER) {
    const def = STEP_DEFINITIONS[stepKey];
    const row = byKey.get(stepKey);

    if (!row) {
      return { valid: false, message: `Missing step row for ${stepKey}.` };
    }

    if (Number(row.step_order) !== def.order) {
      return {
        valid: false,
        message: `step_order mismatch for ${stepKey}: expected ${def.order}, found ${row.step_order}.`
      };
    }

    if (Boolean(row.is_orchestrated) !== def.isOrchestrated) {
      return {
        valid: false,
        message: `is_orchestrated mismatch for ${stepKey}.`
      };
    }

    if ((row.parent_step_key || null) !== def.parentStepKey) {
      return {
        valid: false,
        message: `parent_step_key mismatch for ${stepKey}: expected ${def.parentStepKey}, found ${row.parent_step_key}.`
      };
    }
  }

  if (!currentStep || !ORCHESTRATED_STEPS.includes(currentStep)) {
    return {
      valid: false,
      message: `current_step '${currentStep}' is not a valid orchestrated step.`
    };
  }

  return { valid: true, byKey };
}

async function writeEvent(client, runId, stepKey, eventType, message, payload) {
  await client.query(
    `
      INSERT INTO autoflow_run_events (
        run_id, step_key, event_type, message, payload
      )
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [runId, stepKey, eventType, message || null, JSON.stringify(payload || {})]
  );
}

async function refreshRunSummary(client, runId) {
  const result = await client.query(
    `SELECT * FROM autoflow_run_steps WHERE run_id = $1 ORDER BY step_order`,
    [runId]
  );

  await client.query(
    `UPDATE autoflow_runs SET summary = $1::jsonb WHERE id = $2`,
    [JSON.stringify(buildAutoFlowRunSummary(result.rows)), runId]
  );

  return result.rows;
}

// =========================================================
// TERMINAL / FAILURE HELPERS
// =========================================================

async function failRun(client, run, { code, message, failureStep, now }) {
  const timestamp = now();

  await client.query(
    `
      UPDATE autoflow_runs
      SET status = 'FAILED', failure_step = $1, error_message = $2,
        completed_at = $3, updated_at = $3
      WHERE id = $4
    `,
    [failureStep || null, `${code}: ${message}`.slice(0, 2000), timestamp, run.id]
  );

  await writeEvent(
    client,
    run.id,
    failureStep || null,
    AUTOFLOW_EVENT_TYPES.RUN_FAILED,
    null,
    { failure_step: failureStep || null, code, message }
  );

  // Best-effort: failRun is only used when there is no single step
  // row that is safe to update (full step-set corruption, or
  // current_step pointing at an already-terminal row that must not
  // be overwritten). Whatever step rows genuinely exist are still
  // real DB state worth reflecting in summary -- but rebuilding it
  // must never block the FAILED transition already committed above.
  try {
    await refreshRunSummary(client, run.id);
  } catch {
    // Ignore: summary refresh is best-effort here.
  }

  return { outcome: "RUN_FAILED", runId: run.id, failureStep: failureStep || null, code };
}

async function failStepAndRun(client, run, step, { code, message, now }) {
  const timestamp = now();

  await client.query(
    `
      UPDATE autoflow_run_steps
      SET status = 'FAILED', error_message = $1, completed_at = $2, updated_at = $2
      WHERE id = $3
    `,
    [String(message).slice(0, 2000), timestamp, step.id]
  );

  await writeEvent(
    client,
    run.id,
    step.step_key,
    AUTOFLOW_EVENT_TYPES.STEP_FAILED,
    null,
    { code, message }
  );

  const virtualChildKey = VIRTUAL_CHILD_OF[step.step_key];

  if (virtualChildKey) {
    const virtualResult = await client.query(
      `SELECT id, status FROM autoflow_run_steps WHERE run_id = $1 AND step_key = $2 FOR UPDATE`,
      [run.id, virtualChildKey]
    );
    const virtualRow = virtualResult.rows[0];

    if (virtualRow && virtualRow.status !== "COMPLETED") {
      const cascadeMessage = `Parent step ${step.step_key} failed.`;

      await client.query(
        `
          UPDATE autoflow_run_steps
          SET status = 'FAILED', error_message = $1, completed_at = $2, updated_at = $2
          WHERE id = $3
        `,
        [cascadeMessage, timestamp, virtualRow.id]
      );

      await writeEvent(
        client,
        run.id,
        virtualChildKey,
        AUTOFLOW_EVENT_TYPES.STEP_FAILED,
        null,
        { code, message: cascadeMessage }
      );
    }
  }

  await client.query(
    `
      UPDATE autoflow_runs
      SET status = 'FAILED', current_step = $1, failure_step = $1,
        error_message = $2, completed_at = $3, updated_at = $3
      WHERE id = $4
    `,
    [step.step_key, `${code}: ${message}`.slice(0, 2000), timestamp, run.id]
  );

  await writeEvent(
    client,
    run.id,
    null,
    AUTOFLOW_EVENT_TYPES.RUN_FAILED,
    null,
    { failure_step: step.step_key, code, message }
  );

  await refreshRunSummary(client, run.id);

  return { outcome: "RUN_FAILED", runId: run.id, failureStep: step.step_key, code };
}

async function finalizeCancellation(client, run, steps, { now }) {
  const timestamp = now();

  const pendingSteps = steps
    .filter(step => step.status === "PENDING")
    .sort((a, b) => a.step_order - b.step_order);

  for (const step of pendingSteps) {
    await client.query(
      `UPDATE autoflow_run_steps SET status = 'SKIPPED', updated_at = $1 WHERE id = $2`,
      [timestamp, step.id]
    );
    await writeEvent(
      client,
      run.id,
      step.step_key,
      AUTOFLOW_EVENT_TYPES.STEP_SKIPPED,
      null,
      {}
    );
  }

  await client.query(
    `UPDATE autoflow_runs SET status = 'CANCELLED', completed_at = $1, updated_at = $1 WHERE id = $2`,
    [timestamp, run.id]
  );

  await writeEvent(client, run.id, null, AUTOFLOW_EVENT_TYPES.RUN_CANCELLED, null, {});

  await refreshRunSummary(client, run.id);

  return { outcome: "RUN_CANCELLED", runId: run.id };
}

// =========================================================
// STEP ADVANCEMENT
// =========================================================

async function advancePendingStep(client, run, step, { adapters, now }) {
  if (step.domain_run_id !== null) {
    // The step row itself is known and safe to update -- fail it
    // (and its virtual child) directly rather than only the run,
    // so the inconsistency is visible at the step level too.
    return failStepAndRun(client, run, step, {
      code: AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION,
      message: `Step ${step.step_key} is PENDING but domain_run_id is not NULL.`,
      now
    });
  }

  const adapter = adapters[step.step_key];
  const outcome = await invokeCreateRun(adapter, client);

  if (outcome.outcome === "ERROR") {
    return failStepAndRun(client, run, step, {
      code: outcome.code,
      message: outcome.message,
      now
    });
  }

  const timestamp = now();

  await client.query(
    `
      UPDATE autoflow_run_steps
      SET status = 'QUEUED', domain_run_id = $1, started_at = $2, updated_at = $2
      WHERE id = $3
    `,
    [outcome.domainRunId, timestamp, step.id]
  );

  await writeEvent(
    client,
    run.id,
    step.step_key,
    AUTOFLOW_EVENT_TYPES.STEP_STARTED,
    null,
    {
      domain_run_table: step.domain_run_table,
      domain_run_id: String(outcome.domainRunId)
    }
  );

  await refreshRunSummary(client, run.id);

  return { outcome: "STEP_STARTED", runId: run.id, stepKey: step.step_key };
}

async function startNextOrchestratedStep(client, run, nextStep, { adapters, now }) {
  const adapter = adapters[nextStep.step_key];
  const outcome = await invokeCreateRun(adapter, client);

  if (outcome.outcome === "ERROR") {
    // failure_step must point at the NEXT step, never the one
    // that just completed successfully.
    return failStepAndRun(
      client,
      { ...run, current_step: nextStep.step_key },
      nextStep,
      { code: outcome.code, message: outcome.message, now }
    );
  }

  const timestamp = now();

  await client.query(
    `
      UPDATE autoflow_run_steps
      SET status = 'QUEUED', domain_run_id = $1, started_at = $2, updated_at = $2
      WHERE id = $3
    `,
    [outcome.domainRunId, timestamp, nextStep.id]
  );

  await writeEvent(
    client,
    run.id,
    nextStep.step_key,
    AUTOFLOW_EVENT_TYPES.STEP_STARTED,
    null,
    {
      domain_run_table: nextStep.domain_run_table,
      domain_run_id: String(outcome.domainRunId)
    }
  );

  await refreshRunSummary(client, run.id);

  return {
    outcome: "STEP_ADVANCED",
    runId: run.id,
    toStep: nextStep.step_key
  };
}

async function completeStep(client, run, step, stepsByKey, domainOutcome, { adapters, now }) {
  const timestamp = now();
  const summary = domainOutcome.summary || {};

  await client.query(
    `
      UPDATE autoflow_run_steps
      SET status = 'COMPLETED', output_summary = $1::jsonb, completed_at = $2, updated_at = $2
      WHERE id = $3
    `,
    [JSON.stringify(summary), timestamp, step.id]
  );

  await writeEvent(
    client,
    run.id,
    step.step_key,
    AUTOFLOW_EVENT_TYPES.STEP_COMPLETED,
    null,
    { output_summary: summary }
  );

  const virtualChildKey = VIRTUAL_CHILD_OF[step.step_key];

  if (virtualChildKey) {
    const virtualOutput = deriveVirtualStepOutput(virtualChildKey, summary);
    const virtualRow = stepsByKey.get(virtualChildKey);

    await client.query(
      `
        UPDATE autoflow_run_steps
        SET status = 'COMPLETED', output_summary = $1::jsonb, completed_at = $2, updated_at = $2
        WHERE id = $3
      `,
      [JSON.stringify(virtualOutput), timestamp, virtualRow.id]
    );

    await writeEvent(
      client,
      run.id,
      virtualChildKey,
      AUTOFLOW_EVENT_TYPES.STEP_COMPLETED,
      null,
      { output_summary: virtualOutput }
    );
  }

  await refreshRunSummary(client, run.id);

  const nextStepKey = NEXT_ORCHESTRATED_STEP[step.step_key];

  if (!nextStepKey) {
    await client.query(
      `UPDATE autoflow_runs SET status = 'COMPLETED', completed_at = $1, updated_at = $1 WHERE id = $2`,
      [timestamp, run.id]
    );
    await writeEvent(client, run.id, null, AUTOFLOW_EVENT_TYPES.RUN_COMPLETED, null, {});

    return { outcome: "RUN_COMPLETED", runId: run.id };
  }

  const refreshedSteps = await client.query(
    `SELECT * FROM autoflow_run_steps WHERE run_id = $1 ORDER BY step_order`,
    [run.id]
  );

  if (run.cancel_requested_at) {
    return finalizeCancellation(client, run, refreshedSteps.rows, { now });
  }

  await client.query(
    `UPDATE autoflow_runs SET current_step = $1, updated_at = $2 WHERE id = $3`,
    [nextStepKey, timestamp, run.id]
  );

  const nextStep = refreshedSteps.rows.find(row => row.step_key === nextStepKey);

  return startNextOrchestratedStep(client, run, nextStep, { adapters, now });
}

async function advanceInFlightStep(client, run, step, stepsByKey, { adapters, now }) {
  if (step.domain_run_id === null) {
    return failStepAndRun(client, run, step, {
      code: AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION,
      message: `Step ${step.step_key} is ${step.status} but domain_run_id is NULL.`,
      now
    });
  }

  const adapter = adapters[step.step_key];
  const outcome = await invokeGetRun(adapter, client, step.domain_run_id);

  if (outcome.outcome === "ERROR") {
    return failStepAndRun(client, run, step, {
      code: outcome.code,
      message: outcome.message,
      now
    });
  }

  const domainStatus = outcome.domainStatus;

  if (domainStatus === "QUEUED" || domainStatus === "RUNNING") {
    if (step.status !== domainStatus) {
      await client.query(
        `UPDATE autoflow_run_steps SET status = $1, updated_at = $2 WHERE id = $3`,
        [domainStatus, now(), step.id]
      );
      // A real transition happened (QUEUED -> RUNNING mirror), so
      // summary must reflect it in the same transaction. A no-op
      // repeat tick (status unchanged) updates neither summary nor
      // any event.
      await refreshRunSummary(client, run.id);
    }

    return { outcome: "NO_CHANGE", runId: run.id, stepKey: step.step_key, domainStatus };
  }

  if (domainStatus === "COMPLETED") {
    return completeStep(client, run, step, stepsByKey, outcome, { adapters, now });
  }

  if (domainStatus === "FAILED") {
    return failStepAndRun(client, run, step, {
      code: AUTOFLOW_ERROR_CODES.DOMAIN_RUN_FAILED,
      message: outcome.errorMessage || `Domain run for ${step.step_key} failed.`,
      now
    });
  }

  if (domainStatus === "CANCELLED") {
    return failStepAndRun(client, run, step, {
      code: AUTOFLOW_ERROR_CODES.DOMAIN_RUN_CANCELLED,
      message: outcome.errorMessage || `Domain run for ${step.step_key} was cancelled.`,
      now
    });
  }

  return failStepAndRun(client, run, step, {
    code: AUTOFLOW_ERROR_CODES.UNSUPPORTED_DOMAIN_RUN_STATUS,
    message: `Domain run for ${step.step_key} returned unsupported status ${domainStatus}.`,
    now
  });
}

// =========================================================
// TICK ENTRY POINT
// =========================================================

async function inspectAndAdvance(client, options = {}) {
  const {
    adapters = DEFAULT_DOMAIN_ADAPTERS,
    workerId = null,
    now = () => new Date()
  } = options;

  const runResult = await client.query(
    `
      SELECT id, status, current_step, cancel_requested_at
      FROM autoflow_runs
      WHERE status IN ('QUEUED', 'RUNNING')
      ORDER BY created_at ASC, id ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `
  );

  if (runResult.rowCount === 0) {
    return null;
  }

  const run = runResult.rows[0];

  const stepsResult = await client.query(
    `
      SELECT * FROM autoflow_run_steps
      WHERE run_id = $1
      ORDER BY step_order
      FOR UPDATE
    `,
    [run.id]
  );

  const validation = validateStepSet(stepsResult.rows, run.current_step);

  if (!validation.valid) {
    return failRun(client, run, {
      code: AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION,
      message: validation.message,
      failureStep: run.current_step || null,
      now
    });
  }

  const stepsByKey = validation.byKey;

  if (run.status === "QUEUED") {
    const timestamp = now();

    await client.query(
      `
        UPDATE autoflow_runs
        SET status = 'RUNNING', locked_by = $1, locked_at = $2, started_at = $2, updated_at = $2
        WHERE id = $3
      `,
      [workerId, timestamp, run.id]
    );

    await writeEvent(client, run.id, null, AUTOFLOW_EVENT_TYPES.RUN_STARTED, null, {});
  }

  const currentStep = stepsByKey.get(run.current_step);

  if (currentStep.status === "PENDING") {
    return advancePendingStep(client, run, currentStep, { adapters, now });
  }

  if (currentStep.status === "QUEUED" || currentStep.status === "RUNNING") {
    return advanceInFlightStep(client, run, currentStep, stepsByKey, { adapters, now });
  }

  return failRun(client, run, {
    code: AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION,
    message: `current_step ${run.current_step} points at a step row with terminal status ${currentStep.status}.`,
    failureStep: run.current_step,
    now
  });
}

async function processNextAutoFlowRun(pool, options = {}) {
  const {
    adapters = DEFAULT_DOMAIN_ADAPTERS,
    workerId = null,
    now = () => new Date()
  } = options;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await inspectAndAdvance(client, { adapters, workerId, now });

    await client.query("COMMIT");

    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failure.
    }

    throw error;
  } finally {
    client.release();
  }
}

// =========================================================
// CANCEL
// =========================================================

async function requestRunCancel(pool, runId, options = {}) {
  const { now = () => new Date() } = options;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const runResult = await client.query(
      `SELECT * FROM autoflow_runs WHERE id = $1 FOR UPDATE`,
      [runId]
    );

    if (runResult.rowCount === 0) {
      const error = new Error(`AutoFlow run ${runId} not found.`);
      error.autoflowCode = CANCEL_INVALID_STATE;
      throw error;
    }

    const run = runResult.rows[0];

    if (run.status !== "QUEUED" && run.status !== "RUNNING") {
      const error = new Error(
        `AutoFlow run ${runId} is not QUEUED or RUNNING (status=${run.status}).`
      );
      error.autoflowCode = CANCEL_INVALID_STATE;
      throw error;
    }

    const timestamp = now();

    if (run.status === "RUNNING") {
      if (run.cancel_requested_at) {
        await client.query("COMMIT");
        return { outcome: "ALREADY_REQUESTED", runId };
      }

      await client.query(
        `UPDATE autoflow_runs SET cancel_requested_at = $1, updated_at = $1 WHERE id = $2`,
        [timestamp, runId]
      );
      await writeEvent(client, runId, null, AUTOFLOW_EVENT_TYPES.RUN_CANCEL_REQUESTED, null, {});

      await client.query("COMMIT");
      return { outcome: "CANCEL_REQUESTED", runId };
    }

    // QUEUED: nothing has ever been created, so cancel takes
    // effect immediately and synchronously.
    const stepsResult = await client.query(
      `SELECT * FROM autoflow_run_steps WHERE run_id = $1 ORDER BY step_order FOR UPDATE`,
      [runId]
    );

    await client.query(
      `
        UPDATE autoflow_runs
        SET status = 'CANCELLED', cancel_requested_at = $1, completed_at = $1, updated_at = $1
        WHERE id = $2
      `,
      [timestamp, runId]
    );
    await writeEvent(client, runId, null, AUTOFLOW_EVENT_TYPES.RUN_CANCEL_REQUESTED, null, {});

    for (const step of stepsResult.rows) {
      if (step.status === "PENDING") {
        await client.query(
          `UPDATE autoflow_run_steps SET status = 'SKIPPED', updated_at = $1 WHERE id = $2`,
          [timestamp, step.id]
        );
        await writeEvent(
          client,
          runId,
          step.step_key,
          AUTOFLOW_EVENT_TYPES.STEP_SKIPPED,
          null,
          {}
        );
      }
    }

    await writeEvent(client, runId, null, AUTOFLOW_EVENT_TYPES.RUN_CANCELLED, null, {});

    await refreshRunSummary(client, runId);

    await client.query("COMMIT");
    return { outcome: "CANCELLED", runId };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failure.
    }

    throw error;
  } finally {
    client.release();
  }
}

// =========================================================
// RESUME
// =========================================================

async function resumeFailedRun(pool, runId, options = {}) {
  const { now = () => new Date() } = options;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const runResult = await client.query(
      `SELECT * FROM autoflow_runs WHERE id = $1 FOR UPDATE`,
      [runId]
    );

    if (runResult.rowCount === 0) {
      const error = new Error(`AutoFlow run ${runId} not found.`);
      error.autoflowCode = RESUME_INVALID_STATE;
      throw error;
    }

    const run = runResult.rows[0];

    if (run.status !== "FAILED") {
      const error = new Error(
        `AutoFlow run ${runId} is not FAILED (status=${run.status}).`
      );
      error.autoflowCode = RESUME_INVALID_STATE;
      throw error;
    }

    const activeResult = await client.query(
      `SELECT id FROM autoflow_runs WHERE status IN ('QUEUED', 'RUNNING') AND id != $1 FOR UPDATE`,
      [runId]
    );

    if (activeResult.rowCount > 0) {
      const error = new Error(
        `Another AutoFlow run (${activeResult.rows[0].id}) is already active.`
      );
      error.autoflowCode = AUTOFLOW_RUN_ALREADY_ACTIVE;
      throw error;
    }

    const failureStep = run.failure_step;

    if (!failureStep || !ORCHESTRATED_STEPS.includes(failureStep)) {
      const error = new Error(
        `AutoFlow run ${runId} has no resumable failure_step (found: ${failureStep}).`
      );
      error.autoflowCode = AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION;
      throw error;
    }

    const stepResult = await client.query(
      `SELECT * FROM autoflow_run_steps WHERE run_id = $1 AND step_key = $2 FOR UPDATE`,
      [runId, failureStep]
    );

    if (stepResult.rowCount === 0) {
      const error = new Error(`Step row ${failureStep} not found for run ${runId}.`);
      error.autoflowCode = AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION;
      throw error;
    }

    const failedStepRow = stepResult.rows[0];
    const previousDomainRunId = failedStepRow.domain_run_id;
    const previousErrorMessage = failedStepRow.error_message;

    const attemptResult = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM autoflow_run_events
        WHERE run_id = $1 AND step_key = $2 AND event_type = $3
      `,
      [runId, failureStep, AUTOFLOW_EVENT_TYPES.RUN_RESUMED]
    );
    const attemptNumber = attemptResult.rows[0].count + 2;

    const timestamp = now();

    await client.query(
      `
        UPDATE autoflow_run_steps
        SET status = 'PENDING', domain_run_id = NULL, output_summary = '{}'::jsonb,
          error_message = NULL, started_at = NULL, completed_at = NULL, updated_at = $1
        WHERE id = $2
      `,
      [timestamp, failedStepRow.id]
    );

    const virtualChildKey = VIRTUAL_CHILD_OF[failureStep];

    if (virtualChildKey) {
      await client.query(
        `
          UPDATE autoflow_run_steps
          SET status = 'PENDING', output_summary = '{}'::jsonb, error_message = NULL,
            started_at = NULL, completed_at = NULL, updated_at = $1
          WHERE run_id = $2 AND step_key = $3
        `,
        [timestamp, runId, virtualChildKey]
      );
    }

    try {
      await client.query(
        `
          UPDATE autoflow_runs
          SET status = 'RUNNING', current_step = $1, failure_step = NULL,
            error_message = NULL, cancel_requested_at = NULL, locked_by = NULL,
            locked_at = NULL, updated_at = $2
          WHERE id = $3
        `,
        [failureStep, timestamp, runId]
      );
    } catch (updateError) {
      if (
        updateError &&
        updateError.code === "23505" &&
        updateError.constraint === "idx_autoflow_runs_single_active"
      ) {
        const wrapped = new Error(
          "Another AutoFlow run became active during resume."
        );
        wrapped.autoflowCode = AUTOFLOW_RUN_ALREADY_ACTIVE;
        throw wrapped;
      }

      throw updateError;
    }

    await writeEvent(
      client,
      runId,
      failureStep,
      AUTOFLOW_EVENT_TYPES.RUN_RESUMED,
      null,
      {
        previous_domain_run_id:
          previousDomainRunId !== null && previousDomainRunId !== undefined
            ? String(previousDomainRunId)
            : null,
        previous_error_message: previousErrorMessage,
        resumed_step: failureStep,
        attempt_number: attemptNumber
      }
    );

    await refreshRunSummary(client, runId);

    await client.query("COMMIT");

    return { outcome: "RESUMED", runId, resumedStep: failureStep, attemptNumber };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failure.
    }

    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  AUTOFLOW_STEP_ORDER,
  ORCHESTRATED_STEPS,
  VIRTUAL_STEPS,
  STEP_DEFINITIONS,
  VIRTUAL_CHILD_OF,
  NEXT_ORCHESTRATED_STEP,
  AUTOFLOW_EVENT_TYPES,
  AUTOFLOW_ERROR_CODES,
  RESUME_INVALID_STATE,
  CANCEL_INVALID_STATE,
  AUTOFLOW_RUN_ALREADY_ACTIVE,
  SINGLE_ACTIVE_INDEX_NAMES,
  VIRTUAL_STEP_SUMMARY_SCHEMA_VERSION,
  DEFAULT_DOMAIN_ADAPTERS,

  unwrapDomainResponse,
  classifyCreateRunResponse,
  classifyGetRunResponse,
  deriveVirtualStepOutput,
  buildAutoFlowRunSummary,
  validateStepSet,
  seedRunSteps,

  inspectAndAdvance,
  processNextAutoFlowRun,
  requestRunCancel,
  resumeFailedRun
};

// =========================================================
// AUTOFLOW API — Task 3.3G.3
//
// Route handlers for creating, reading, cancelling, and
// resuming AutoFlow runs. This module never re-implements
// orchestration: creation seeds the fixed six-step run via
// engine.seedRunSteps, and cancel/resume delegate entirely to
// engine.requestRunCancel / engine.resumeFailedRun. Advancing
// a run (calling into the four domains) is worker territory
// (3.3G.4), not this API.
// =========================================================

const {
  AUTOFLOW_STEP_ORDER,
  AUTOFLOW_ERROR_CODES,
  CANCEL_INVALID_STATE,
  RESUME_INVALID_STATE,
  AUTOFLOW_RUN_ALREADY_ACTIVE,
  seedRunSteps,
  requestRunCancel,
  resumeFailedRun
} = require("./engine");

const IDEMPOTENCY_KEY_MAX_LENGTH = 200;

const RUN_SINGLE_ACTIVE_CONSTRAINT = "idx_autoflow_runs_single_active";
const RUN_IDEMPOTENCY_KEY_CONSTRAINT = "idx_autoflow_runs_idempotency_key";

const AUTOFLOW_RUN_STATUSES = new Set([
  "QUEUED",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED"
]);

// Engine-thrown request-rejection codes -> HTTP status. Every
// code here is a normal rejected-call outcome (never a raw,
// unclassified DB/infra error), so it is safe to translate
// directly into a 409 instead of letting it fall through to a
// generic 500.
const ACTION_ERROR_STATUS = {
  [CANCEL_INVALID_STATE]: 409,
  [RESUME_INVALID_STATE]: 409,
  [AUTOFLOW_RUN_ALREADY_ACTIVE]: 409,
  [AUTOFLOW_ERROR_CODES.AUTOFLOW_DATA_INVARIANT_VIOLATION]: 409
};

// =========================================================
// RESPONSE / VALIDATION HELPERS
// =========================================================

function response(statusCode, payload) {
  return { statusCode, payload };
}

function badRequest(message, details = {}) {
  return response(400, {
    error: "VALIDATION_ERROR",
    message,
    ...details
  });
}

function validateAutoFlowRunPayload(body) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    return { error: "Request body must be a JSON object." };
  }

  return { value: body };
}

function validateIdempotencyKey(raw) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }

  if (typeof raw !== "string") {
    return { error: "Idempotency-Key must be a string." };
  }

  const trimmed = raw.trim();

  if (trimmed === "") {
    return { value: null };
  }

  if (trimmed.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return {
      error:
        `Idempotency-Key must be at most ${IDEMPOTENCY_KEY_MAX_LENGTH} characters.`
    };
  }

  return { value: trimmed };
}

function parseIntegerParameter(
  value,
  { fieldName, minimum, maximum, fallback }
) {
  if (value === null || value === undefined || value === "") {
    return { value: fallback };
  }

  const parsed = Number(value);

  if (
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    return {
      error:
        `${fieldName} must be an integer from ${minimum} to ${maximum}.`
    };
  }

  return { value: parsed };
}

// =========================================================
// SERIALIZATION
//
// BIGINT columns are stringified explicitly rather than
// relying on driver defaults, and locked_by/locked_at (worker
// lock internals) are never exposed to API clients.
// =========================================================

const RUN_COLUMNS = `
  id, status, current_step, trigger_type,
  request_payload, summary, failure_step, error_message,
  cancel_requested_at, started_at, completed_at,
  created_at, updated_at, idempotency_key, requested_by
`;

function serializeRun(row) {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    status: row.status,
    current_step: row.current_step,
    trigger_type: row.trigger_type,
    request_payload: row.request_payload,
    summary: row.summary,
    failure_step: row.failure_step,
    error_message: row.error_message,
    cancel_requested_at: row.cancel_requested_at,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    idempotency_key: row.idempotency_key,
    requested_by: row.requested_by
  };
}

function serializeStep(row) {
  return {
    id: String(row.id),
    step_key: row.step_key,
    step_order: row.step_order,
    is_orchestrated: row.is_orchestrated,
    parent_step_key: row.parent_step_key,
    domain_run_table: row.domain_run_table,
    domain_run_id:
      row.domain_run_id === null || row.domain_run_id === undefined
        ? null
        : String(row.domain_run_id),
    status: row.status,
    input_snapshot: row.input_snapshot,
    output_summary: row.output_summary,
    error_message: row.error_message,
    started_at: row.started_at,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function serializeEvent(row) {
  return {
    id: String(row.id),
    step_key: row.step_key,
    event_type: row.event_type,
    message: row.message,
    payload: row.payload,
    created_at: row.created_at
  };
}

async function fetchRunRow(pool, runId) {
  const result = await pool.query(
    `SELECT ${RUN_COLUMNS} FROM autoflow_runs WHERE id = $1`,
    [runId]
  );

  return result.rows[0] || null;
}

async function fetchRunByIdempotencyKey(client, idempotencyKey) {
  const result = await client.query(
    `SELECT ${RUN_COLUMNS} FROM autoflow_runs WHERE idempotency_key = $1`,
    [idempotencyKey]
  );

  return result.rows[0] || null;
}

function replayResponse(row) {
  return response(200, {
    data: serializeRun(row),
    replayed: true,
    message: "AutoFlow run already exists for this idempotency key."
  });
}

// =========================================================
// POST /api/autoflow/runs
// =========================================================

async function createAutoFlowRun(pool, body, context = {}) {
  const bodyValidation = validateAutoFlowRunPayload(body);

  if (bodyValidation.error) {
    return badRequest(bodyValidation.error);
  }

  const idempotencyValidation = validateIdempotencyKey(
    context.idempotencyKey
  );

  if (idempotencyValidation.error) {
    return badRequest(idempotencyValidation.error);
  }

  const idempotencyKey = idempotencyValidation.value;
  const requestedBy = context.requestedBy || null;
  const requestPayload = bodyValidation.value;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (idempotencyKey) {
      const existing = await fetchRunByIdempotencyKey(
        client,
        idempotencyKey
      );

      if (existing) {
        await client.query("COMMIT");
        return replayResponse(existing);
      }
    }

    const activeResult = await client.query(
      `
        SELECT id, status, created_at, started_at
        FROM autoflow_runs
        WHERE status IN ('QUEUED', 'RUNNING')
        ORDER BY created_at ASC, id ASC
        LIMIT 1
      `
    );

    if (activeResult.rowCount > 0) {
      await client.query("ROLLBACK");
      return response(409, {
        error: "AUTOFLOW_RUN_ALREADY_ACTIVE",
        message: "An AutoFlow run is already queued or running.",
        active_run: activeResult.rows[0]
      });
    }

    let insertResult;

    try {
      insertResult = await client.query(
        `
          INSERT INTO autoflow_runs (
            status, current_step, trigger_type,
            request_payload, idempotency_key, requested_by
          )
          VALUES (
            'QUEUED', 'SCANNER', 'MANUAL',
            $1::jsonb, $2, $3
          )
          RETURNING ${RUN_COLUMNS}
        `,
        [JSON.stringify(requestPayload), idempotencyKey, requestedBy]
      );
    } catch (error) {
      if (
        error &&
        error.code === "23505" &&
        error.constraint === RUN_SINGLE_ACTIVE_CONSTRAINT
      ) {
        await client.query("ROLLBACK");
        return response(409, {
          error: "AUTOFLOW_RUN_ALREADY_ACTIVE",
          message: "An AutoFlow run is already queued or running."
        });
      }

      if (
        error &&
        error.code === "23505" &&
        error.constraint === RUN_IDEMPOTENCY_KEY_CONSTRAINT
      ) {
        await client.query("ROLLBACK");
        const existing = await fetchRunByIdempotencyKey(
          client,
          idempotencyKey
        );
        return replayResponse(existing);
      }

      throw error;
    }

    const run = insertResult.rows[0];

    await seedRunSteps(client, run.id);

    const stepCountResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM autoflow_run_steps WHERE run_id = $1`,
      [run.id]
    );

    if (stepCountResult.rows[0].count !== AUTOFLOW_STEP_ORDER.length) {
      throw new Error(
        `Expected ${AUTOFLOW_STEP_ORDER.length} step rows for AutoFlow run ${run.id}, found ${stepCountResult.rows[0].count}.`
      );
    }

    await client.query("COMMIT");

    return response(202, {
      data: serializeRun(run),
      message: "AutoFlow run queued successfully."
    });
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
// GET /api/autoflow/runs/:id
// =========================================================

async function getAutoFlowRun(pool, runId) {
  const run = await fetchRunRow(pool, runId);

  if (!run) {
    return response(404, {
      error: "AUTOFLOW_RUN_NOT_FOUND",
      message: `AutoFlow run ${runId} was not found.`
    });
  }

  const stepsResult = await pool.query(
    `
      SELECT id, run_id, step_key, step_order, is_orchestrated,
        parent_step_key, domain_run_table, domain_run_id, status,
        input_snapshot, output_summary, error_message,
        started_at, completed_at, created_at, updated_at
      FROM autoflow_run_steps
      WHERE run_id = $1
      ORDER BY step_order ASC
    `,
    [runId]
  );

  const eventsResult = await pool.query(
    `
      SELECT id, run_id, step_key, event_type, message, payload, created_at
      FROM autoflow_run_events
      WHERE run_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [runId]
  );

  return response(200, {
    data: {
      ...serializeRun(run),
      steps: stepsResult.rows.map(serializeStep),
      events: eventsResult.rows.map(serializeEvent)
    }
  });
}

// =========================================================
// GET /api/autoflow/runs
// =========================================================

async function listAutoFlowRuns(pool, searchParams) {
  const limitResult = parseIntegerParameter(
    searchParams.get("limit"),
    {
      fieldName: "limit",
      minimum: 1,
      maximum: 100,
      fallback: 20
    }
  );

  if (limitResult.error) {
    return badRequest(limitResult.error);
  }

  const rawStatus = searchParams.get("status");
  let status = null;

  if (rawStatus !== null && rawStatus !== "") {
    status = rawStatus.toUpperCase();

    if (!AUTOFLOW_RUN_STATUSES.has(status)) {
      return badRequest(
        "status must be QUEUED, RUNNING, COMPLETED, FAILED, or CANCELLED."
      );
    }
  }

  const values = [];
  const conditions = [];

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  values.push(limitResult.value);
  const limitIndex = values.length;

  const result = await pool.query(
    `
      SELECT ${RUN_COLUMNS}, COUNT(*) OVER() AS total_count
      FROM autoflow_runs
      ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitIndex}
    `,
    values
  );

  const totalCount =
    result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

  const runs = result.rows.map(row => {
    const { total_count, ...rest } = row;
    return rest;
  });

  const stepsByRun = new Map();

  if (runs.length > 0) {
    const stepsResult = await pool.query(
      `
        SELECT run_id, step_key, step_order, status
        FROM autoflow_run_steps
        WHERE run_id = ANY($1::bigint[])
        ORDER BY run_id ASC, step_order ASC
      `,
      [runs.map(row => row.id)]
    );

    for (const stepRow of stepsResult.rows) {
      const key = String(stepRow.run_id);

      if (!stepsByRun.has(key)) {
        stepsByRun.set(key, []);
      }

      stepsByRun.get(key).push({
        step_key: stepRow.step_key,
        step_order: stepRow.step_order,
        status: stepRow.status
      });
    }
  }

  const data = runs.map(row => ({
    ...serializeRun(row),
    steps: stepsByRun.get(String(row.id)) || []
  }));

  return response(200, {
    data,
    count: data.length,
    total_count: totalCount,
    filters: {
      status,
      limit: limitResult.value
    }
  });
}

// =========================================================
// POST /api/autoflow/runs/:id/cancel
// POST /api/autoflow/runs/:id/resume
//
// Both delegate the actual state transition entirely to the
// engine -- this layer only checks existence up front (for a
// clean 404) and translates the engine's thrown
// request-rejection codes into HTTP responses.
// =========================================================

function mapActionError(error) {
  if (
    error &&
    error.autoflowCode &&
    Object.prototype.hasOwnProperty.call(
      ACTION_ERROR_STATUS,
      error.autoflowCode
    )
  ) {
    return response(ACTION_ERROR_STATUS[error.autoflowCode], {
      error: error.autoflowCode,
      message: error.message
    });
  }

  return null;
}

async function cancelAutoFlowRun(pool, runId) {
  const existing = await pool.query(
    `SELECT id FROM autoflow_runs WHERE id = $1`,
    [runId]
  );

  if (existing.rowCount === 0) {
    return response(404, {
      error: "AUTOFLOW_RUN_NOT_FOUND",
      message: `AutoFlow run ${runId} was not found.`
    });
  }

  let outcome;

  try {
    outcome = await requestRunCancel(pool, runId);
  } catch (error) {
    const mapped = mapActionError(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }

  const run = await fetchRunRow(pool, runId);

  if (outcome.outcome === "CANCELLED") {
    return response(200, {
      data: serializeRun(run),
      message: "AutoFlow run cancelled."
    });
  }

  if (outcome.outcome === "CANCEL_REQUESTED") {
    return response(202, {
      data: serializeRun(run),
      message: "AutoFlow run cancellation requested."
    });
  }

  // ALREADY_REQUESTED: RUNNING run, cancel already pending.
  return response(200, {
    data: serializeRun(run),
    already_requested: true,
    message: "AutoFlow run cancellation was already requested."
  });
}

async function resumeAutoFlowRun(pool, runId) {
  const existing = await pool.query(
    `SELECT id FROM autoflow_runs WHERE id = $1`,
    [runId]
  );

  if (existing.rowCount === 0) {
    return response(404, {
      error: "AUTOFLOW_RUN_NOT_FOUND",
      message: `AutoFlow run ${runId} was not found.`
    });
  }

  try {
    await resumeFailedRun(pool, runId);
  } catch (error) {
    const mapped = mapActionError(error);
    if (mapped) {
      return mapped;
    }
    throw error;
  }

  const run = await fetchRunRow(pool, runId);

  return response(202, {
    data: serializeRun(run),
    message: "AutoFlow run resumed."
  });
}

module.exports = {
  createAutoFlowRun,
  getAutoFlowRun,
  listAutoFlowRuns,
  cancelAutoFlowRun,
  resumeAutoFlowRun
};

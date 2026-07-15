// =========================================================
// STORY PIPELINE API — Task 3.4E
//
// Route handlers for the Story/Outline/Script Pipeline. Every
// state transition is delegated to lib/story/engine.js -- this
// module only validates request shape, maps engine.StoryError
// to HTTP responses, and serializes rows for API consumers
// (never exposing worker_id/lease internals as secrets, though
// they are informational here, not credentials -- and never
// exposing any provider API key or raw Authorization header).
// =========================================================

const { CanonError } = require("./canon");
const { INTEGRATED_STORY_DIRECTION_TYPE } = require("./schemas");

const {
  StoryError,
  createStoryRun,
  approveCandidate,
  selectDirection,
  lockOutline,
  lockScript,
  regenerateStage,
  cancelRun,
  resumeRun,
  fetchRun,
  STORY_STATUSES
} = require("./engine");

function response(statusCode, payload) {
  return { statusCode, payload };
}

function badRequest(message, details = {}) {
  return response(400, { error: "VALIDATION_ERROR", message, ...details });
}

async function withStoryError(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StoryError) {
      return response(error.statusCode, {
        error: error.storyCode,
        message: error.message,
        ...error.details
      });
    }

    // Gate 1 (approveCandidate) loads and locks the Canon Bundle
    // before it will approve a candidate. A broken/unapproved/
    // conflicting Canon must fail closed with a clear error, not
    // fall through to a generic 500.
    if (error instanceof CanonError) {
      return response(503, {
        error: error.code,
        message: error.message
      });
    }

    throw error;
  }
}

function parseIntegerParameter(value, { fieldName, minimum, maximum, fallback }) {
  if (value === null || value === undefined || value === "") {
    return { value: fallback };
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return {
      error: `${fieldName} must be an integer from ${minimum} to ${maximum}.`
    };
  }

  return { value: parsed };
}

function serializeRun(row) {
  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    idempotency_key: row.idempotency_key,
    fusion_candidate_id: String(row.fusion_candidate_id),
    status: row.status,
    current_stage: row.current_stage,
    candidate_snapshot_hash: row.candidate_snapshot_hash,
    canon_version: row.canon_version,
    rules_version: row.rules_version,
    season_version: row.season_version,
    canon_hash: row.canon_hash,
    candidate_slot_id: row.candidate_slot_id,
    beat_id: row.beat_id,
    apex_stage: row.apex_stage,
    creator_notes: row.creator_notes,
    forbidden_elements: row.forbidden_elements,
    review_language: row.review_language,
    script_language: row.script_language,
    selected_direction_ids: row.selected_direction_ids,
    selection_mode: row.selection_mode,
    merge_notes: row.merge_notes,
    selected_script_id:
      row.selected_script_id === null || row.selected_script_id === undefined
        ? null
        : String(row.selected_script_id),
    failure_stage: row.failure_stage,
    error_code: row.error_code,
    error_message: row.error_message,
    attempt_count: row.attempt_count,
    stage_attempt_count: row.stage_attempt_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at
  };
}

// Task 3.5E: rows persisted before the Integrated Story fix carry
// one of the four legacy direction_type values (VEHICLE_POWER /
// COUNTRY_CONFLICT / PERSON_CULTURE / APEX_PROGRESSION) -- each
// used only one evidence layer instead of fusing all of them, so
// they are tagged LEGACY_DIRECTION for the UI and (see
// computeGateFlags below) can never be selected at Gate 2, no
// matter what their stored validation_status is.
function directionSchemaTag(row) {
  return row.direction_type === INTEGRATED_STORY_DIRECTION_TYPE
    ? "INTEGRATED_STORY"
    : "LEGACY_DIRECTION";
}

function serializeDirection(row) {
  return {
    id: String(row.id),
    version: row.version,
    direction_key: row.direction_key,
    direction_type: row.direction_type,
    direction_schema: directionSchemaTag(row),
    payload: row.payload,
    validation_status: row.validation_status,
    validation_issues: row.validation_issues,
    superseded_at: row.superseded_at,
    created_at: row.created_at
  };
}

function serializeOutline(row) {
  return {
    id: String(row.id),
    version: row.version,
    payload: row.payload,
    validation_status: row.validation_status,
    validation_issues: row.validation_issues,
    locked_by: row.locked_by,
    locked_at: row.locked_at,
    superseded_at: row.superseded_at,
    created_at: row.created_at
  };
}

function serializeScript(row) {
  return {
    id: String(row.id),
    version: row.version,
    variant_type: row.variant_type,
    payload: row.payload,
    word_count: row.word_count,
    estimated_duration_seconds: row.estimated_duration_seconds,
    validation_status: row.validation_status,
    validation_issues: row.validation_issues,
    locked_by: row.locked_by,
    locked_at: row.locked_at,
    superseded_at: row.superseded_at,
    created_at: row.created_at
  };
}

function serializeEvent(row) {
  return {
    id: String(row.id),
    event_type: row.event_type,
    stage: row.stage,
    payload: row.payload,
    created_at: row.created_at
  };
}

// =========================================================
// POST /api/story/runs
// =========================================================

async function createStoryRunHandler(pool, body, context = {}) {
  return withStoryError(async () => {
    const result = await createStoryRun(pool, body, context);

    return response(result.replayed ? 200 : 202, {
      data: serializeRun(result.run),
      replayed: Boolean(result.replayed),
      message: result.replayed
        ? "Story run already exists for this idempotency key."
        : "Story run created and awaiting candidate approval."
    });
  });
}

// =========================================================
// GET /api/story/runs
// =========================================================

async function listStoryRuns(pool, searchParams) {
  const limitResult = parseIntegerParameter(searchParams.get("limit"), {
    fieldName: "limit",
    minimum: 1,
    maximum: 100,
    fallback: 20
  });

  if (limitResult.error) {
    return badRequest(limitResult.error);
  }

  const offsetResult = parseIntegerParameter(searchParams.get("offset"), {
    fieldName: "offset",
    minimum: 0,
    maximum: 10000,
    fallback: 0
  });

  if (offsetResult.error) {
    return badRequest(offsetResult.error);
  }

  const rawStatus = searchParams.get("status");
  let status = null;

  if (rawStatus !== null && rawStatus !== "") {
    status = rawStatus.toUpperCase();

    if (!STORY_STATUSES.includes(status)) {
      return badRequest(
        `status must be one of ${STORY_STATUSES.join(", ")}.`
      );
    }
  }

  const rawFusionCandidateId = searchParams.get("fusion_candidate_id");

  if (rawFusionCandidateId && !/^[0-9]+$/.test(rawFusionCandidateId)) {
    return badRequest("fusion_candidate_id must be a positive integer.");
  }

  const values = [];
  const conditions = [];

  if (status) {
    values.push(status);
    conditions.push(`status = $${values.length}`);
  }

  if (rawFusionCandidateId) {
    values.push(rawFusionCandidateId);
    conditions.push(`fusion_candidate_id = $${values.length}`);
  }

  values.push(limitResult.value);
  const limitIndex = values.length;

  values.push(offsetResult.value);
  const offsetIndex = values.length;

  const result = await pool.query(
    `
      SELECT *, COUNT(*) OVER() AS total_count
      FROM story_pipeline_runs
      ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id DESC
      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `,
    values
  );

  const totalCount =
    result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;

  const data = result.rows.map(row => serializeRun(row));

  return response(200, {
    data,
    count: data.length,
    total_count: totalCount,
    filters: {
      status,
      fusion_candidate_id: rawFusionCandidateId || null,
      limit: limitResult.value,
      offset: offsetResult.value
    }
  });
}

// =========================================================
// GET /api/story/runs/:id
// =========================================================

function computeGateFlags(run, { hasSelectableDirections, hasLockableOutline, hasLockableScript }) {
  return {
    can_approve_candidate: run.status === "AWAITING_CANDIDATE_APPROVAL",
    can_select_direction:
      run.status === "AWAITING_DIRECTION_SELECTION" && hasSelectableDirections,
    can_lock_outline:
      run.status === "AWAITING_OUTLINE_LOCK" && hasLockableOutline,
    can_lock_script:
      run.status === "AWAITING_SCRIPT_LOCK" && hasLockableScript,
    can_regenerate: [
      "AWAITING_DIRECTION_SELECTION",
      "AWAITING_OUTLINE_LOCK",
      "AWAITING_SCRIPT_LOCK"
    ].includes(run.status) ||
      (run.status === "FAILED" && run.error_code === "NO_SELECTABLE_DIRECTION"),
    can_cancel: !["COMPLETED", "FAILED", "CANCELLED"].includes(run.status),
    can_resume: run.status === "FAILED" && Boolean(run.failure_stage)
  };
}

async function getStoryRun(pool, runId) {
  const run = await fetchRun(pool, runId);

  if (!run) {
    return response(404, {
      error: "STORY_RUN_NOT_FOUND",
      message: `Story run ${runId} was not found.`
    });
  }

  const directionsResult = await pool.query(
    `
      SELECT * FROM story_directions
      WHERE story_run_id = $1
      ORDER BY version DESC, direction_type ASC
    `,
    [runId]
  );

  const outlinesResult = await pool.query(
    `
      SELECT * FROM story_outlines
      WHERE story_run_id = $1
      ORDER BY version DESC
    `,
    [runId]
  );

  const scriptsResult = await pool.query(
    `
      SELECT * FROM story_scripts
      WHERE story_run_id = $1
      ORDER BY version DESC, variant_type ASC
    `,
    [runId]
  );

  const eventsResult = await pool.query(
    `
      SELECT * FROM story_pipeline_events
      WHERE story_run_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [runId]
  );

  const attemptsResult = await pool.query(
    `
      SELECT stage, status, COUNT(*)::int AS count,
        SUM(COALESCE(total_tokens, 0))::int AS total_tokens,
        SUM(COALESCE(latency_ms, 0))::int AS total_latency_ms
      FROM story_generation_attempts
      WHERE story_run_id = $1
      GROUP BY stage, status
      ORDER BY stage ASC, status ASC
    `,
    [runId]
  );

  const directionAttemptsResult = await pool.query(
    `
      SELECT direction_key, attempt_number, validation_status,
        issue_codes, evidence_refs, beat_id, state_transition,
        input_tokens, output_tokens, total_tokens, latency_ms,
        CASE WHEN attempt_number > 1 THEN COALESCE(total_tokens, 0) ELSE 0 END
          AS retry_tokens
      FROM story_generation_attempts
      WHERE story_run_id = $1
        AND stage = 'DIRECTIONS'
        AND direction_key IS NOT NULL
      ORDER BY direction_key ASC, attempt_number ASC, id ASC
    `,
    [runId]
  );

  const activeDirections = directionsResult.rows.filter(
    row => row.superseded_at === null
  );

  const activeOutlines = outlinesResult.rows.filter(
    row => row.superseded_at === null
  );

  const activeScripts = scriptsResult.rows.filter(
    row => row.superseded_at === null
  );

  // A legacy-schema direction (see directionSchemaTag) can never be
  // selected at Gate 2, regardless of its stored validation_status
  // -- it structurally used only one evidence layer, which the
  // Integrated Story fix defines as incomplete coverage.
  const hasSelectableDirections = activeDirections.some(
    row =>
      row.validation_status === "PASS" &&
      row.direction_type === INTEGRATED_STORY_DIRECTION_TYPE
  );

  const hasLegacyActiveDirections = activeDirections.some(
    row => row.direction_type !== INTEGRATED_STORY_DIRECTION_TYPE
  );

  const hasLockableOutline = activeOutlines.some(
    row => row.validation_status === "PASS"
  );

  const hasLockableScript = activeScripts.some(
    row => row.validation_status === "PASS"
  );

  const validationSummary = {
    directions: {
      pass: activeDirections.filter(r => r.validation_status === "PASS").length,
      blocked: activeDirections.filter(r => r.validation_status === "BLOCKED").length
    },
    outline: {
      pass: activeOutlines.filter(r => r.validation_status === "PASS").length,
      blocked: activeOutlines.filter(r => r.validation_status === "BLOCKED").length
    },
    scripts: {
      pass: activeScripts.filter(r => r.validation_status === "PASS").length,
      blocked: activeScripts.filter(r => r.validation_status === "BLOCKED").length
    }
  };

  const directionAttempts = directionAttemptsResult.rows.map(row => ({
    ...row,
    input_tokens: Number(row.input_tokens || 0),
    output_tokens: Number(row.output_tokens || 0),
    total_tokens: Number(row.total_tokens || 0),
    latency_ms: Number(row.latency_ms || 0),
    retry_tokens: Number(row.retry_tokens || 0)
  }));
  const totalDirectionTokens = directionAttempts.reduce(
    (sum, row) => sum + row.total_tokens,
    0
  );
  const finalValidDirectionCount = validationSummary.directions.pass;
  const perDirectionMetrics = Object.values(
    directionAttempts.reduce((byDirection, row) => {
      const key = row.direction_key;
      if (!byDirection[key]) {
        byDirection[key] = {
          direction_key: key,
          attempt_count: 0,
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          retry_tokens: 0,
          latency_ms: 0
        };
      }
      byDirection[key].attempt_count += 1;
      byDirection[key].input_tokens += row.input_tokens;
      byDirection[key].output_tokens += row.output_tokens;
      byDirection[key].total_tokens += row.total_tokens;
      byDirection[key].retry_tokens += row.retry_tokens;
      byDirection[key].latency_ms += row.latency_ms;
      return byDirection;
    }, {})
  );

  return response(200, {
    data: {
      run: serializeRun(run),
      candidate_snapshot_summary: run.candidate_snapshot
        ? {
            fusion_candidate_id: run.candidate_snapshot.fusion_candidate_id,
            vehicle: run.candidate_snapshot.vehicle,
            country: run.candidate_snapshot.country,
            country_news: run.candidate_snapshot.country_news,
            person: run.candidate_snapshot.person,
            no_person_signal: run.candidate_snapshot.no_person_signal,
            is_complete: run.candidate_snapshot.is_complete,
            fusion_score: run.candidate_snapshot.fusion_score,
            evidence_count: (run.candidate_snapshot.evidence || []).length
          }
        : null,
      directions: activeDirections.map(serializeDirection),
      selected_direction_ids: run.selected_direction_ids,
      outline: activeOutlines.map(serializeOutline),
      scripts: activeScripts.map(serializeScript),
      validation_summary: validationSummary,
      events: eventsResult.rows.map(serializeEvent),
      generation_attempts_summary: attemptsResult.rows,
      direction_generation_attempts: directionAttempts,
      direction_generation_metrics: {
        total_tokens: totalDirectionTokens,
        total_latency_ms: directionAttempts.reduce(
          (sum, row) => sum + row.latency_ms,
          0
        ),
        retry_tokens: directionAttempts.reduce(
          (sum, row) => sum + row.retry_tokens,
          0
        ),
        final_valid_direction_count: finalValidDirectionCount,
        per_direction: perDirectionMetrics,
        tokens_per_valid_direction:
          finalValidDirectionCount > 0
            ? Math.round(totalDirectionTokens / finalValidDirectionCount)
            : null
      },
      // Task 3.5E: a run whose active directions are all
      // legacy-schema (generated before the Integrated Story fix)
      // and hasn't locked an Outline yet needs a Regenerate, never
      // an auto-merge of the old four directions into a new one.
      directions_schema_status:
        activeDirections.length > 0 && hasLegacyActiveDirections
          ? "LEGACY_NEEDS_REGENERATE"
          : "CURRENT",
      ...computeGateFlags(run, {
        hasSelectableDirections,
        hasLockableOutline,
        hasLockableScript
      })
    }
  });
}

// =========================================================
// GATE ENDPOINTS
// =========================================================

async function approveCandidateHandler(pool, runId, body) {
  return withStoryError(async () => {
    const run = await approveCandidate(pool, runId, body);

    return response(200, {
      data: serializeRun(run),
      message: "Candidate approved; directions queued."
    });
  });
}

async function selectDirectionHandler(pool, runId, body) {
  return withStoryError(async () => {
    const run = await selectDirection(pool, runId, body);

    return response(200, {
      data: serializeRun(run),
      message: "Direction(s) selected; outline queued."
    });
  });
}

async function lockOutlineHandler(pool, runId, body) {
  return withStoryError(async () => {
    const run = await lockOutline(pool, runId, body);

    return response(200, {
      data: serializeRun(run),
      message: "Outline locked; scripts queued."
    });
  });
}

async function lockScriptHandler(pool, runId, body) {
  return withStoryError(async () => {
    const run = await lockScript(pool, runId, body);

    return response(200, {
      data: serializeRun(run),
      message: "Script locked; Story Pipeline completed."
    });
  });
}

async function regenerateHandler(pool, runId, body) {
  return withStoryError(async () => {
    const run = await regenerateStage(pool, runId, body);

    return response(202, {
      data: serializeRun(run),
      message: `Regeneration queued for stage ${body && body.stage}.`
    });
  });
}

async function cancelHandler(pool, runId, body) {
  return withStoryError(async () => {
    const run = await cancelRun(pool, runId, body || {});

    return response(200, {
      data: serializeRun(run),
      message: "Story run cancelled."
    });
  });
}

async function resumeHandler(pool, runId) {
  return withStoryError(async () => {
    const run = await resumeRun(pool, runId);

    return response(202, {
      data: serializeRun(run),
      message: "Story run resumed."
    });
  });
}

module.exports = {
  createStoryRunHandler,
  listStoryRuns,
  getStoryRun,
  approveCandidateHandler,
  selectDirectionHandler,
  lockOutlineHandler,
  lockScriptHandler,
  regenerateHandler,
  cancelHandler,
  resumeHandler,
  serializeRun
};

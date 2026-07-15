// =========================================================
// LIVE ACCEPTANCE: Story Direction generation against real
// Gemini, via the production entrypoint (executeDirectionsGeneration).
//
// This is NOT a unit test with a scripted fake provider -- deps.generateJson
// is the real lib/story/provider.js generateJson, so every direction is a
// real network call to Gemini. Only the Postgres pool is a lightweight
// in-memory double (adapted from scripts/test-story-worker.js's
// createMockStoryPool), because a live-Gemini acceptance run should not
// require provisioning the full upstream FK chain (vehicle catalog,
// country news, fusion candidate) just to hold a run row -- the engine's
// generation/validation/retry logic runs unmodified either way.
//
// Requires GEMINI_API_KEY and STORY_GEMINI_MODEL in the environment.
// Never fabricates a result: any assertion failure exits non-zero with
// the real observed data printed first.
// =========================================================

const assert = require("node:assert/strict");
const fs = require("node:fs");

const {
  executeDirectionsGeneration,
  selectDirection
} = require("../lib/story/engine");
const { loadCanonBundle } = require("../lib/story/canon");
const { generateJson } = require("../lib/story/provider");

const REGRESSION_EVIDENCE_REFS = [
  "vehicle:9",
  "country_news:413",
  "person:13",
  "historical_resonance:13"
];

function baseRunRow(canonBundle, overrides = {}) {
  return {
    id: 1,
    idempotency_key: null,
    fusion_candidate_id: 1,
    status: "GENERATING_DIRECTIONS",
    current_stage: "GENERATING_DIRECTIONS",
    candidate_snapshot: {
      fusion_candidate_id: "regression-candidate",
      vehicle: { id: "9", code: "VH-9", name: "Regression Vehicle" },
      country: { id: "1", code: "JP", name: "Japan" },
      country_news: { id: "413", title: "Regression country signal" },
      person: { id: "13", canonical_name: "Keiichi Tsuchiya" },
      historical_resonance: { id: "13" },
      no_person_signal: false,
      evidence: [
        { id: "vehicle:9", type: "VEHICLE" },
        { id: "country_news:413", type: "COUNTRY_NEWS" },
        { id: "person:13", type: "PERSON" },
        { id: "historical_resonance:13", type: "HISTORICAL_RESONANCE" }
      ]
    },
    candidate_snapshot_hash: "sha256:live-accept-fixed",
    canon_version: canonBundle.canon_version,
    rules_version: canonBundle.rules_version,
    season_version: canonBundle.season_version,
    canon_hash: canonBundle.canon_hash,
    candidate_slot_id: "CANDIDATE_SLOT_LIVE",
    beat_id: "BEAT-04",
    apex_stage: "GLOBAL_QUALIFIERS",
    creator_notes: null,
    forbidden_elements: [],
    review_language: "en",
    script_language: "en",
    selected_direction_ids: [],
    selection_mode: null,
    merge_notes: null,
    selected_script_id: null,
    failure_stage: null,
    error_code: null,
    error_message: null,
    worker_id: "live-acceptance",
    lease_expires_at: new Date(Date.now() + 600000),
    attempt_count: 1,
    stage_attempt_count: 1,
    created_at: new Date(Date.now() - 1000),
    updated_at: new Date(),
    completed_at: null,
    cancelled_at: null,
    ...overrides
  };
}

// Adapted from scripts/test-story-worker.js createMockStoryPool -- same
// query-pattern-matching approach, extended with the selectDirection
// lookup pattern (no ORDER BY) that file's DIRECTIONS-generation-only
// coverage didn't need.
function createMockStoryPool(initialRows) {
  const state = {
    runs: new Map(initialRows.map(row => [row.id, { ...row }])),
    directions: new Map(),
    attempts: [],
    events: [],
    nextDirectionId: 1000,
    nextEventId: 1
  };

  let snapshot = null;

  function cloneState() {
    return {
      runs: new Map([...state.runs].map(([k, v]) => [k, { ...v }])),
      directions: new Map([...state.directions].map(([k, v]) => [k, { ...v }])),
      attempts: state.attempts.map(row => ({ ...row })),
      events: state.events.map(e => ({ ...e }))
    };
  }

  async function query(sql, values = []) {
    const trimmed = String(sql).trim();
    const upper = trimmed.toUpperCase();

    if (upper === "BEGIN") {
      snapshot = cloneState();
      return { rows: [], rowCount: 0 };
    }

    if (upper === "COMMIT") {
      snapshot = null;
      return { rows: [], rowCount: 0 };
    }

    if (upper === "ROLLBACK") {
      if (snapshot) {
        state.runs = snapshot.runs;
        state.directions = snapshot.directions;
        state.attempts = snapshot.attempts;
        state.events = snapshot.events;
        snapshot = null;
      }
      return { rows: [], rowCount: 0 };
    }

    if (
      trimmed.includes("FROM story_pipeline_runs WHERE id = $1") &&
      trimmed.includes("FOR UPDATE")
    ) {
      const row = state.runs.get(Number(values[0]));
      if (!row) return { rows: [], rowCount: 0 };

      const leaseIsValid =
        row.lease_expires_at !== null &&
        row.lease_expires_at !== undefined &&
        new Date(row.lease_expires_at) > new Date();

      return {
        rows: [{ ...row, lease_is_valid: leaseIsValid }],
        rowCount: 1
      };
    }

    if (trimmed.includes("COALESCE(MAX(version), 0)")) {
      return { rows: [{ max_version: 0 }], rowCount: 1 };
    }

    // latestRevisionNotes -- no prior REGENERATE_REQUESTED event for a
    // fresh run, so no revision notes exist yet.
    if (
      trimmed.includes("FROM story_pipeline_events") &&
      trimmed.includes("event_type = 'REGENERATE_REQUESTED'")
    ) {
      return { rows: [], rowCount: 0 };
    }

    if (trimmed.startsWith("INSERT INTO story_directions")) {
      const [runId, version, directionKey, directionType, payload, validationStatus, validationIssues] = values;
      const id = state.nextDirectionId++;
      state.directions.set(id, {
        id,
        story_run_id: Number(runId),
        version,
        direction_key: directionKey,
        direction_type: directionType,
        payload: JSON.parse(payload),
        validation_status: validationStatus,
        validation_issues: JSON.parse(validationIssues),
        superseded_at: null,
        created_at: new Date()
      });
      return { rows: [], rowCount: 1 };
    }

    if (trimmed.startsWith("INSERT INTO story_generation_attempts")) {
      state.attempts.push({ values: [...values] });
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("status = $2") &&
      trimmed.includes("failure_stage = $4")
    ) {
      const [runId, status, currentStage, failureStage, errorCode, errorMessage] = values;
      const row = state.runs.get(Number(runId));
      row.status = status;
      row.current_stage = currentStage;
      row.failure_stage = failureStage;
      row.error_code = errorCode;
      row.error_message = errorMessage;
      row.worker_id = null;
      row.lease_expires_at = null;
      row.updated_at = new Date();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      /SET\s+status = 'AWAITING_/.test(trimmed) &&
      !trimmed.includes("worker_id = NULL AND")
    ) {
      const [runId] = values;
      const row = state.runs.get(Number(runId));
      const nextStatus = /status = '([A-Z_]+)'/.exec(trimmed)[1];
      row.status = nextStatus;
      row.current_stage = nextStatus;
      row.worker_id = null;
      row.lease_expires_at = null;
      row.updated_at = new Date();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // persistStageFailure's literal-'FAILED' UPDATE (hit only if
    // executeDirectionsGeneration's try block throws -- e.g. a real
    // provider error rather than a validator BLOCKED result).
    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("status = 'FAILED'") &&
      trimmed.includes("failure_stage = $1")
    ) {
      const [stage, errorCode, errorMessage, runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = "FAILED";
      row.current_stage = "FAILED";
      row.failure_stage = stage;
      row.error_code = errorCode;
      row.error_message = errorMessage;
      row.worker_id = null;
      row.lease_expires_at = null;
      row.updated_at = new Date();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (trimmed.startsWith("INSERT INTO story_pipeline_events")) {
      const [runId, eventType, stage, payloadJson] = values;
      const id = state.nextEventId++;
      state.events.push({
        id,
        story_run_id: Number(runId),
        event_type: eventType,
        stage,
        payload: JSON.parse(payloadJson),
        created_at: new Date()
      });
      return { rows: [], rowCount: 1 };
    }

    // selectDirection's lookup: no ORDER BY, superseded_at IS NULL guard.
    if (
      trimmed.includes("FROM story_directions") &&
      trimmed.includes("id = ANY($2::bigint[])") &&
      trimmed.includes("superseded_at IS NULL")
    ) {
      const [runId, ids] = values;
      const idSet = new Set((ids || []).map(String));
      const matches = [...state.directions.values()].filter(
        d => d.story_run_id === Number(runId) && idSet.has(String(d.id))
      );
      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("selected_direction_ids = $1::jsonb")
    ) {
      const runId = values[values.length - 1];
      const row = state.runs.get(Number(runId));
      row.status = "QUEUED_OUTLINE";
      row.current_stage = "QUEUED_OUTLINE";
      row.selected_direction_ids = values[0];
      row.selection_mode = values[1];
      row.updated_at = new Date();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    throw new Error(`Unhandled mock query in live-accept script: ${trimmed.slice(0, 200)}`);
  }

  return {
    async connect() {
      return { query, release() {} };
    },
    query,
    _state: state
  };
}

function summarizeAttempt(row) {
  const v = row.values;
  return {
    direction_key: v[16],
    attempt_number: v[12],
    validation_status: v[17],
    issue_codes: JSON.parse(v[18]),
    evidence_refs: JSON.parse(v[19]),
    beat_id: v[20],
    state_transition: JSON.parse(v[21]),
    provider_model: v[4],
    input_tokens: v[8],
    output_tokens: v[9],
    total_tokens: v[10],
    latency_ms: v[11]
  };
}

async function main() {
  assert.ok(process.env.GEMINI_API_KEY, "GEMINI_API_KEY must be set for a live acceptance run.");
  assert.ok(process.env.STORY_GEMINI_MODEL, "STORY_GEMINI_MODEL must be set for a live acceptance run.");

  const canonBundle = loadCanonBundle();
  const pool = createMockStoryPool([baseRunRow(canonBundle)]);
  const run = pool._state.runs.get(1);

  const result = await executeDirectionsGeneration(pool, run, {
    loadCanonBundle: () => canonBundle,
    generateJson
  });

  const attempts = pool._state.attempts.map(summarizeAttempt);
  const directions = [...pool._state.directions.values()];

  console.log("LIVE ENGINE REGRESSION ATTEMPTS");
  for (const a of attempts) console.log(JSON.stringify(a));

  const totalTokens = attempts.reduce((s, a) => s + Number(a.total_tokens || 0), 0);
  const totalLatency = attempts.reduce((s, a) => s + Number(a.latency_ms || 0), 0);
  const retryTokens = attempts
    .filter(a => a.attempt_number > 1)
    .reduce((s, a) => s + Number(a.total_tokens || 0), 0);
  const passCount = directions.filter(d => d.validation_status === "PASS").length;
  const blockedCount = directions.filter(d => d.validation_status === "BLOCKED").length;

  const metrics = {
    total_tokens: totalTokens,
    total_latency_ms: totalLatency,
    retry_tokens: retryTokens,
    pass_count: passCount,
    blocked_count: blockedCount,
    tokens_per_valid_direction: passCount > 0 ? Math.round(totalTokens / passCount) : null,
    run_status: result.status
  };
  console.log("LIVE METRICS (REAL, NOT FIXTURE)");
  console.log(JSON.stringify(metrics));

  // ---- Acceptance assertions (conditions 1-10 from the task spec) ----
  const failures = [];
  function check(label, condition) {
    if (!condition) failures.push(label);
  }

  check("4 directions produced", directions.length === 4);

  for (const d of directions) {
    const sc = d.payload.signal_contributions || {};
    const cov = d.payload.coverage_status || {};

    check(
      `${d.direction_key}: vehicle/country/person/historical/apex all USED`,
      cov.vehicle_signal === "USED" &&
        cov.country_signal === "USED" &&
        cov.person_signal === "USED" &&
        cov.historical_resonance === "USED" &&
        cov.apex_rules === "USED"
    );

    check(
      `${d.direction_key}: locked beat is BEAT-04`,
      sc.apex && sc.apex.beat_id === "BEAT-04" && cov.locked_beat === "MATCH"
    );

    const allRefs = [
      ...(sc.vehicle?.evidence_refs || []),
      ...(sc.country?.evidence_refs || []),
      ...(sc.person?.evidence_refs || [])
    ];
    check(
      `${d.direction_key}: no evidence ref outside allowlist`,
      allRefs.every(ref => REGRESSION_EVIDENCE_REFS.includes(ref))
    );

    const stateChange = (d.payload.proposed_state_changes || [])[0];
    check(
      `${d.direction_key}: no forbidden state skip to QUALIFIER_PASSED`,
      !stateChange || stateChange.target_state !== "QUALIFIER_PASSED"
    );
  }

  const directionAttempts = {};
  for (const a of attempts) {
    directionAttempts[a.direction_key] = (directionAttempts[a.direction_key] || 0) + 1;
  }
  check(
    "every direction used at most 3 attempts",
    Object.values(directionAttempts).every(n => n <= 3)
  );

  const retriedKeys = new Set(
    attempts.filter(a => a.attempt_number > 1).map(a => a.direction_key)
  );
  for (const key of retriedKeys) {
    const firstBlocked = attempts.find(a => a.direction_key === key && a.attempt_number === 1);
    const secondAttempt = attempts.find(a => a.direction_key === key && a.attempt_number === 2);
    check(
      `${key}: retry actually followed a BLOCKED first attempt`,
      firstBlocked && firstBlocked.validation_status === "BLOCKED" && Boolean(secondAttempt)
    );
  }

  check("at least 1 PASS direction", passCount >= 1);

  const passDirection = directions.find(d => d.validation_status === "PASS");
  const blockedDirection = directions.find(d => d.validation_status === "BLOCKED");

  if (blockedDirection) {
    try {
      await selectDirection(pool, 1, {
        approved_by: "michael",
        selected_direction_ids: [String(blockedDirection.id)],
        selection_mode: "SINGLE"
      });
      failures.push("BLOCKED direction was selectable (expected VALIDATION_BLOCKED)");
    } catch (error) {
      check(
        "BLOCKED direction rejected with VALIDATION_BLOCKED",
        error.code === "VALIDATION_BLOCKED"
      );
    }
  }

  if (passDirection) {
    const selectResult = await selectDirection(pool, 1, {
      approved_by: "michael",
      selected_direction_ids: [String(passDirection.id)],
      selection_mode: "SINGLE"
    });
    check(
      "PASS direction selectable, run advances to QUEUED_OUTLINE",
      selectResult.status === "QUEUED_OUTLINE"
    );
  }

  console.log("ACCEPTANCE RESULT");
  if (failures.length > 0) {
    console.log(JSON.stringify({ result: "FAIL", failures }, null, 2));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify({ result: "PASS", failures: [] }, null, 2));

  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n## Live Story Direction acceptance (real Gemini)\n\n` +
        "```json\n" + JSON.stringify({ metrics, attempts }, null, 2) + "\n```\n"
    );
  }
}

main().catch(error => {
  console.error("LIVE ACCEPTANCE SCRIPT ERROR", error);
  process.exitCode = 1;
});

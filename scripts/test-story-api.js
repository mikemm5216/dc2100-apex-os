const assert = require("node:assert/strict");
const http = require("node:http");
const { URLSearchParams } = require("node:url");

const {
  createStoryRunHandler,
  listStoryRuns,
  getStoryRun,
  approveCandidateHandler,
  selectDirectionHandler,
  lockOutlineHandler,
  lockScriptHandler,
  regenerateHandler,
  cancelHandler,
  resumeHandler
} = require("../lib/story/api");

const {
  buildCandidateSnapshot,
  evidenceIdsFromSnapshot
} = require("../lib/story/engine");

const { validateOutline } = require("../lib/story/validators");
const { createRequestHandler } = require("../apps/api/src/server");

async function withHttpServer(pool, fn) {
  const server = http.createServer(createRequestHandler(pool));

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  try {
    await fn(server.address().port);
  } finally {
    await new Promise((resolve, reject) => {
      server.close(error => (error ? reject(error) : resolve()));
    });
  }
}

function httpRequest(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers
      },
      res => {
        const chunks = [];

        res.on("data", chunk => chunks.push(chunk));
        res.on("end", () => {
          const rawBody = Buffer.concat(chunks).toString("utf8");
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            rawBody,
            body: rawBody ? JSON.parse(rawBody) : null
          });
        });
      }
    );

    req.on("error", reject);

    if (body !== undefined) {
      req.write(body);
    }

    req.end();
  });
}

// ---------------------------------------------------------
// In-memory mock database. Dispatches on SQL text substrings,
// the same pattern used by scripts/test-autoflow-api.js -- no
// real Postgres connection is required here.
// ---------------------------------------------------------

let clock = 0;
function fixedNow() {
  clock += 1;
  return new Date(2026, 0, 1, 0, 0, clock);
}

function createMockDb({ candidates = {} } = {}) {
  const state = {
    candidates: new Map(Object.entries(candidates)),
    runs: new Map(),
    directions: new Map(),
    outlines: new Map(),
    scripts: new Map(),
    attempts: [],
    events: [],
    nextRunId: 1,
    nextDirectionId: 1,
    nextOutlineId: 1,
    nextScriptId: 1,
    nextEventId: 1
  };

  let snapshot = null;

  function cloneState(source) {
    return {
      runs: new Map([...source.runs].map(([k, v]) => [k, { ...v }])),
      directions: new Map([...source.directions].map(([k, v]) => [k, { ...v }])),
      outlines: new Map([...source.outlines].map(([k, v]) => [k, { ...v }])),
      scripts: new Map([...source.scripts].map(([k, v]) => [k, { ...v }])),
      attempts: source.attempts.map(a => ({ ...a })),
      events: source.events.map(e => ({ ...e })),
      nextRunId: source.nextRunId,
      nextDirectionId: source.nextDirectionId,
      nextOutlineId: source.nextOutlineId,
      nextScriptId: source.nextScriptId,
      nextEventId: source.nextEventId
    };
  }

  function conflictError(constraint) {
    const error = new Error(
      `duplicate key value violates unique constraint "${constraint}"`
    );
    error.code = "23505";
    error.constraint = constraint;
    return error;
  }

  async function query(sql, values = []) {
    const trimmed = String(sql).trim();
    const upper = trimmed.toUpperCase();

    if (upper === "BEGIN") {
      snapshot = cloneState(state);
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
        state.outlines = snapshot.outlines;
        state.scripts = snapshot.scripts;
        state.attempts = snapshot.attempts;
        state.events = snapshot.events;
        state.nextRunId = snapshot.nextRunId;
        state.nextDirectionId = snapshot.nextDirectionId;
        state.nextOutlineId = snapshot.nextOutlineId;
        state.nextScriptId = snapshot.nextScriptId;
        state.nextEventId = snapshot.nextEventId;
        snapshot = null;
      }
      return { rows: [], rowCount: 0 };
    }

    // ------------------ vehicle_fusion_candidates (join) ------------------

    if (
      trimmed.includes("FROM vehicle_fusion_candidates vfc") &&
      trimmed.includes("JOIN vehicles v")
    ) {
      const candidate = state.candidates.get(String(values[0]));
      return candidate ? { rows: [{ ...candidate }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (trimmed.includes("SELECT id FROM vehicle_fusion_candidates")) {
      const candidate = state.candidates.get(String(values[0]));
      return candidate ? { rows: [{ id: candidate.id }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    // ------------------ story_pipeline_runs: idempotency / active checks ------------------

    if (trimmed.includes("FROM story_pipeline_runs WHERE idempotency_key = $1")) {
      const found = [...state.runs.values()].find(
        r => r.idempotency_key === values[0]
      );
      return found ? { rows: [{ ...found }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (
      trimmed.includes("FROM story_pipeline_runs") &&
      trimmed.includes("fusion_candidate_id = $1") &&
      trimmed.includes("NOT IN")
    ) {
      const found = [...state.runs.values()].filter(
        r =>
          String(r.fusion_candidate_id) === String(values[0]) &&
          !["COMPLETED", "FAILED", "CANCELLED"].includes(r.status)
      );
      return { rows: found.map(r => ({ id: r.id, status: r.status })), rowCount: found.length };
    }

    // ------------------ story_pipeline_runs: insert ------------------

    if (trimmed.startsWith("INSERT INTO story_pipeline_runs")) {
      const [idempotencyKey, fusionCandidateId, snapshotJson, snapshotHash] = values;
      const now = fixedNow();
      const id = state.nextRunId++;

      const row = {
        id,
        idempotency_key: idempotencyKey,
        fusion_candidate_id: Number(fusionCandidateId),
        status: "AWAITING_CANDIDATE_APPROVAL",
        current_stage: "AWAITING_CANDIDATE_APPROVAL",
        candidate_snapshot: JSON.parse(snapshotJson),
        candidate_snapshot_hash: snapshotHash,
        canon_version: null,
        rules_version: null,
        season_version: null,
        canon_hash: null,
        candidate_slot_id: null,
        beat_id: null,
        apex_stage: null,
        creator_notes: null,
        forbidden_elements: [],
        review_language: null,
        script_language: null,
        selected_direction_ids: [],
        selection_mode: null,
        merge_notes: null,
        selected_script_id: null,
        failure_stage: null,
        error_code: null,
        error_message: null,
        worker_id: null,
        lease_expires_at: null,
        attempt_count: 0,
        stage_attempt_count: 0,
        created_at: now,
        updated_at: now,
        completed_at: null,
        cancelled_at: null
      };

      state.runs.set(id, row);
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ story_pipeline_runs: fetch ------------------

    if (
      trimmed.includes("FROM story_pipeline_runs WHERE id = $1") &&
      trimmed.includes("FOR UPDATE")
    ) {
      const row = state.runs.get(Number(values[0]));

      if (!row) {
        return { rows: [], rowCount: 0 };
      }

      const leaseIsValid =
        row.lease_expires_at !== null &&
        row.lease_expires_at !== undefined &&
        new Date(row.lease_expires_at) > new Date();

      return {
        rows: [{ ...row, lease_is_valid: leaseIsValid }],
        rowCount: 1
      };
    }

    if (trimmed === "SELECT * FROM story_pipeline_runs WHERE id = $1") {
      const row = state.runs.get(Number(values[0]));
      return row ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    // ------------------ Gate 1: approveCandidate ------------------

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'QUEUED_DIRECTIONS'") &&
      trimmed.includes("candidate_slot_id")
    ) {
      const [
        candidateSlotId, beatId, apexStage, creatorNotes,
        forbiddenElements, reviewLanguage, scriptLanguage,
        canonVersion, rulesVersion, seasonVersion, canonHash, runId
      ] = values;

      const row = state.runs.get(Number(runId));
      row.status = "QUEUED_DIRECTIONS";
      row.current_stage = "QUEUED_DIRECTIONS";
      row.candidate_slot_id = candidateSlotId;
      row.beat_id = beatId;
      row.apex_stage = apexStage;
      row.creator_notes = creatorNotes;
      row.forbidden_elements = JSON.parse(forbiddenElements);
      row.review_language = reviewLanguage;
      row.script_language = scriptLanguage;
      row.canon_version = canonVersion;
      row.rules_version = rulesVersion;
      row.season_version = seasonVersion;
      row.canon_hash = canonHash;
      row.stage_attempt_count = 0;
      row.updated_at = fixedNow();

      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ Gate 2: selectDirection ------------------

    if (
      trimmed.includes("FROM story_directions") &&
      trimmed.includes("id = ANY($2::bigint[])") &&
      trimmed.includes("superseded_at IS NULL")
    ) {
      const [runId, ids] = values;
      const idSet = new Set(ids.map(String));

      const matches = [...state.directions.values()].filter(
        d =>
          d.story_run_id === Number(runId) &&
          idSet.has(String(d.id)) &&
          d.superseded_at === null
      );

      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'QUEUED_OUTLINE'")
    ) {
      const [selectedIdsJson, selectionMode, mergeNotes, runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = "QUEUED_OUTLINE";
      row.current_stage = "QUEUED_OUTLINE";
      row.selected_direction_ids = JSON.parse(selectedIdsJson);
      row.selection_mode = selectionMode;
      row.merge_notes = mergeNotes;
      row.stage_attempt_count = 0;
      row.updated_at = fixedNow();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ Gate 3: lockOutline ------------------

    if (
      trimmed.includes("FROM story_outlines") &&
      trimmed.includes("FOR UPDATE") &&
      trimmed.includes("story_run_id = $2")
    ) {
      const [outlineId, runId] = values;
      const row = state.outlines.get(Number(outlineId));

      const match =
        row &&
        row.story_run_id === Number(runId) &&
        row.superseded_at === null;

      return match ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (
      trimmed.startsWith("UPDATE story_outlines") &&
      trimmed.includes("locked_by")
    ) {
      const [approvedBy, outlineId] = values;
      const row = state.outlines.get(Number(outlineId));
      row.locked_by = approvedBy;
      row.locked_at = fixedNow();
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'QUEUED_SCRIPTS'")
    ) {
      const [runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = "QUEUED_SCRIPTS";
      row.current_stage = "QUEUED_SCRIPTS";
      row.stage_attempt_count = 0;
      row.updated_at = fixedNow();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ Gate 4: lockScript ------------------

    if (
      trimmed.includes("FROM story_scripts") &&
      trimmed.includes("FOR UPDATE") &&
      trimmed.includes("story_run_id = $2")
    ) {
      const [scriptId, runId] = values;
      const row = state.scripts.get(Number(scriptId));

      const match =
        row &&
        row.story_run_id === Number(runId) &&
        row.superseded_at === null;

      return match ? { rows: [{ ...row }], rowCount: 1 } : { rows: [], rowCount: 0 };
    }

    if (
      trimmed.startsWith("UPDATE story_scripts") &&
      trimmed.includes("locked_by")
    ) {
      const [approvedBy, scriptId] = values;
      const row = state.scripts.get(Number(scriptId));
      row.locked_by = approvedBy;
      row.locked_at = fixedNow();
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'COMPLETED'") &&
      trimmed.includes("selected_script_id")
    ) {
      const [scriptId, runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = "COMPLETED";
      row.current_stage = "COMPLETED";
      row.selected_script_id = Number(scriptId);
      row.completed_at = fixedNow();
      row.updated_at = fixedNow();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ regenerateStage ------------------

    if (
      trimmed.startsWith("UPDATE story_directions") &&
      trimmed.includes("SET superseded_at = NOW()")
    ) {
      const [runId] = values;
      for (const d of state.directions.values()) {
        if (d.story_run_id === Number(runId) && d.superseded_at === null) {
          d.superseded_at = fixedNow();
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (
      trimmed.startsWith("UPDATE story_outlines") &&
      trimmed.includes("SET superseded_at = NOW()")
    ) {
      const [runId] = values;
      for (const o of state.outlines.values()) {
        if (o.story_run_id === Number(runId) && o.superseded_at === null) {
          o.superseded_at = fixedNow();
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (
      trimmed.startsWith("UPDATE story_scripts") &&
      trimmed.includes("SET superseded_at = NOW()")
    ) {
      const [runId] = values;
      for (const s of state.scripts.values()) {
        if (s.story_run_id === Number(runId) && s.superseded_at === null) {
          s.superseded_at = fixedNow();
        }
      }
      return { rows: [], rowCount: 0 };
    }

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("current_stage = $1") &&
      !trimmed.includes("worker_id")
    ) {
      const queuedStatus = values[0];
      const runId = values[values.length - 1];
      const row = state.runs.get(Number(runId));
      row.status = queuedStatus;
      row.current_stage = queuedStatus;
      row.stage_attempt_count = 0;
      row.updated_at = fixedNow();

      if (trimmed.includes("selected_direction_ids = '[]'")) {
        row.selected_direction_ids = [];
      }

      if (trimmed.includes("selection_mode = NULL")) {
        row.selection_mode = null;
      }

      if (trimmed.includes("merge_notes = NULL")) {
        row.merge_notes = null;
      }

      if (trimmed.includes("selected_script_id = NULL")) {
        row.selected_script_id = null;
      }

      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ cancelRun ------------------

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("'CANCELLED'")
    ) {
      const [runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = "CANCELLED";
      row.current_stage = "CANCELLED";
      row.cancelled_at = fixedNow();
      row.updated_at = fixedNow();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ resumeRun ------------------

    if (
      trimmed.includes("UPDATE story_pipeline_runs") &&
      trimmed.includes("failure_stage = NULL")
    ) {
      const [queuedStatus, runId] = values;
      const row = state.runs.get(Number(runId));
      row.status = queuedStatus;
      row.current_stage = queuedStatus;
      row.failure_stage = null;
      row.error_code = null;
      row.error_message = null;
      row.worker_id = null;
      row.lease_expires_at = null;
      row.updated_at = fixedNow();
      return { rows: [{ ...row }], rowCount: 1 };
    }

    // ------------------ events ------------------

    if (trimmed.startsWith("INSERT INTO story_pipeline_events")) {
      const [runId, eventType, stage, payloadJson] = values;
      const id = state.nextEventId++;
      state.events.push({
        id,
        story_run_id: Number(runId),
        event_type: eventType,
        stage,
        payload: JSON.parse(payloadJson),
        created_at: fixedNow()
      });
      return { rows: [], rowCount: 1 };
    }

    if (
      trimmed.includes("FROM story_pipeline_events") &&
      trimmed.includes("event_type = 'REGENERATE_REQUESTED'")
    ) {
      const [runId, stage] = values;
      const matches = state.events
        .filter(
          e =>
            e.story_run_id === Number(runId) &&
            e.event_type === "REGENERATE_REQUESTED" &&
            e.stage === stage
        )
        .sort((a, b) => b.id - a.id);

      return matches.length > 0
        ? { rows: [{ payload: matches[0].payload }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }

    if (
      trimmed.includes("FROM story_pipeline_events") &&
      trimmed.includes("story_run_id = $1")
    ) {
      const matches = state.events
        .filter(e => e.story_run_id === Number(values[0]))
        .sort((a, b) => a.id - b.id);

      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    // ------------------ list / detail reads ------------------

    if (
      trimmed.includes("COUNT(*) OVER() AS total_count") &&
      trimmed.includes("FROM story_pipeline_runs")
    ) {
      const all = [...state.runs.values()].sort((a, b) => b.id - a.id);
      const limit = values[values.length - 2];
      const offset = values[values.length - 1];
      const page = all.slice(offset, offset + limit);

      return {
        rows: page.map(r => ({ ...r, total_count: all.length })),
        rowCount: page.length
      };
    }

    if (
      trimmed.includes("FROM story_directions") &&
      trimmed.includes("WHERE story_run_id = $1") &&
      trimmed.includes("ORDER BY version DESC")
    ) {
      const matches = [...state.directions.values()].filter(
        d => d.story_run_id === Number(values[0])
      );
      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    if (
      trimmed.includes("FROM story_outlines") &&
      trimmed.includes("WHERE story_run_id = $1") &&
      trimmed.includes("ORDER BY version DESC") &&
      !trimmed.includes("FOR UPDATE")
    ) {
      const matches = [...state.outlines.values()].filter(
        o => o.story_run_id === Number(values[0])
      );
      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    if (
      trimmed.includes("FROM story_scripts") &&
      trimmed.includes("WHERE story_run_id = $1") &&
      trimmed.includes("ORDER BY version DESC") &&
      !trimmed.includes("FOR UPDATE")
    ) {
      const matches = [...state.scripts.values()].filter(
        s => s.story_run_id === Number(values[0])
      );
      return { rows: matches.map(m => ({ ...m })), rowCount: matches.length };
    }

    if (trimmed.includes("FROM story_generation_attempts")) {
      return { rows: [], rowCount: 0 };
    }

    throw new Error(`Unhandled mock query: ${trimmed.slice(0, 160)}`);
  }

  return {
    query,
    async connect() {
      return { query, release() {} };
    },
    _state: state
  };
}

function seedCandidate(id, overrides = {}) {
  return {
    id,
    fusion_run_id: 900,
    vehicle_id: 1,
    vehicle_code: "VH-1",
    vehicle_name: "Test Vehicle",
    vehicle_manufacturer: "Test Manufacturer",
    vehicle_category: "Sports Car",
    country_id: 1,
    country_code: "US",
    country_name: "United States",
    country_news_signal_id: 10,
    country_news_title: "Some real news title",
    country_news_canonical_title: "Some real news title",
    country_news_url: "https://example.com/news",
    country_news_source: "Example Wire",
    country_news_domain: "example.com",
    country_news_category: "TECH",
    country_news_provider: "GOOGLE_NEWS_RSS",
    country_news_published_at: new Date("2026-01-01T00:00:00Z"),
    country_news_first_seen_at: new Date("2026-01-01T01:00:00Z"),
    country_news_created_at: new Date("2026-01-01T02:00:00Z"),
    person_id: null,
    person_slug: null,
    person_canonical_name: null,
    person_role_category: null,
    vehicle_person_link_id: null,
    person_link_tier: null,
    link_relation_type: null,
    link_confidence: null,
    link_method: null,
    resonance_evidence_horizon: null,
    resonance_score: null,
    resonance_tier: null,
    resonance_evidence: {},
    resonance_version: null,
    person_traffic_url: null,
    person_traffic_source: null,
    person_traffic_domain: null,
    person_traffic_first_seen_at: null,
    missing_signals: ["NO_PERSON_SIGNAL"],
    is_complete: false,
    fusion_evidence: {},
    fusion_score: 72.5,
    fusion_version: "1.0.0",
    created_at: new Date(),
    ...overrides
  };
}

function seedCandidateWithPerson(id, overrides = {}) {
  return seedCandidate(id, {
    person_id: 55,
    person_slug: "jane-driver",
    person_canonical_name: "Jane Driver",
    person_role_category: "DRIVER_RACER",
    vehicle_person_link_id: 77,
    person_link_tier: "EXACT_VEHICLE",
    link_relation_type: "DRIVER",
    link_confidence: 0.92,
    link_method: "CATALOG",
    resonance_evidence_horizon: "TEN_YEARS",
    resonance_score: 81.5,
    resonance_tier: "ESTABLISHED",
    resonance_evidence: { basis: "catalog entry" },
    resonance_version: "resonance-v1",
    person_traffic_url: "https://example.com/jane-driver",
    person_traffic_source: "Example Wire",
    person_traffic_domain: "example.com",
    person_traffic_first_seen_at: new Date("2026-01-02T00:00:00Z"),
    missing_signals: [],
    is_complete: true,
    ...overrides
  });
}

function directionRow(runId, id, overrides = {}) {
  return {
    id,
    story_run_id: Number(runId),
    version: 1,
    direction_key: `DIR-${id}`,
    // Task 3.5E: new rows are always INTEGRATED_STORY -- these
    // fixtures default to the current schema so tests unrelated to
    // the Direction schema fix (merge_notes passthrough, selection
    // flow, etc.) exercise the happy path. Legacy-rejection is
    // covered by its own dedicated test below.
    direction_type: "INTEGRATED_STORY",
    payload: {},
    validation_status: "PASS",
    validation_issues: [],
    superseded_at: null,
    created_at: new Date(),
    ...overrides
  };
}

function outlineRow(runId, id, overrides = {}) {
  return {
    id,
    story_run_id: Number(runId),
    version: 1,
    payload: {},
    validation_status: "PASS",
    validation_issues: [],
    locked_by: null,
    locked_at: null,
    superseded_at: null,
    created_at: new Date(),
    ...overrides
  };
}

function scriptRow(runId, id, overrides = {}) {
  return {
    id,
    story_run_id: Number(runId),
    version: 1,
    variant_type: "VEHICLE_FIRST",
    payload: {},
    word_count: 90,
    estimated_duration_seconds: 35,
    validation_status: "PASS",
    validation_issues: [],
    locked_by: null,
    locked_at: null,
    superseded_at: null,
    created_at: new Date(),
    ...overrides
  };
}

const VALID_GATE1_BODY = {
  approved_by: "michael",
  candidate_slot_id: "CANDIDATE_SLOT_01",
  beat_id: "BEAT-04",
  apex_stage: "GLOBAL_QUALIFIERS",
  review_language: "zh-TW",
  script_language: "en"
};

async function run() {
  // -------------------------------------------------------
  // Story HTTP authentication. Exercise the real request
  // handler so route scoping and auth-before-body-parsing are
  // covered in addition to the API handler unit tests below.
  // -------------------------------------------------------
  {
    const storyTokenEnv = "STORY_ADMIN_TOKEN";
    const originalToken = process.env[storyTokenEnv];

    try {
      await withHttpServer({}, async port => {
        delete process.env[storyTokenEnv];

        const unconfigured = await httpRequest(port, "/api/story/runs");
        assert.equal(unconfigured.statusCode, 503);
        assert.equal(unconfigured.body.error, "STORY_AUTH_NOT_CONFIGURED");

        process.env[storyTokenEnv] = "test-story-admin-token";

        const missing = await httpRequest(port, "/api/story/runs");
        assert.equal(missing.statusCode, 401);
        assert.equal(missing.body.error, "UNAUTHORIZED");

        const wrong = await httpRequest(port, "/api/story/runs", {
          headers: { Authorization: "Bearer wrong" }
        });
        assert.equal(wrong.statusCode, 401);
        assert.equal(
          wrong.rawBody.includes(process.env[storyTokenEnv]),
          false,
          "Auth failures must never echo the configured token"
        );

        const malformedBody = await httpRequest(port, "/api/story/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{not-json"
        });
        assert.equal(
          malformedBody.statusCode,
          401,
          "Authentication must run before Story request-body parsing"
        );

        const authenticated = await httpRequest(port, "/api/story/unknown", {
          headers: {
            Authorization: `Bearer ${process.env[storyTokenEnv]}`
          }
        });
        assert.equal(authenticated.statusCode, 404);

        const health = await httpRequest(port, "/health");
        assert.equal(health.statusCode, 200);

        const similarlyNamedRoute = await httpRequest(port, "/api/storyboard");
        assert.equal(similarlyNamedRoute.statusCode, 404);

        delete process.env[storyTokenEnv];
        const preflight = await httpRequest(port, "/api/story/runs", {
          method: "OPTIONS"
        });
        assert.equal(preflight.statusCode, 204);
        assert.match(
          preflight.headers["access-control-allow-headers"],
          /Authorization/
        );
      });
    } finally {
      if (originalToken === undefined) {
        delete process.env[storyTokenEnv];
      } else {
        process.env[storyTokenEnv] = originalToken;
      }
    }
  }

  // -------------------------------------------------------
  // Create run.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    const result = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.status, "AWAITING_CANDIDATE_APPROVAL");
    assert.equal(result.payload.data.fusion_candidate_id, "1");
  }

  // -------------------------------------------------------
  // Idempotency replay.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    const first = await createStoryRunHandler(
      pool,
      { fusion_candidate_id: 1 },
      { idempotencyKey: "key-abc" }
    );

    const second = await createStoryRunHandler(
      pool,
      { fusion_candidate_id: 1 },
      { idempotencyKey: "key-abc" }
    );

    assert.equal(first.statusCode, 202);
    assert.equal(second.statusCode, 200);
    assert.equal(second.payload.replayed, true);
    assert.equal(second.payload.data.id, first.payload.data.id);
  }

  // -------------------------------------------------------
  // Idempotency conflict (same key, different candidate).
  // -------------------------------------------------------
  {
    const pool = createMockDb({
      candidates: { 1: seedCandidate(1), 2: seedCandidate(2) }
    });

    await createStoryRunHandler(
      pool,
      { fusion_candidate_id: 1 },
      { idempotencyKey: "key-xyz" }
    );

    const conflict = await createStoryRunHandler(
      pool,
      { fusion_candidate_id: 2 },
      { idempotencyKey: "key-xyz" }
    );

    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.payload.error, "IDEMPOTENCY_CONFLICT");
  }

  // -------------------------------------------------------
  // Missing Fusion Candidate.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: {} });

    const result = await createStoryRunHandler(pool, { fusion_candidate_id: 999 }, {});

    assert.equal(result.statusCode, 404);
    assert.equal(result.payload.error, "FUSION_CANDIDATE_NOT_FOUND");
  }

  // -------------------------------------------------------
  // Duplicate active run.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const second = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});

    assert.equal(second.statusCode, 409);
    assert.equal(second.payload.error, "ACTIVE_STORY_RUN_EXISTS");
  }

  // -------------------------------------------------------
  // Gate 1 valid.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    const result = await approveCandidateHandler(pool, runId, VALID_GATE1_BODY);

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "QUEUED_DIRECTIONS");
  }

  // -------------------------------------------------------
  // Gate 1 wrong state (already queued).
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    await approveCandidateHandler(pool, runId, VALID_GATE1_BODY);
    const second = await approveCandidateHandler(pool, runId, VALID_GATE1_BODY);

    assert.equal(second.statusCode, 409);
    assert.equal(second.payload.error, "INVALID_STORY_STATE");
  }

  // -------------------------------------------------------
  // Gate 2 single select.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;
    await approveCandidateHandler(pool, runId, VALID_GATE1_BODY);

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(1, directionRow(runId, 1));

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1],
      selection_mode: "SINGLE"
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "QUEUED_OUTLINE");
    assert.deepEqual(result.payload.data.selected_direction_ids, ["1"]);
  }

  // -------------------------------------------------------
  // Gate 2 merge select.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(1, directionRow(runId, 1));
    pool._state.directions.set(2, directionRow(runId, 2));

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1, 2],
      selection_mode: "MERGE",
      merge_notes: "Combine both."
    });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.payload.data.selected_direction_ids, ["1", "2"]);
  }

  // -------------------------------------------------------
  // Gate 2: selecting a BLOCKED direction rejected.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(
      1,
      directionRow(runId, 1, { validation_status: "BLOCKED" })
    );

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1],
      selection_mode: "SINGLE"
    });

    assert.equal(result.statusCode, 422);
    assert.equal(result.payload.error, "VALIDATION_BLOCKED");
  }

  // -------------------------------------------------------
  // Zero-selectable run exposes a domain failure, disables selection,
  // and keeps Regenerate available instead of pretending success.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;
    const row = pool._state.runs.get(Number(runId));
    row.status = "FAILED";
    row.current_stage = "FAILED";
    row.failure_stage = "DIRECTIONS";
    row.error_code = "NO_SELECTABLE_DIRECTION";
    row.error_message = "All directions remained BLOCKED.";
    pool._state.directions.set(
      1,
      directionRow(runId, 1, {
        validation_status: "BLOCKED",
        validation_issues: [{ code: "STATE_TRANSITION_INVALID" }]
      })
    );

    const detail = await getStoryRun(pool, runId);
    assert.equal(detail.payload.data.can_select_direction, false);
    assert.equal(detail.payload.data.can_regenerate, true);
    assert.equal(detail.payload.data.validation_summary.directions.pass, 0);

    const selection = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1],
      selection_mode: "SINGLE"
    });
    assert.equal(selection.statusCode, 422);
    assert.equal(selection.payload.error, "NO_SELECTABLE_DIRECTION");
  }

  // -------------------------------------------------------
  // Gate 3 valid lock.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_OUTLINE_LOCK";
    pool._state.outlines.set(1, outlineRow(runId, 1));

    const result = await lockOutlineHandler(pool, runId, {
      approved_by: "michael",
      outline_id: 1,
      lock_note: "Approved for scripts."
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "QUEUED_SCRIPTS");
    assert.equal(pool._state.outlines.get(1).locked_by, "michael");
  }

  // -------------------------------------------------------
  // Gate 3 wrong outline (does not exist / superseded).
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_OUTLINE_LOCK";
    pool._state.outlines.set(1, outlineRow(runId, 1, { superseded_at: new Date() }));

    const result = await lockOutlineHandler(pool, runId, {
      approved_by: "michael",
      outline_id: 1
    });

    assert.equal(result.statusCode, 409);
    assert.equal(result.payload.error, "ARTIFACT_NOT_LOCKABLE");
  }

  // -------------------------------------------------------
  // Gate 4 valid lock.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_SCRIPT_LOCK";
    pool._state.scripts.set(1, scriptRow(runId, 1));

    const result = await lockScriptHandler(pool, runId, {
      approved_by: "michael",
      script_id: 1,
      lock_note: "Final."
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "COMPLETED");
    assert.equal(result.payload.data.selected_script_id, "1");
  }

  // -------------------------------------------------------
  // Gate 4: a BLOCKED script cannot be locked.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_SCRIPT_LOCK";
    pool._state.scripts.set(1, scriptRow(runId, 1, { validation_status: "BLOCKED" }));

    const result = await lockScriptHandler(pool, runId, {
      approved_by: "michael",
      script_id: 1
    });

    assert.equal(result.statusCode, 422);
    assert.equal(result.payload.error, "VALIDATION_BLOCKED");
  }

  // -------------------------------------------------------
  // Regenerate retains history (old artifact superseded, not
  // deleted).
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_OUTLINE_LOCK";
    pool._state.outlines.set(1, outlineRow(runId, 1));

    const result = await regenerateHandler(pool, runId, {
      approved_by: "michael",
      stage: "OUTLINE",
      revision_notes: "Make it punchier."
    });

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.status, "QUEUED_OUTLINE");

    const oldOutline = pool._state.outlines.get(1);
    assert.ok(oldOutline.superseded_at !== null, "old outline must be superseded, not deleted");
    assert.ok(pool._state.outlines.has(1), "old outline row must still exist");
  }

  // -------------------------------------------------------
  // Cancel.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    const result = await cancelHandler(pool, runId, { reason: "no longer needed" });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.status, "CANCELLED");
  }

  // -------------------------------------------------------
  // Resume.
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    const row = pool._state.runs.get(Number(runId));
    row.status = "FAILED";
    row.failure_stage = "OUTLINE";

    const result = await resumeHandler(pool, runId);

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.status, "QUEUED_OUTLINE");
    assert.equal(result.payload.data.failure_stage, null);
  }

  // -------------------------------------------------------
  // List / detail.
  // -------------------------------------------------------
  {
    const pool = createMockDb({
      candidates: { 1: seedCandidate(1), 2: seedCandidate(2) }
    });

    await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    await createStoryRunHandler(pool, { fusion_candidate_id: 2 }, {});

    const listResult = await listStoryRuns(pool, new URLSearchParams());
    assert.equal(listResult.statusCode, 200);
    assert.equal(listResult.payload.count, 2);

    const detailResult = await getStoryRun(pool, 1);
    assert.equal(detailResult.statusCode, 200);
    assert.equal(detailResult.payload.data.run.id, "1");
    assert.equal(detailResult.payload.data.can_approve_candidate, true);
    assert.equal(detailResult.payload.data.can_cancel, true);
    assert.equal(detailResult.payload.data.can_resume, false);
  }

  // -------------------------------------------------------
  // Invalid ID (detail of a nonexistent run).
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: {} });

    const result = await getStoryRun(pool, 9999);

    assert.equal(result.statusCode, 404);
    assert.equal(result.payload.error, "STORY_RUN_NOT_FOUND");
  }

  // -------------------------------------------------------
  // Invalid JSON body shape (not an object).
  // -------------------------------------------------------
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    const result = await createStoryRunHandler(pool, "not-an-object", {});

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.error, "VALIDATION_ERROR");
  }

  // =========================================================
  // Section 1 fix: Detail API exposes both attempt_count
  // (lifetime total) and stage_attempt_count (current stage).
  // =========================================================
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).attempt_count = 5;
    pool._state.runs.get(Number(runId)).stage_attempt_count = 2;

    const detail = await getStoryRun(pool, runId);

    assert.equal(detail.payload.data.run.attempt_count, 5);
    assert.equal(detail.payload.data.run.stage_attempt_count, 2);
  }

  // =========================================================
  // Section 2 fix: Gate 2 merge instructions.
  // =========================================================

  // MERGE without merge_notes -> 400 VALIDATION_ERROR.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(1, directionRow(runId, 1));
    pool._state.directions.set(2, directionRow(runId, 2));

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1, 2],
      selection_mode: "MERGE"
    });

    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.error, "VALIDATION_ERROR");
  }

  // SINGLE stores selection_mode (and merge_notes stays null).
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(1, directionRow(runId, 1));

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1],
      selection_mode: "SINGLE"
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.selection_mode, "SINGLE");
    assert.equal(result.payload.data.merge_notes, null);
  }

  // MERGE stores the exact merge_notes string.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(1, directionRow(runId, 1));
    pool._state.directions.set(2, directionRow(runId, 2));

    const mergeNotes =
      "Use direction 1 as the main conflict and direction 3 for character motivation.";

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1, 2],
      selection_mode: "MERGE",
      merge_notes: mergeNotes
    });

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.selection_mode, "MERGE");
    assert.equal(result.payload.data.merge_notes, mergeNotes);
  }

  // =========================================================
  // Task 3.5E integration: Fusion Candidate -> Story Direction
  // Generation -> Validation -> Gate 2 Review. Only a
  // coverage-complete, correctly-beated (INTEGRATED_STORY)
  // direction may ever reach Gate 2 selection -- a legacy-schema
  // direction (generated before this fix) is rejected by the
  // actual selection endpoint itself, not only hidden by a UI
  // flag.
  // =========================================================

  // A legacy-schema direction can never be selected, even if its
  // stored validation_status is PASS.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(
      1,
      directionRow(runId, 1, { direction_type: "VEHICLE_POWER" })
    );

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1],
      selection_mode: "SINGLE"
    });

    assert.equal(result.statusCode, 422);
    assert.equal(result.payload.error, "LEGACY_DIRECTION_NOT_SELECTABLE");
    assert.deepEqual(result.payload.legacy_direction_ids, ["1"]);
  }

  // GET run detail: a legacy-schema active direction is tagged
  // LEGACY_DIRECTION, blocks can_select_direction, and reports
  // directions_schema_status = LEGACY_NEEDS_REGENERATE even though
  // its stored validation_status is PASS.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(
      1,
      directionRow(runId, 1, { direction_type: "VEHICLE_POWER" })
    );

    const detail = await getStoryRun(pool, runId);

    assert.equal(detail.payload.data.directions[0].direction_schema, "LEGACY_DIRECTION");
    assert.equal(detail.payload.data.directions_schema_status, "LEGACY_NEEDS_REGENERATE");
    assert.equal(detail.payload.data.can_select_direction, false);
  }

  // GET run detail: a current-schema (INTEGRATED_STORY) PASS
  // direction is selectable, tagged correctly, and reports CURRENT.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    pool._state.runs.get(Number(runId)).status = "AWAITING_DIRECTION_SELECTION";
    pool._state.directions.set(1, directionRow(runId, 1));

    const detail = await getStoryRun(pool, runId);

    assert.equal(detail.payload.data.directions[0].direction_schema, "INTEGRATED_STORY");
    assert.equal(detail.payload.data.directions_schema_status, "CURRENT");
    assert.equal(detail.payload.data.can_select_direction, true);

    const result = await selectDirectionHandler(pool, runId, {
      approved_by: "michael",
      selected_direction_ids: [1],
      selection_mode: "SINGLE"
    });

    assert.equal(result.statusCode, 200);
  }

  // Regenerate OUTLINE keeps merge_notes (Gate 2's decision
  // still applies to a re-attempted outline).
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    const row = pool._state.runs.get(Number(runId));
    row.status = "AWAITING_OUTLINE_LOCK";
    row.selection_mode = "MERGE";
    row.merge_notes = "Keep this instruction across regenerate.";
    pool._state.outlines.set(1, outlineRow(runId, 1));

    const result = await regenerateHandler(pool, runId, {
      approved_by: "michael",
      stage: "OUTLINE",
      revision_notes: "Try again."
    });

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.selection_mode, "MERGE");
    assert.equal(
      result.payload.data.merge_notes,
      "Keep this instruction across regenerate."
    );
  }

  // Regenerate DIRECTIONS clears selection_mode/merge_notes --
  // the prior Gate 2 decision no longer applies to a fresh
  // batch of directions.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    const row = pool._state.runs.get(Number(runId));
    row.status = "AWAITING_DIRECTION_SELECTION";
    row.selection_mode = "SINGLE";
    row.merge_notes = null;
    pool._state.directions.set(1, directionRow(runId, 1));

    const result = await regenerateHandler(pool, runId, {
      approved_by: "michael",
      stage: "DIRECTIONS",
      revision_notes: "Make them more distinct."
    });

    assert.equal(result.statusCode, 202);
    assert.equal(result.payload.data.selection_mode, null);
    assert.equal(result.payload.data.merge_notes, null);
    assert.deepEqual(result.payload.data.selected_direction_ids, []);
  }

  // =========================================================
  // Section 3 fix: Canon Bundle locked at Gate 1.
  // =========================================================

  // Gate 1 writes real Canon metadata onto the run.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    const result = await approveCandidateHandler(pool, runId, VALID_GATE1_BODY);

    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.canon_version, "1.0.0");
    assert.equal(result.payload.data.rules_version, "1.0.0");
    assert.equal(result.payload.data.season_version, "1.0.0");
    assert.ok(String(result.payload.data.canon_hash).startsWith("sha256:"));
  }

  // Run detail exposes the locked Canon metadata.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });
    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;

    await approveCandidateHandler(pool, runId, VALID_GATE1_BODY);

    const detail = await getStoryRun(pool, runId);

    assert.equal(detail.payload.data.run.canon_version, "1.0.0");
    assert.ok(String(detail.payload.data.run.canon_hash).startsWith("sha256:"));
  }

  // =========================================================
  // Section 4 fix: expanded, auditable Candidate Evidence
  // Snapshot.
  // =========================================================

  // Complete candidate snapshot (with person + historical
  // resonance evidence).
  {
    const pool = createMockDb({
      candidates: { 1: seedCandidateWithPerson(1) }
    });

    const snapshot = await buildCandidateSnapshot(pool, "1");

    assert.equal(snapshot.vehicle.manufacturer, "Test Manufacturer");
    assert.equal(snapshot.vehicle.category, "Sports Car");
    assert.equal(snapshot.country_news.source, "Example Wire");
    assert.ok(snapshot.person);
    assert.equal(snapshot.person.canonical_name, "Jane Driver");
    assert.ok(snapshot.historical_resonance);
    assert.equal(snapshot.historical_resonance.score, 81.5);
    assert.equal(snapshot.historical_resonance.tier, "ESTABLISHED");
    assert.equal(
      snapshot.historical_resonance.evidence_ref,
      "historical_resonance:77"
    );
    assert.equal(snapshot.provenance.fusion_run_id, "900");

    const evidenceIds = evidenceIdsFromSnapshot(snapshot);
    assert.ok(evidenceIds.has("historical_resonance:77"));
    assert.ok(evidenceIds.has("vehicle_person_link:77"));
    assert.ok(evidenceIds.has("person:55"));
  }

  // NO_PERSON_SIGNAL snapshot: person and historical_resonance
  // must both be null, and no fabricated evidence id appears.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    const snapshot = await buildCandidateSnapshot(pool, "1");

    assert.equal(snapshot.no_person_signal, true);
    assert.equal(snapshot.person, null);
    assert.equal(snapshot.historical_resonance, null);

    const evidenceIds = evidenceIdsFromSnapshot(snapshot);

    for (const id of evidenceIds) {
      assert.ok(!id.startsWith("person:"));
      assert.ok(!id.startsWith("historical_resonance:"));
    }
  }

  // Country News source/time metadata preserved verbatim.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    const snapshot = await buildCandidateSnapshot(pool, "1");

    assert.equal(snapshot.country_news.source, "Example Wire");
    assert.equal(snapshot.country_news.domain, "example.com");
    assert.equal(
      snapshot.country_news.published_at.toISOString(),
      new Date("2026-01-01T00:00:00Z").toISOString()
    );
  }

  // Historical Resonance evidence ref accepted by the Evidence
  // Validator.
  {
    const pool = createMockDb({
      candidates: { 1: seedCandidateWithPerson(1) }
    });

    const snapshot = await buildCandidateSnapshot(pool, "1");
    const evidenceIds = evidenceIdsFromSnapshot(snapshot);

    const outline = {
      outline_title: "T",
      review_summary: "s",
      opening_situation: "A".repeat(100),
      inciting_incident: "A".repeat(100),
      vehicle_and_driver_introduction: "A".repeat(100),
      world_conflict: "A".repeat(100),
      qualifier_challenge: "A".repeat(100),
      escalation: "A".repeat(100),
      choice_or_sacrifice: "A".repeat(100),
      outcome: "A".repeat(100),
      canon_state_impact: {
        state: "PROPOSED_STATE_CHANGE",
        target_state: "QUALIFIER_ENTERED",
        entity_type: "DRIVER",
        previous_state: "CANDIDATE_APPROVED",
        evidence_refs: ["historical_resonance:77"],
        reason: "reason"
      },
      next_episode_hook: "A".repeat(100),
      evidence_map: ["historical_resonance:77"],
      canon_constraints: [],
      forbidden_elements_respected: [],
      short_structure: {
        hook_seconds: 3,
        estimated_duration_seconds: 35,
        narrative_beats: ["beat1"]
      }
    };

    const result = validateOutline(outline, {
      evidenceIds,
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "PASS");
  }

  // A nonexistent historical resonance ref is rejected.
  {
    const pool = createMockDb({
      candidates: { 1: seedCandidateWithPerson(1) }
    });

    const snapshot = await buildCandidateSnapshot(pool, "1");
    const evidenceIds = evidenceIdsFromSnapshot(snapshot);

    const outline = {
      outline_title: "T",
      review_summary: "s",
      opening_situation: "A".repeat(100),
      inciting_incident: "A".repeat(100),
      vehicle_and_driver_introduction: "A".repeat(100),
      world_conflict: "A".repeat(100),
      qualifier_challenge: "A".repeat(100),
      escalation: "A".repeat(100),
      choice_or_sacrifice: "A".repeat(100),
      outcome: "A".repeat(100),
      canon_state_impact: {
        state: "PROPOSED_STATE_CHANGE",
        target_state: "QUALIFIER_ENTERED",
        entity_type: "DRIVER",
        previous_state: "CANDIDATE_APPROVED",
        evidence_refs: [],
        reason: "reason"
      },
      next_episode_hook: "A".repeat(100),
      evidence_map: ["historical_resonance:999999"],
      canon_constraints: [],
      forbidden_elements_respected: [],
      short_structure: {
        hook_seconds: 3,
        estimated_duration_seconds: 35,
        narrative_beats: ["beat1"]
      }
    };

    const result = validateOutline(outline, {
      evidenceIds,
      noPersonSignal: false
    });

    assert.equal(result.validation_status, "BLOCKED");
    assert.ok(result.issues.some(i => i.code === "EVIDENCE_REF_NOT_FOUND"));
  }

  // Snapshot hash is stable after creation, even if the
  // underlying Fusion Candidate source data later changes.
  {
    const pool = createMockDb({ candidates: { 1: seedCandidate(1) } });

    const created = await createStoryRunHandler(pool, { fusion_candidate_id: 1 }, {});
    const runId = created.payload.data.id;
    const originalHash = created.payload.data.candidate_snapshot_hash;

    pool._state.candidates.get("1").vehicle_name = "Changed Name Later";

    const detail = await getStoryRun(pool, runId);

    assert.equal(detail.payload.data.run.candidate_snapshot_hash, originalHash);
    assert.equal(detail.payload.data.candidate_snapshot_summary.vehicle.name, "Test Vehicle");
  }

  console.log("TASK 3.4E STORY API TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

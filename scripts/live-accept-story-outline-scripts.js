// =========================================================
// LIVE ACCEPTANCE: Task 3.6 Outline/Script Integrated Signals,
// against real Gemini AND a real (disposable) Postgres database.
//
// Unlike scripts/live-accept-story-directions.js (which uses an
// in-memory mock pool), this script requires a real Postgres
// connection: migrations 001-016 must already be applied (run
// scripts/ci-run-migrations.js first), because Outline/Script Lock
// and the coverage-continuity validators depend on real JSONB CHECK
// constraints, FK integrity, and transactional ownership semantics
// that a mock cannot exercise faithfully.
//
// Never reuses/regenerates Story Directions -- the "existing
// Integrated Direction" is a small, self-contained fixture chain
// (countries/vehicles/country_news_signals/people/
// vehicle_person_links/vehicle_fusion_candidates/story_pipeline_runs/
// story_directions) inserted directly with plain SQL, exactly the
// upstream shape buildCandidateSnapshot would have produced, so the
// engine's real entrypoints run completely unmodified from there:
//   claimNextStoryRun -> executeOutlineGeneration -> lockOutline ->
//   claimNextStoryRun -> executeScriptsGeneration -> lockScript
//
// generateJson is the real lib/story/provider.js generateJson -- every
// Outline/Script attempt is a real network call to Gemini. Requires
// GEMINI_API_KEY, STORY_GEMINI_MODEL, DATABASE_URL in the environment.
// Refuses to run against anything but a local/CI-service-container
// Postgres host, and never prints any secret.
//
// Never fabricates a result: any assertion failure exits non-zero
// with the real observed data printed first, and no further stage is
// attempted once a stage has failed closed.
// =========================================================

const assert = require("node:assert/strict");
const fs = require("node:fs");
const { Pool } = require("pg");

const {
  claimNextStoryRun,
  executeOutlineGeneration,
  lockOutline,
  executeScriptsGeneration,
  lockScript,
  computeCoverageStatusFromSnapshot
} = require("../lib/story/engine");
const { loadCanonBundle } = require("../lib/story/canon");
const { generateJson, redactSecrets } = require("../lib/story/provider");
const { collectEvidenceRefs } = require("../lib/story/validators");

const WORKER_ID = "live-acceptance-3-6";
const LOCKED_BEAT_ID = "BEAT-04";

// =========================================================
// Safety: this script must never run against anything but a local
// disposable database. DATABASE_URL is supplied by the CI service
// container (or a developer's own local instance) -- it is never
// printed, only its hostname is inspected.
// =========================================================

function assertLocalDatabaseHost() {
  const raw = process.env.DATABASE_URL || "";
  let host;

  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error("DATABASE_URL is not a valid connection string.");
  }

  const allowedHosts = new Set(["localhost", "127.0.0.1", "postgres"]);

  if (!allowedHosts.has(host)) {
    throw new Error(
      `Refusing to run: DATABASE_URL host "${host}" is not a recognized local/CI-service-container host. ` +
        "This script must only ever target a disposable Postgres instance, never production."
    );
  }
}

function jsonEqual(a, b) {
  try {
    assert.deepStrictEqual(a, b);
    return true;
  } catch {
    return false;
  }
}

// =========================================================
// FIXTURE CHAIN -- a minimal, self-contained upstream FK chain
// (never touching Fusion scoring/Scanner/CountryNews/Person engines)
// so that story_pipeline_runs.fusion_candidate_id has a real row to
// reference, matching exactly what buildCandidateSnapshot would read.
// =========================================================

async function insertFixtureChain(pool) {
  // JP is already seeded by the migrations (db/migrations/002_seed_data.sql)
  // -- re-inserting it here collides with the countries_code_key unique
  // constraint. Reuse the existing seeded row instead of creating a new one.
  const country = await pool.query(`SELECT id FROM countries WHERE code = $1`, ["JP"]);

  if (country.rowCount !== 1 || !country.rows[0] || country.rows[0].id === undefined) {
    throw new Error(
      "LIVE_ACCEPTANCE_COUNTRY_SEED_MISSING: expected exactly one seeded country row with code=JP " +
        `(found rowCount=${country.rowCount}). Migrations may not have been applied to this database.`
    );
  }

  const countryId = country.rows[0].id;

  const vehicle = await pool.query(
    `INSERT INTO vehicles (code, name, manufacturer, country_id, category)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      "LIVE36VEHICLE",
      "Live Acceptance Vehicle",
      "Live Acceptance Manufacturer",
      countryId,
      "Sports Car"
    ]
  );
  const vehicleId = vehicle.rows[0].id;

  const countryNews = await pool.query(
    `INSERT INTO country_news_signals (
       country_id, story_hash, canonical_title, title, representative_url,
       representative_source, representative_domain, category, provider,
       resolver_version, published_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     RETURNING id`,
    [
      countryId,
      `live-3-6-${Date.now()}`,
      "Live acceptance regulatory scrutiny tightens on manual overrides",
      "Live acceptance regulatory scrutiny tightens on manual overrides",
      "https://example.com/live-acceptance-news",
      "Example Wire",
      "example.com",
      "POLITICS_POLICY",
      "GOOGLE_NEWS_RSS",
      "live-acceptance-v1"
    ]
  );
  const countryNewsId = countryNews.rows[0].id;

  const person = await pool.query(
    `INSERT INTO people (slug, canonical_name, country_id, role_category)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [`live-3-6-keiichi-tsuchiya-${Date.now()}`, "Keiichi Tsuchiya", countryId, "DRIVER_RACER"]
  );
  const personId = person.rows[0].id;

  const link = await pool.query(
    `INSERT INTO vehicle_person_links (
       person_id, vehicle_id, relation_type, link_method,
       evidence_horizon, historical_resonance_score, historical_resonance_tier,
       resonance_version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [personId, vehicleId, "DRIVER", "CATALOG", "TEN_YEARS", 81.5, "ESTABLISHED", "resonance-v1"]
  );
  const vehiclePersonLinkId = link.rows[0].id;

  const fusionRun = await pool.query(
    `INSERT INTO fusion_runs (status) VALUES ('COMPLETED') RETURNING id`
  );
  const fusionRunId = fusionRun.rows[0].id;

  const fusionCandidate = await pool.query(
    `INSERT INTO vehicle_fusion_candidates (
       run_id, vehicle_id, country_id, country_news_signal_id,
       person_id, vehicle_person_link_id, person_link_tier,
       vehicle_traffic_score, country_news_category, country_news_traffic_proxy_score,
       transformation_potential_score, fusion_score, fusion_version,
       missing_signals, is_complete
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
     RETURNING id`,
    [
      fusionRunId,
      vehicleId,
      countryId,
      countryNewsId,
      personId,
      vehiclePersonLinkId,
      "EXACT_VEHICLE",
      72.5,
      "POLITICS_POLICY",
      65.0,
      70.0,
      78.0,
      "live-acceptance-v1",
      "[]",
      true
    ]
  );
  const fusionCandidateId = fusionCandidate.rows[0].id;

  return { countryId, vehicleId, countryNewsId, personId, vehiclePersonLinkId, fusionCandidateId };
}

function buildEvidenceRefs(ids) {
  return {
    vehicle: `vehicle:${ids.vehicleId}`,
    countryNews: `country_news:${ids.countryNewsId}`,
    person: `person:${ids.personId}`,
    historicalResonance: `historical_resonance:${ids.vehiclePersonLinkId}`
  };
}

function buildCandidateSnapshotFixture(ids, refs) {
  return {
    fusion_candidate_id: String(ids.fusionCandidateId),
    vehicle: {
      id: String(ids.vehicleId),
      code: "LIVE36VEHICLE",
      name: "Live Acceptance Vehicle",
      manufacturer: "Live Acceptance Manufacturer"
    },
    country: { id: String(ids.countryId), code: "JP", name: "Japan" },
    country_news: {
      id: String(ids.countryNewsId),
      title: "Live acceptance regulatory scrutiny tightens on manual overrides"
    },
    person: { id: String(ids.personId), canonical_name: "Keiichi Tsuchiya" },
    historical_resonance: { id: String(ids.vehiclePersonLinkId) },
    no_person_signal: false,
    evidence: [
      { id: refs.vehicle, type: "VEHICLE" },
      { id: refs.countryNews, type: "COUNTRY_NEWS" },
      { id: refs.person, type: "PERSON" },
      { id: refs.historicalResonance, type: "HISTORICAL_RESONANCE" }
    ]
  };
}

// Same narrative shape as scripts/test-story-worker.js's
// makeRegressionDirection fixture -- a coherent premise, not
// placeholder text, since this becomes real context handed to Gemini.
function buildFixtureDirectionPayload(refs, coverageStatus) {
  return {
    direction_id: "DIR-LIVE-3-6-001",
    direction_type: "INTEGRATED_STORY",
    narrative_emphasis: "TECHNICAL_SACRIFICE",
    title: "The Override Under Watch",
    review_summary:
      "A qualifier where an inherited manual-override instinct collides with new regulatory surveillance.",
    hook: "One override, one inspection window, one shot at the qualifier.",
    logline:
      "A drift-lineage driver must risk a single manual override against a newly-scrutinized inspection regime to pass a GLOBAL_QUALIFIERS qualifier.",
    core_conflict:
      "The vehicle's one legal manual override collides with a regulatory inspection regime that treats any override as suspect.",
    why_now:
      "The country's new oversight agency just tightened inspection of manual-override systems, forcing the choice into this qualifier.",
    signal_contributions: {
      vehicle: {
        evidence_refs: [refs.vehicle],
        story_function: "grounds the qualifying stakes in a real, limited technical resource",
        preserved_traits: ["responsive handling"],
        transformed_traits: ["livery"]
      },
      country: {
        evidence_refs: [refs.countryNews],
        story_function: "raises external regulatory pressure on the qualifier",
        dc2100_pressure: "the new oversight agency scrutinizes manual-override use during qualifiers",
        direct_effect_on_story:
          "the inspection regime restricts when the override may be used without disqualification risk"
      },
      person: {
        evidence_refs: [refs.person, refs.historicalResonance],
        story_function: "shapes the driver's instinct to trust manual control over automation",
        fictionalized_trait: "an old-school drift lineage that distrusts full automation",
        historical_resonance_used: refs.historicalResonance
      },
      apex: {
        beat_id: LOCKED_BEAT_ID,
        stage: "GLOBAL_QUALIFIERS",
        rule_used: "manual override qualification rule",
        qualification_objective:
          "finish the qualifying stage within the time limit using at most one manual override",
        failure_condition:
          "a second override use during the inspection window disqualifies the entrant",
        resource_or_scoring_constraint: "exactly one manual override is available for the whole qualifier"
      }
    },
    vehicle_transformation: {
      evidence_vehicle: "Live Acceptance Vehicle",
      canon_vehicle_name: "Fictional Override Prime",
      preserved_traits: ["responsive handling"],
      changed_traits: ["livery"],
      official_partnership_implied: false
    },
    character_concept: {
      canon_driver_name: "Fictional Driver Kaito Mizuno",
      canon_team_name: "Fictional Override Syndicate",
      motivation: "prove that manual skill still has a place under full regulatory scrutiny",
      internal_conflict: "trusting instinct against trusting the system that is now watching every override",
      person_signal_influence:
        "draws his refusal to fully trust automation from a historical drift lineage that always kept a hand on the wheel"
    },
    causal_chain: [
      "the oversight agency tightens inspection of manual-override systems ahead of the qualifier",
      "this forces the team to plan exactly one legal override use for the whole qualifying run",
      "the vehicle's technical limit means a second override triggers automatic disqualification",
      "the driver draws on his drift heritage to decide the exact moment to risk the override",
      "this produces a concrete APEX qualifying choice under the single-override constraint",
      "the qualifier result and a Canon state change follow directly from that choice"
    ],
    driver_choice: {
      option_a: "use the override early to secure a clean qualifying line",
      option_b: "hold the override in reserve for the final inspected sector",
      immediate_consequence: "using it early risks a worse position if conditions worsen later",
      long_term_cost: "holding it back risks running out of clean racing line before the override is ever used"
    },
    canon_connections: [],
    season_function: "establishes this driver as someone who wins under regulatory pressure rather than around it",
    proposed_state_changes: [],
    next_episode_hook: "the inspection agency flags this qualifier for a follow-up review",
    risk_flags: [],
    coverage_status: coverageStatus
  };
}

async function insertRunRow(pool, { fusionCandidateId, canonBundle, snapshot }) {
  const result = await pool.query(
    `
      INSERT INTO story_pipeline_runs (
        fusion_candidate_id, status, current_stage,
        candidate_snapshot, candidate_snapshot_hash,
        canon_version, rules_version, season_version, canon_hash,
        candidate_slot_id, beat_id, apex_stage,
        forbidden_elements, review_language, script_language,
        selected_direction_ids, selection_mode,
        attempt_count, stage_attempt_count
      ) VALUES (
        $1, 'QUEUED_OUTLINE', 'QUEUED_OUTLINE',
        $2::jsonb, $3,
        $4, $5, $6, $7,
        $8, $9, $10,
        '[]'::jsonb, $11, $12,
        '[]'::jsonb, $13,
        0, 0
      )
      RETURNING id
    `,
    [
      fusionCandidateId,
      JSON.stringify(snapshot),
      "sha256:live-3-6-fixed",
      canonBundle.canon_version,
      canonBundle.rules_version,
      canonBundle.season_version,
      canonBundle.canon_hash,
      "CANDIDATE_SLOT_01",
      LOCKED_BEAT_ID,
      "GLOBAL_QUALIFIERS",
      "en",
      "en",
      "SINGLE"
    ]
  );

  return result.rows[0].id;
}

async function insertDirectionRow(pool, runId, payload) {
  const result = await pool.query(
    `
      INSERT INTO story_directions (
        story_run_id, version, direction_key, direction_type,
        payload, validation_status, validation_issues
      ) VALUES ($1, 1, $2, 'INTEGRATED_STORY', $3::jsonb, 'PASS', '[]'::jsonb)
      RETURNING id
    `,
    [runId, payload.direction_id, JSON.stringify(payload)]
  );

  return result.rows[0].id;
}

async function fetchAttempts(pool, runId, stage) {
  const result = await pool.query(
    `
      SELECT * FROM story_generation_attempts
      WHERE story_run_id = $1 AND stage = $2
      ORDER BY attempt_number ASC, id ASC
    `,
    [runId, stage]
  );

  return result.rows;
}

function summarizeAttempts(rows) {
  return rows.map(row => ({
    attempt_number: row.attempt_number,
    status: row.status,
    model: row.model,
    validation_status: row.validation_status,
    issue_codes: row.issue_codes,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
    total_tokens: row.total_tokens,
    latency_ms: row.latency_ms
  }));
}

function sumField(rows, field) {
  return rows.reduce((sum, row) => sum + Number(row[field] || 0), 0);
}

// =========================================================
// FAILURE DIAGNOSTICS -- called before throwing whenever
// executeOutlineGeneration/executeScriptsGeneration return
// outcome === "RUN_FAILED", so a real provider/generation failure is
// never reported as a bare "did not advance" with no way to diagnose
// it afterward. Only ever reads columns that are already safe by
// construction (recordGenerationAttempt/persistStageFailure never
// store request_payload, prompts, or raw secrets -- see engine.js),
// and redacts error_code/error_message/event payloads through
// redactSecrets (with the real GEMINI_API_KEY as an extra explicit
// secret to strip) before printing, as one more defensive layer.
// Never queries or prints request_payload, prompt text, API keys,
// DATABASE_URL, other environment variables, or headers.
// =========================================================

async function printStageFailureDiagnostics(pool, runId, stage) {
  const secrets = [process.env.GEMINI_API_KEY].filter(Boolean);

  function redactValue(value) {
    return value === null || value === undefined ? value : redactSecrets(String(value), secrets);
  }

  function redactPayload(payload) {
    if (payload === null || payload === undefined) {
      return null;
    }
    try {
      return JSON.parse(redactSecrets(JSON.stringify(payload), secrets));
    } catch {
      return "(unprintable payload, redaction failed closed)";
    }
  }

  const runResult = await pool.query(
    `
      SELECT id, status, current_stage, failure_stage, error_code, error_message,
        attempt_count, stage_attempt_count
      FROM story_pipeline_runs
      WHERE id = $1
    `,
    [runId]
  );

  const runRow = runResult.rows[0] || null;
  const run = runRow && {
    id: String(runRow.id),
    status: runRow.status,
    current_stage: runRow.current_stage,
    failure_stage: runRow.failure_stage,
    error_code: redactValue(runRow.error_code),
    error_message: redactValue(runRow.error_message),
    attempt_count: runRow.attempt_count,
    stage_attempt_count: runRow.stage_attempt_count
  };

  const attemptResult = await pool.query(
    `
      SELECT stage, status, provider, model, attempt_number, validation_status,
        issue_codes, input_tokens, output_tokens, total_tokens, latency_ms,
        error_code, error_message
      FROM story_generation_attempts
      WHERE story_run_id = $1 AND stage = $2
      ORDER BY attempt_number DESC, id DESC
      LIMIT 1
    `,
    [runId, stage]
  );

  const attemptRow = attemptResult.rows[0] || null;
  const latestAttempt = attemptRow && {
    stage: attemptRow.stage,
    status: attemptRow.status,
    provider: attemptRow.provider,
    model: attemptRow.model,
    attempt_number: attemptRow.attempt_number,
    validation_status: attemptRow.validation_status,
    issue_codes: attemptRow.issue_codes,
    input_tokens: attemptRow.input_tokens,
    output_tokens: attemptRow.output_tokens,
    total_tokens: attemptRow.total_tokens,
    latency_ms: attemptRow.latency_ms,
    error_code: redactValue(attemptRow.error_code),
    error_message: redactValue(attemptRow.error_message)
  };

  const eventResult = await pool.query(
    `
      SELECT event_type, stage, payload, created_at
      FROM story_pipeline_events
      WHERE story_run_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 5
    `,
    [runId]
  );

  const recentEvents = eventResult.rows.map(row => ({
    event_type: row.event_type,
    stage: row.stage,
    payload: redactPayload(row.payload),
    created_at: row.created_at
  }));

  console.error(`STAGE FAILURE DIAGNOSTICS (${stage})`);
  console.error("story_pipeline_runs:", JSON.stringify(run));
  console.error("story_generation_attempts (latest for stage):", JSON.stringify(latestAttempt));
  console.error("story_pipeline_events (last 5):", JSON.stringify(recentEvents));

  return { run, latestAttempt, recentEvents };
}

async function main() {
  assert.ok(process.env.GEMINI_API_KEY, "GEMINI_API_KEY must be set for a live acceptance run.");
  assert.ok(process.env.STORY_GEMINI_MODEL, "STORY_GEMINI_MODEL must be set for a live acceptance run.");
  assert.ok(process.env.DATABASE_URL, "DATABASE_URL must be set for a live acceptance run.");
  assertLocalDatabaseHost();

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const failures = [];
  function check(label, condition) {
    if (!condition) failures.push(label);
  }

  let runId = null;
  let outlineTokenSummary = null;
  let scriptTokenSummary = null;
  let outlineAttemptsSummary = [];
  let scriptAttemptsSummary = [];
  let finalRunStatus = null;

  try {
    const canonBundle = loadCanonBundle();

    // ---- Fixture: an existing, already-selected Integrated Direction ----
    const ids = await insertFixtureChain(pool);
    const refs = buildEvidenceRefs(ids);
    const allowlist = [refs.vehicle, refs.countryNews, refs.person, refs.historicalResonance];
    const snapshot = buildCandidateSnapshotFixture(ids, refs);
    const coverageStatus = computeCoverageStatusFromSnapshot(snapshot);

    runId = await insertRunRow(pool, { fusionCandidateId: ids.fusionCandidateId, canonBundle, snapshot });
    const directionPayload = buildFixtureDirectionPayload(refs, coverageStatus);
    const directionId = await insertDirectionRow(pool, runId, directionPayload);
    await pool.query(
      `UPDATE story_pipeline_runs SET selected_direction_ids = $1::jsonb WHERE id = $2`,
      [JSON.stringify([String(directionId)]), runId]
    );

    console.log("FIXTURE CREATED (real Postgres, disposable)");
    console.log(JSON.stringify({ runId: String(runId), directionId: String(directionId), lockedBeatId: LOCKED_BEAT_ID }));

    // =====================================================
    // 1. Existing Integrated Direction sanity check
    // =====================================================
    const dsc = directionPayload.signal_contributions;
    check("Direction: vehicle signal present", dsc.vehicle.evidence_refs.includes(refs.vehicle));
    check("Direction: country signal present", dsc.country.evidence_refs.includes(refs.countryNews));
    check("Direction: person signal present", dsc.person.evidence_refs.includes(refs.person));
    check("Direction: historical resonance present", dsc.person.evidence_refs.includes(refs.historicalResonance));
    check("Direction: APEX constraint present", Boolean(dsc.apex.rule_used && dsc.apex.failure_condition));
    check("Direction: locked beat matches", dsc.apex.beat_id === LOCKED_BEAT_ID);
    check(
      "Direction: evidence refs within allowlist",
      [...dsc.vehicle.evidence_refs, ...dsc.country.evidence_refs, ...dsc.person.evidence_refs].every(
        ref => allowlist.includes(ref)
      )
    );

    // =====================================================
    // 2. Outline Generation
    // =====================================================
    const claimOutline = await claimNextStoryRun(pool, WORKER_ID);
    check(
      "Outline stage claimed",
      Boolean(claimOutline) && claimOutline.outcome === "CLAIMED" && claimOutline.stage === "OUTLINE"
    );

    if (!claimOutline || claimOutline.outcome !== "CLAIMED") {
      throw new Error("Failed to claim OUTLINE stage -- aborting before any Gemini call.");
    }

    const outlineResult = await executeOutlineGeneration(pool, claimOutline.run, {
      loadCanonBundle: () => canonBundle,
      generateJson
    });

    const outlineAttemptRows = await fetchAttempts(pool, runId, "OUTLINE");
    outlineAttemptsSummary = summarizeAttempts(outlineAttemptRows);
    outlineTokenSummary = {
      attempt_count: outlineAttemptRows.length,
      total_input_tokens: sumField(outlineAttemptRows, "input_tokens"),
      total_output_tokens: sumField(outlineAttemptRows, "output_tokens"),
      total_tokens: sumField(outlineAttemptRows, "total_tokens"),
      total_latency_ms: sumField(outlineAttemptRows, "latency_ms")
    };

    console.log("OUTLINE ATTEMPTS (REAL GEMINI)");
    console.log(JSON.stringify(outlineAttemptsSummary));

    check("Outline generation reached STAGE_ADVANCED", outlineResult.outcome === "STAGE_ADVANCED");

    if (outlineResult.outcome === "RUN_FAILED") {
      const diagnostics = await printStageFailureDiagnostics(pool, runId, "OUTLINE");
      const failedRun = diagnostics.run;
      throw new Error(
        "Outline generation failed (outcome=RUN_FAILED) -- aborting before Outline Lock / Scripts. " +
          `failure_stage=${failedRun ? failedRun.failure_stage : "unknown"}, ` +
          `error_code=${failedRun ? failedRun.error_code : "unknown"}, ` +
          `error_message=${failedRun ? JSON.stringify(failedRun.error_message) : "unknown"}`
      );
    }

    if (outlineResult.outcome !== "STAGE_ADVANCED") {
      throw new Error(
        `Outline generation did not advance (outcome=${outlineResult.outcome}) -- aborting before Outline Lock / Scripts.`
      );
    }

    const outlineRow = (
      await pool.query(
        `SELECT * FROM story_outlines WHERE story_run_id = $1 ORDER BY version DESC LIMIT 1`,
        [runId]
      )
    ).rows[0];

    check("Outline validation_status is PASS", outlineRow.validation_status === "PASS");

    if (outlineRow.validation_status !== "PASS") {
      throw new Error(
        `Outline is BLOCKED after ${outlineAttemptRows.length} attempt(s) -- aborting before Outline Lock / Scripts. ` +
          `issues=${JSON.stringify(outlineRow.validation_issues)}`
      );
    }

    check("Outline signal_contributions mechanically inherited", jsonEqual(outlineRow.signal_contributions, dsc));
    check("Outline coverage_status mechanically inherited", jsonEqual(outlineRow.coverage_status, coverageStatus));
    check(
      "Outline source_direction_ids correct",
      jsonEqual(outlineRow.source_direction_ids, [String(directionId)])
    );
    check("Outline locked_beat_id correct", outlineRow.locked_beat_id === LOCKED_BEAT_ID);

    const outlineOwnRefs = collectEvidenceRefs(outlineRow.payload);
    check("Outline evidence refs within allowlist", outlineOwnRefs.every(ref => allowlist.includes(ref)));
    check("Outline includes person:* ref", outlineOwnRefs.includes(refs.person));
    check("Outline includes historical_resonance:* ref", outlineOwnRefs.includes(refs.historicalResonance));

    // =====================================================
    // 3. Outline Lock
    // =====================================================
    const lockedOutlineRun = await lockOutline(pool, runId, {
      approved_by: "michael",
      outline_id: outlineRow.id
    });

    check("Outline lock advanced run to QUEUED_SCRIPTS", lockedOutlineRun.status === "QUEUED_SCRIPTS");

    if (lockedOutlineRun.status !== "QUEUED_SCRIPTS") {
      throw new Error(`Outline lock did not advance the run (status=${lockedOutlineRun.status}) -- aborting.`);
    }

    // =====================================================
    // 4. Script Generation
    // =====================================================
    const claimScripts = await claimNextStoryRun(pool, WORKER_ID);
    check(
      "Scripts stage claimed (run reached GENERATING_SCRIPTS)",
      Boolean(claimScripts) && claimScripts.outcome === "CLAIMED" && claimScripts.stage === "SCRIPTS"
    );

    if (!claimScripts || claimScripts.outcome !== "CLAIMED") {
      throw new Error("Failed to claim SCRIPTS stage -- aborting before any Gemini call.");
    }

    const scriptsResult = await executeScriptsGeneration(pool, claimScripts.run, {
      loadCanonBundle: () => canonBundle,
      generateJson
    });

    const scriptAttemptRows = await fetchAttempts(pool, runId, "SCRIPTS");
    scriptAttemptsSummary = summarizeAttempts(scriptAttemptRows);
    scriptTokenSummary = {
      attempt_count: scriptAttemptRows.length,
      total_input_tokens: sumField(scriptAttemptRows, "input_tokens"),
      total_output_tokens: sumField(scriptAttemptRows, "output_tokens"),
      total_tokens: sumField(scriptAttemptRows, "total_tokens"),
      total_latency_ms: sumField(scriptAttemptRows, "latency_ms")
    };

    console.log("SCRIPT ATTEMPTS (REAL GEMINI)");
    console.log(JSON.stringify(scriptAttemptsSummary));

    check("Script generation reached STAGE_ADVANCED", scriptsResult.outcome === "STAGE_ADVANCED");

    if (scriptsResult.outcome === "RUN_FAILED") {
      const diagnostics = await printStageFailureDiagnostics(pool, runId, "SCRIPTS");
      const failedRun = diagnostics.run;
      throw new Error(
        "Script generation failed (outcome=RUN_FAILED) -- aborting. " +
          `failure_stage=${failedRun ? failedRun.failure_stage : "unknown"}, ` +
          `error_code=${failedRun ? failedRun.error_code : "unknown"}, ` +
          `error_message=${failedRun ? JSON.stringify(failedRun.error_message) : "unknown"}`
      );
    }

    if (scriptsResult.outcome !== "STAGE_ADVANCED") {
      throw new Error(`Script generation did not advance (outcome=${scriptsResult.outcome}) -- aborting.`);
    }

    const scriptRows = (
      await pool.query(
        `SELECT * FROM story_scripts WHERE story_run_id = $1 ORDER BY variant_type ASC`,
        [runId]
      )
    ).rows;

    check("Exactly 3 script variants persisted", scriptRows.length === 3);

    const variantTypes = scriptRows.map(row => row.variant_type).sort();
    check(
      "Variant types unique and complete (VEHICLE_FIRST/WORLD_FIRST/CHARACTER_FIRST)",
      jsonEqual(variantTypes, ["CHARACTER_FIRST", "VEHICLE_FIRST", "WORLD_FIRST"])
    );

    const perScriptStatuses = {};
    const batchBlocked = scriptRows.some(row =>
      (row.validation_issues || []).some(issue => issue.code === "SCRIPT_BATCH_BLOCKED")
    );
    const batchValidationStatus =
      !batchBlocked && scriptRows.every(row => row.validation_status === "PASS") ? "PASS" : "BLOCKED";

    for (const row of scriptRows) {
      perScriptStatuses[row.variant_type] = row.validation_status;

      check(`${row.variant_type}: validation_status is PASS`, row.validation_status === "PASS");
      check(
        `${row.variant_type}: no SCRIPT_BATCH_BLOCKED issue`,
        !(row.validation_issues || []).some(issue => issue.code === "SCRIPT_BATCH_BLOCKED")
      );
      check(
        `${row.variant_type}: source_outline_id correct`,
        String(row.source_outline_id) === String(outlineRow.id)
      );
      check(`${row.variant_type}: locked_beat_id correct`, row.locked_beat_id === LOCKED_BEAT_ID);
      check(
        `${row.variant_type}: coverage_status inherited from locked Outline`,
        jsonEqual(row.coverage_status, outlineRow.coverage_status)
      );

      const ownRefs = collectEvidenceRefs(row.payload);
      check(`${row.variant_type}: evidence refs within allowlist`, ownRefs.every(ref => allowlist.includes(ref)));
      check(`${row.variant_type}: includes person:* ref`, ownRefs.includes(refs.person));
      check(`${row.variant_type}: includes historical_resonance:* ref`, ownRefs.includes(refs.historicalResonance));
    }

    console.log("SCRIPT BATCH RESULT");
    console.log(JSON.stringify({ batch_validation_status: batchValidationStatus, per_script: perScriptStatuses }));

    // =====================================================
    // 5. Script Lock
    // =====================================================
    const passScript = scriptRows.find(row => row.validation_status === "PASS");
    check("At least one PASS script variant to lock", Boolean(passScript));

    const blockedScript = scriptRows.find(row => row.validation_status === "BLOCKED");
    if (blockedScript) {
      try {
        await lockScript(pool, runId, { approved_by: "michael", script_id: blockedScript.id });
        failures.push(`BLOCKED script ${blockedScript.variant_type} was lockable (expected VALIDATION_BLOCKED)`);
      } catch (error) {
        check(
          "BLOCKED script rejected with VALIDATION_BLOCKED",
          error.storyCode === "VALIDATION_BLOCKED"
        );
      }
    }

    if (passScript) {
      const lockedScriptRun = await lockScript(pool, runId, {
        approved_by: "michael",
        script_id: passScript.id
      });

      finalRunStatus = lockedScriptRun.status;

      check(
        "Script lock: selected_script_id correct",
        String(lockedScriptRun.selected_script_id) === String(passScript.id)
      );
      check("Final Story Run status is COMPLETED", lockedScriptRun.status === "COMPLETED");
    }

    // =====================================================
    // Final report
    // =====================================================
    const totalGeminiCalls = outlineAttemptRows.length + scriptAttemptRows.length;
    const totalTokens = outlineTokenSummary.total_tokens + scriptTokenSummary.total_tokens;
    const totalLatencyMs = outlineTokenSummary.total_latency_ms + scriptTokenSummary.total_latency_ms;

    const metrics = {
      outline: outlineTokenSummary,
      scripts: scriptTokenSummary,
      total_gemini_calls: totalGeminiCalls,
      total_tokens: totalTokens,
      total_latency_ms: totalLatencyMs,
      final_run_status: finalRunStatus
    };

    console.log("LIVE METRICS (REAL, NOT FIXTURE)");
    console.log(JSON.stringify(metrics));

    console.log("ACCEPTANCE RESULT");
    if (failures.length > 0) {
      console.log(JSON.stringify({ result: "FAIL", failures }, null, 2));
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify({ result: "PASS", failures: [] }, null, 2));
    }

    if (process.env.GITHUB_STEP_SUMMARY) {
      fs.appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `\n## Task 3.6 Outline/Script live acceptance (real Gemini + real Postgres)\n\n` +
          "```json\n" + JSON.stringify({ metrics, outlineAttemptsSummary, scriptAttemptsSummary }, null, 2) + "\n```\n"
      );
    }
  } catch (error) {
    console.error("LIVE ACCEPTANCE SCRIPT ERROR", error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  assertLocalDatabaseHost,
  jsonEqual,
  insertFixtureChain,
  buildEvidenceRefs,
  buildCandidateSnapshotFixture,
  buildFixtureDirectionPayload,
  insertRunRow,
  insertDirectionRow,
  fetchAttempts,
  summarizeAttempts,
  printStageFailureDiagnostics,
  main
};

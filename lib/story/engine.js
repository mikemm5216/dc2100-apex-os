// =========================================================
// STORY / OUTLINE / SCRIPT PIPELINE ENGINE — Task 3.4E
//
// State machine + Human Gates for turning one persisted
// Fusion Candidate into four Story Directions, one locked
// Outline, and one locked Script. Never touches the source
// vehicle_fusion_candidates row. Never writes
// CANON_STATE_COMMITTED. Every state change this pipeline
// produces is a Story Run status transition, not a Canon
// commit.
// =========================================================

const crypto = require("node:crypto");

const { loadCanonBundle } = require("./canon");
const { generateJson, redactSecrets } = require("./provider");
const {
  buildDirectionsPrompt,
  buildOutlinePrompt,
  buildScriptsPrompt
} = require("./prompts");
const {
  validateDirectionShape,
  validateScriptShape,
  validateScriptBatchShape,
  validateOutlineShape,
  computeScriptDuration,
  countEnglishWords,
  isPlainObject,
  issue,
  DIRECTION_JSON_SCHEMA,
  STORY_OUTLINE_RESPONSE_JSON_SCHEMA,
  SCRIPT_JSON_SCHEMA,
  SCRIPT_VARIANT_TYPES,
  INTEGRATED_STORY_DIRECTION_TYPE,
  NARRATIVE_EMPHASIS_TYPES,
  isIntegratedOutlineCoverage,
  isIntegratedScriptCoverage
} = require("./schemas");
const {
  CANON_STATE_TRANSITIONS,
  validateDirection,
  validateDirectionBatch,
  validateOutline,
  validateScript
} = require("./validators");
const { MISSING_SIGNALS } = require("../fusion/scoring");

class StoryError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = "StoryError";
    this.storyCode = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

const STORY_STATUSES = [
  "AWAITING_CANDIDATE_APPROVAL",
  "QUEUED_DIRECTIONS",
  "GENERATING_DIRECTIONS",
  "AWAITING_DIRECTION_SELECTION",
  "QUEUED_OUTLINE",
  "GENERATING_OUTLINE",
  "AWAITING_OUTLINE_LOCK",
  "QUEUED_SCRIPTS",
  "GENERATING_SCRIPTS",
  "AWAITING_SCRIPT_LOCK",
  "COMPLETED",
  "FAILED",
  "CANCELLED"
];

const TERMINAL_STATUSES = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED"
]);

const STAGE_CONFIG = {
  DIRECTIONS: {
    queued: "QUEUED_DIRECTIONS",
    generating: "GENERATING_DIRECTIONS",
    awaiting: "AWAITING_DIRECTION_SELECTION"
  },
  OUTLINE: {
    queued: "QUEUED_OUTLINE",
    generating: "GENERATING_OUTLINE",
    awaiting: "AWAITING_OUTLINE_LOCK"
  },
  SCRIPTS: {
    queued: "QUEUED_SCRIPTS",
    generating: "GENERATING_SCRIPTS",
    awaiting: "AWAITING_SCRIPT_LOCK"
  }
};

const STAGE_BY_QUEUED_STATUS = Object.fromEntries(
  Object.entries(STAGE_CONFIG).map(([stage, cfg]) => [cfg.queued, stage])
);

const STAGE_BY_GENERATING_STATUS = Object.fromEntries(
  Object.entries(STAGE_CONFIG).map(([stage, cfg]) => [cfg.generating, stage])
);

const STORY_LEASE_DURATION_MS = 5 * 60 * 1000;
const STORY_MAX_STAGE_ATTEMPTS = 3;

const APEX_STAGE_ALLOWLIST = [
  "GLOBAL_QUALIFIERS",
  "REGIONAL_QUALIFIERS",
  "UNDERGROUND_CIRCUIT",
  "APEX_WORLD_TOUR",
  "FINAL_CHAMPIONSHIP"
];

const CANDIDATE_SLOT_PATTERN = /^CANDIDATE_SLOT_(0[1-9]|1[0-5])$/;
const BEAT_ID_PATTERN = /^BEAT-(0[1-9]|1[0-5])$/;
const LANGUAGE_PATTERN = /^[a-zA-Z]{2}(-[a-zA-Z]{2,8})?$/;

function fail(code, message, statusCode = 400, details = {}) {
  throw new StoryError(code, message, statusCode, details);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

// =========================================================
// CANDIDATE SNAPSHOT
// =========================================================

async function buildCandidateSnapshot(pool, fusionCandidateId) {
  const result = await pool.query(
    `
      SELECT
        vfc.id,
        vfc.run_id AS fusion_run_id,
        vfc.vehicle_id,
        v.code AS vehicle_code,
        v.name AS vehicle_name,
        v.manufacturer AS vehicle_manufacturer,
        v.category AS vehicle_category,
        vfc.country_id,
        c.code AS country_code,
        c.name AS country_name,
        vfc.country_news_signal_id,
        cns.title AS country_news_title,
        cns.canonical_title AS country_news_canonical_title,
        cns.representative_url AS country_news_url,
        cns.representative_source AS country_news_source,
        cns.representative_domain AS country_news_domain,
        cns.category AS country_news_category,
        cns.provider AS country_news_provider,
        cns.published_at AS country_news_published_at,
        cns.first_seen_at AS country_news_first_seen_at,
        cns.created_at AS country_news_created_at,
        vfc.person_id,
        p.slug AS person_slug,
        p.canonical_name AS person_canonical_name,
        p.aliases AS person_aliases,
        p.role_category AS person_role_category,
        vfc.vehicle_person_link_id,
        vfc.person_link_tier,
        vpl.relation_type AS link_relation_type,
        vpl.link_confidence AS link_confidence,
        vpl.link_method AS link_method,
        vpl.evidence_horizon AS resonance_evidence_horizon,
        vpl.historical_resonance_score AS resonance_score,
        vpl.historical_resonance_tier AS resonance_tier,
        vpl.resonance_evidence AS resonance_evidence,
        vpl.resonance_version AS resonance_version,
        pts.representative_url AS person_traffic_url,
        pts.representative_source AS person_traffic_source,
        pts.representative_domain AS person_traffic_domain,
        pts.first_seen_at AS person_traffic_first_seen_at,
        vfc.missing_signals,
        vfc.is_complete,
        vfc.fusion_evidence,
        vfc.fusion_score,
        vfc.fusion_version,
        vfc.created_at AS candidate_created_at
      FROM vehicle_fusion_candidates vfc
      JOIN vehicles v ON v.id = vfc.vehicle_id
      LEFT JOIN countries c ON c.id = vfc.country_id
      LEFT JOIN country_news_signals cns
        ON cns.id = vfc.country_news_signal_id
      LEFT JOIN people p ON p.id = vfc.person_id
      LEFT JOIN vehicle_person_links vpl
        ON vpl.id = vfc.vehicle_person_link_id
      LEFT JOIN person_traffic_signals pts
        ON pts.person_id = vfc.person_id
      WHERE vfc.id = $1
    `,
    [fusionCandidateId]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const row = result.rows[0];

  const evidence = [
    {
      id: `vehicle:${row.vehicle_id}`,
      type: "VEHICLE",
      code: row.vehicle_code,
      name: row.vehicle_name,
      manufacturer: row.vehicle_manufacturer
    }
  ];

  if (row.country_news_signal_id) {
    evidence.push({
      id: `country_news:${row.country_news_signal_id}`,
      type: "COUNTRY_NEWS",
      title: row.country_news_title,
      url: row.country_news_url,
      category: row.country_news_category,
      source: row.country_news_source,
      published_at: row.country_news_published_at
    });
  }

  if (row.person_id) {
    evidence.push({
      id: `person:${row.person_id}`,
      type: "PERSON",
      slug: row.person_slug,
      canonical_name: row.person_canonical_name
    });
  }

  if (row.vehicle_person_link_id) {
    evidence.push({
      id: `vehicle_person_link:${row.vehicle_person_link_id}`,
      type: "VEHICLE_PERSON_LINK",
      tier: row.person_link_tier,
      relation_type: row.link_relation_type
    });

    // Historical Resonance data lives ON the vehicle_person_links
    // row (Task 3.3E.1) -- there is no independent resonance
    // table/id. Using the real vehicle_person_link_id as the
    // stable evidence id (rather than fabricating a new one)
    // keeps this reference verifiable against an actual DB row,
    // even before the resonance resolver has filled in a score.
    evidence.push({
      id: `historical_resonance:${row.vehicle_person_link_id}`,
      type: "HISTORICAL_RESONANCE",
      source: "vehicle_person_links",
      vehicle_person_link_id: String(row.vehicle_person_link_id),
      person_id: String(row.person_id),
      score: row.resonance_score,
      tier: row.resonance_tier,
      scoring_version: row.resonance_version
    });
  }

  const missingSignals = Array.isArray(row.missing_signals)
    ? row.missing_signals
    : [];

  const noPersonSignal = missingSignals.includes(
    MISSING_SIGNALS.NO_PERSON_SIGNAL
  );

  return {
    fusion_candidate_id: String(row.id),

    vehicle: {
      id: String(row.vehicle_id),
      code: row.vehicle_code,
      name: row.vehicle_name,
      manufacturer: row.vehicle_manufacturer,
      category: row.vehicle_category
    },

    country: row.country_id
      ? {
          id: String(row.country_id),
          code: row.country_code,
          name: row.country_name
        }
      : null,

    country_news: row.country_news_signal_id
      ? {
          id: String(row.country_news_signal_id),
          title: row.country_news_title,
          canonical_title: row.country_news_canonical_title,
          url: row.country_news_url,
          category: row.country_news_category,
          source: row.country_news_source,
          domain: row.country_news_domain,
          provider: row.country_news_provider,
          published_at: row.country_news_published_at,
          first_seen_at: row.country_news_first_seen_at,
          created_at: row.country_news_created_at
        }
      : null,

    person:
      row.person_id && !noPersonSignal
        ? {
            id: String(row.person_id),
            slug: row.person_slug,
            canonical_name: row.person_canonical_name,
            role_category: row.person_role_category,
            source_person_evidence: true,
            fictional_character_required: true,
            prohibited_reuse: [
              "REAL_NAME", "NAME_FRAGMENT", "REAL_APPEARANCE",
              "REAL_BIOGRAPHY", "REAL_FAMILY",
              "REAL_COMPANY_ROLE_AS_CHARACTER"
            ],
            aliases: Array.isArray(row.person_aliases) ? row.person_aliases : [],
            evidence_source: {
              representative_url: row.person_traffic_url,
              representative_source: row.person_traffic_source,
              representative_domain: row.person_traffic_domain,
              first_seen_at: row.person_traffic_first_seen_at
            }
          }
        : null,

    vehicle_person_link:
      row.vehicle_person_link_id && !noPersonSignal
        ? {
            id: String(row.vehicle_person_link_id),
            tier: row.person_link_tier,
            relation_type: row.link_relation_type,
            link_confidence: row.link_confidence,
            link_method: row.link_method
          }
        : null,

    historical_resonance:
      row.vehicle_person_link_id && !noPersonSignal
        ? {
            evidence_ref: `historical_resonance:${row.vehicle_person_link_id}`,
            score: row.resonance_score,
            tier: row.resonance_tier,
            evidence_horizon: row.resonance_evidence_horizon,
            reasons: row.resonance_evidence,
            source_person_id: String(row.person_id),
            source_vehicle_person_link_id: String(row.vehicle_person_link_id),
            scoring_version: row.resonance_version
          }
        : null,

    missing_signals: missingSignals,
    no_person_signal: noPersonSignal,

    fusion: {
      fusion_score: row.fusion_score,
      fusion_version: row.fusion_version,
      is_complete: row.is_complete,
      missing_signals: missingSignals,
      fusion_evidence: row.fusion_evidence,
      candidate_created_at: row.candidate_created_at
    },

    // Backward-compatible top-level mirrors, kept so existing
    // prompt builders / validators reading snapshot.fusion_score
    // etc. directly continue to work unchanged.
    is_complete: row.is_complete,
    fusion_evidence: row.fusion_evidence,
    fusion_score: row.fusion_score,
    fusion_version: row.fusion_version,

    provenance: {
      captured_at: new Date().toISOString(),
      fusion_run_id: row.fusion_run_id ? String(row.fusion_run_id) : null,
      candidate_created_at: row.candidate_created_at,
      country_news_first_seen_at: row.country_news_first_seen_at || null,
      person_first_seen_at: row.person_traffic_first_seen_at || null
    },

    // Kept for backward compatibility with code reading
    // snapshot.captured_at directly.
    captured_at: new Date().toISOString(),

    evidence
  };
}

function evidenceIdsFromSnapshot(snapshot) {
  return new Set((snapshot.evidence || []).map(item => item.id));
}

// =========================================================
// SIGNAL COVERAGE INHERITANCE (Task 3.6)
//
// Outline and Script generation never re-ask Gemini for
// signal_contributions / coverage_status -- both are pure functions of
// data already in hand (the immutable candidate_snapshot, and the
// selected Direction's own stored payload), so they are computed here
// and persisted verbatim instead of risking LLM drift on a question
// that already has exactly one correct, mechanically-derivable answer.
// =========================================================

function computeCoverageStatusFromSnapshot(snapshot) {
  const hasCountrySignal = Boolean(snapshot && snapshot.country_news);
  const noPersonSignal = Boolean(snapshot && snapshot.no_person_signal);

  return {
    vehicle_signal: "USED",
    country_signal: hasCountrySignal ? "USED" : "NOT_AVAILABLE",
    person_signal: noPersonSignal ? "NOT_AVAILABLE" : "USED",
    historical_resonance: noPersonSignal ? "NOT_AVAILABLE" : "USED",
    apex_rules: "USED",
    locked_beat: "MATCH"
  };
}

function mergeEvidenceRefs(contributions, layer) {
  return [
    ...new Set(
      contributions.flatMap(sc => {
        const layerValue = sc && sc[layer];
        return Array.isArray(layerValue && layerValue.evidence_refs)
          ? layerValue.evidence_refs
          : [];
      })
    )
  ];
}

function mergeArrayField(contributions, layer, field) {
  return [
    ...new Set(
      contributions.flatMap(sc => {
        const layerValue = sc && sc[layer];
        return Array.isArray(layerValue && layerValue[field])
          ? layerValue[field]
          : [];
      })
    )
  ];
}

function mergeTextField(contributions, layer, field) {
  const values = contributions
    .map(sc => sc && sc[layer] && sc[layer][field])
    .filter(value => typeof value === "string" && value.trim().length > 0);

  return values.length > 0 ? values.join(" | ") : undefined;
}

// A NOT_AVAILABLE marker is a candidate-level fact shared by every
// Direction in the batch (runIntegratedCoverageValidator enforces this
// at Direction-generation time), so checking only the first selected
// direction's marker is sufficient -- there is never a genuine
// USED-vs-NOT_AVAILABLE disagreement to reconcile between two merged
// directions.
function isNotAvailableSignal(layerValue, markerFields) {
  return (
    isPlainObject(layerValue) &&
    markerFields.every(field => layerValue[field] === "NOT_AVAILABLE")
  );
}

function mergeUsedSignalLayer(contributions, layer, { textFields = [], arrayFields = [] }) {
  const merged = { evidence_refs: mergeEvidenceRefs(contributions, layer) };

  for (const field of textFields) {
    const value = mergeTextField(contributions, layer, field);
    if (value !== undefined) {
      merged[field] = value;
    }
  }

  for (const field of arrayFields) {
    merged[field] = mergeArrayField(contributions, layer, field);
  }

  return merged;
}

// SINGLE mode passes exactly one Direction payload; MERGE mode passes
// two. Every Direction in a batch already shares an identical
// USED/NOT_AVAILABLE pattern per layer, so merging never needs to
// reconcile a USED vs NOT_AVAILABLE disagreement -- only which
// evidence_refs/narrative text to combine when both used a layer.
function mergeSignalContributions(directionPayloads) {
  const contributions = directionPayloads.map(
    payload => (payload && payload.signal_contributions) || {}
  );

  if (contributions.length === 1) {
    return contributions[0];
  }

  const country = isNotAvailableSignal(contributions[0].country, ["country_signal"])
    ? contributions[0].country
    : mergeUsedSignalLayer(contributions, "country", {
        textFields: ["story_function", "dc2100_pressure", "direct_effect_on_story"]
      });

  const person = isNotAvailableSignal(
    contributions[0].person,
    ["person_signal", "historical_resonance"]
  )
    ? contributions[0].person
    : mergeUsedSignalLayer(contributions, "person", {
        textFields: [
          "story_function",
          "fictionalized_trait",
          "historical_resonance_used"
        ]
      });

  return {
    vehicle: mergeUsedSignalLayer(contributions, "vehicle", {
      textFields: ["story_function"],
      arrayFields: ["preserved_traits", "transformed_traits"]
    }),
    country,
    person,
    // beat_id is identical across every direction in a batch
    // (LOCKED_BEAT_MATCHED already enforces this) -- keep the first
    // payload's apex object entirely instead of merging fields that
    // must stay internally consistent with each other.
    apex: contributions[0].apex
  };
}

// =========================================================
// EVENTS
// =========================================================

async function insertEvent(
  client,
  runId,
  eventType,
  stage,
  payload = {}
) {
  await client.query(
    `
      INSERT INTO story_pipeline_events (
        story_run_id, event_type, stage, payload
      )
      VALUES ($1, $2, $3, $4::jsonb)
    `,
    [runId, eventType, stage, JSON.stringify(payload)]
  );
}

async function fetchRun(pool, runId) {
  const result = await pool.query(
    `SELECT * FROM story_pipeline_runs WHERE id = $1`,
    [runId]
  );

  return result.rows[0] || null;
}

// lease_is_valid is computed in SQL (against Postgres NOW(), the
// one authoritative clock) rather than in Node -- a worker
// process's own clock is never trusted to decide whether it
// still owns a GENERATING_* claim.
async function fetchRunForUpdate(client, runId) {
  const result = await client.query(
    `
      SELECT
        *,
        (
          lease_expires_at IS NOT NULL
          AND lease_expires_at > NOW()
        ) AS lease_is_valid
      FROM story_pipeline_runs WHERE id = $1 FOR UPDATE
    `,
    [runId]
  );

  return result.rows[0] || null;
}

// =========================================================
// CREATE RUN (pre-Gate-1)
// =========================================================

async function createLockedCanonStoryRun(pool, body, context = {}) {
  const slotId = String(body.locked_canon_slot_id || "");
  if (!CANDIDATE_SLOT_PATTERN.test(slotId)) {
    fail("VALIDATION_ERROR", "locked_canon_slot_id must be CANDIDATE_SLOT_01 through CANDIDATE_SLOT_15.", 400);
  }
  if (body.fusion_candidate_id !== undefined && body.fusion_candidate_id !== null) {
    fail("LOCKED_CANON_FUSION_FORBIDDEN", "LOCKED_CANON must not provide fusion_candidate_id.", 409);
  }
  const idempotencyKey = context.idempotencyKey
    ? String(context.idempotencyKey).trim()
    : null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const source = await client.query(`
      SELECT s.*,c.id AS country_id,c.name AS country_name,
        n.country_news_signal_id,cns.title AS country_news_title,
        cns.canonical_title AS country_news_canonical_title,
        cns.representative_url AS country_news_url,
        cns.representative_source AS country_news_source,
        cns.representative_domain AS country_news_domain,
        cns.category AS country_news_category,cns.provider AS country_news_provider,
        cns.published_at AS country_news_published_at,
        cns.first_seen_at AS country_news_first_seen_at,cns.created_at AS country_news_created_at
      FROM locked_canon_slots s
      JOIN countries c ON c.code=s.canon_country_code
      LEFT JOIN locked_canon_news_candidates n ON n.slot_id=s.slot_id
      LEFT JOIN country_news_signals cns ON cns.id=n.country_news_signal_id
      WHERE s.slot_id=$1 AND s.locked=TRUE
      ORDER BY n.selected DESC,n.rank ASC
      LIMIT 1
    `, [slotId]);
    if (!source.rowCount) {
      await client.query("ROLLBACK");
      fail("LOCKED_CANON_SLOT_NOT_FOUND", `Locked Canon slot ${slotId} was not found.`, 404);
    }
    const row = source.rows[0];
    if (!row.canon_driver_name) {
      await client.query("ROLLBACK");
      fail("LOCKED_CANON_IDENTITY_REVIEW_REQUIRED", `Locked Canon slot ${slotId} has unresolved identity fields.`, 409);
    }
    if (!row.country_news_signal_id) {
      await client.query("ROLLBACK");
      fail("LOCKED_CANON_NEWS_NOT_READY", `Locked Canon slot ${slotId} has no Country News candidate.`, 409);
    }
    const snapshot = {
      fusion_candidate_id: null,
      content_mode: "LOCKED_CANON",
      locked_canon: {
        slot_id: slotId,
        canon_driver_name: row.canon_driver_name,
        canon_vehicle_name: row.canon_vehicle_name,
        canon_country_code: row.canon_country_code,
        identities_locked: true
      },
      vehicle: {
        id: slotId,
        code: slotId,
        name: row.canon_vehicle_name,
        manufacturer: null,
        category: "LOCKED_CANON"
      },
      country: {
        id: String(row.country_id),
        code: row.canon_country_code,
        name: row.country_name
      },
      country_news: {
        id: String(row.country_news_signal_id),
        title: row.country_news_title,
        canonical_title: row.country_news_canonical_title,
        url: row.country_news_url,
        category: row.country_news_category,
        source: row.country_news_source,
        domain: row.country_news_domain,
        provider: row.country_news_provider,
        published_at: row.country_news_published_at,
        first_seen_at: row.country_news_first_seen_at,
        created_at: row.country_news_created_at
      },
      person: null,
      vehicle_person_link: null,
      historical_resonance: null,
      missing_signals: [MISSING_SIGNALS.NO_PERSON_SIGNAL],
      no_person_signal: true,
      is_complete: true,
      fusion: null,
      fusion_evidence: { content_mode: "LOCKED_CANON", pair_engine_used: false },
      fusion_score: null,
      fusion_version: null,
      provenance: { captured_at: new Date().toISOString(), fusion_run_id: null },
      captured_at: new Date().toISOString(),
      evidence: [
        { id: `locked_canon:${slotId}`, type: "LOCKED_CANON", name: row.canon_vehicle_name },
        { id: `country_news:${row.country_news_signal_id}`, type: "COUNTRY_NEWS", title: row.country_news_title }
      ]
    };
    const snapshotHash = `sha256:${sha256(JSON.stringify(snapshot))}`;
    const inserted = await client.query(`
      INSERT INTO story_pipeline_runs(
        idempotency_key,fusion_candidate_id,content_mode,locked_canon_slot_id,
        status,current_stage,candidate_snapshot,candidate_snapshot_hash
      ) VALUES($1,NULL,'LOCKED_CANON',$2,'AWAITING_CANDIDATE_APPROVAL',
        'AWAITING_CANDIDATE_APPROVAL',$3::jsonb,$4)
      RETURNING *
    `, [idempotencyKey, slotId, JSON.stringify(snapshot), snapshotHash]);
    const run = inserted.rows[0];
    await insertEvent(client, run.id, "STORY_RUN_CREATED", null, {
      content_mode: "LOCKED_CANON",
      locked_canon_slot_id: slotId,
      country_news_signal_id: String(row.country_news_signal_id),
      youtube_search_calls: 0,
      pair_run_id: null,
      fusion_run_id: null
    });
    await client.query("COMMIT");
    return { run, replayed: false };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function createStoryRun(pool, body, context = {}) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    fail("VALIDATION_ERROR", "Request body must be a JSON object.", 400);
  }

  const contentMode = String(body.content_mode || "STATION_GUEST").toUpperCase();
  if (!["LOCKED_CANON", "STATION_GUEST"].includes(contentMode)) {
    fail("VALIDATION_ERROR", "content_mode must be LOCKED_CANON or STATION_GUEST.", 400);
  }
  if (contentMode === "LOCKED_CANON") {
    return createLockedCanonStoryRun(pool, body, context);
  }

  const fusionCandidateId = body.fusion_candidate_id;

  if (
    fusionCandidateId === undefined ||
    fusionCandidateId === null ||
    !/^[0-9]+$/.test(String(fusionCandidateId))
  ) {
    fail(
      "VALIDATION_ERROR",
      "fusion_candidate_id must be a positive integer.",
      400
    );
  }

  const idempotencyKey = context.idempotencyKey
    ? String(context.idempotencyKey).trim()
    : null;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    if (idempotencyKey) {
      const existing = await client.query(
        `SELECT * FROM story_pipeline_runs WHERE idempotency_key = $1`,
        [idempotencyKey]
      );

      if (existing.rowCount > 0) {
        const existingRun = existing.rows[0];

        if (
          String(existingRun.fusion_candidate_id) !==
          String(fusionCandidateId)
        ) {
          await client.query("ROLLBACK");
          fail(
            "IDEMPOTENCY_CONFLICT",
            "Idempotency-Key was already used for a different fusion_candidate_id.",
            409
          );
        }

        await client.query("COMMIT");
        return { run: existingRun, replayed: true };
      }
    }

    const candidateCheck = await client.query(
      `SELECT id FROM vehicle_fusion_candidates WHERE id = $1`,
      [fusionCandidateId]
    );

    if (candidateCheck.rowCount === 0) {
      await client.query("ROLLBACK");
      fail(
        "FUSION_CANDIDATE_NOT_FOUND",
        `Fusion candidate ${fusionCandidateId} was not found.`,
        404
      );
    }

    const activeCheck = await client.query(
      `
        SELECT id, status
        FROM story_pipeline_runs
        WHERE fusion_candidate_id = $1
          AND status NOT IN ('COMPLETED', 'FAILED', 'CANCELLED')
      `,
      [fusionCandidateId]
    );

    if (activeCheck.rowCount > 0) {
      await client.query("ROLLBACK");
      fail(
        "ACTIVE_STORY_RUN_EXISTS",
        `Fusion candidate ${fusionCandidateId} already has an active Story Run.`,
        409,
        { active_run: activeCheck.rows[0] }
      );
    }

    const snapshot = await buildCandidateSnapshot(
      client,
      fusionCandidateId
    );

    const snapshotHash = `sha256:${sha256(JSON.stringify(snapshot))}`;

    let insertResult;

    try {
      insertResult = await client.query(
        `
          INSERT INTO story_pipeline_runs (
            idempotency_key, fusion_candidate_id, status, current_stage,
            candidate_snapshot, candidate_snapshot_hash
          )
          VALUES (
            $1, $2, 'AWAITING_CANDIDATE_APPROVAL', 'AWAITING_CANDIDATE_APPROVAL',
            $3::jsonb, $4
          )
          RETURNING *
        `,
        [
          idempotencyKey,
          fusionCandidateId,
          JSON.stringify(snapshot),
          snapshotHash
        ]
      );
    } catch (error) {
      if (
        error &&
        error.code === "23505" &&
        error.constraint === "idx_story_pipeline_runs_idempotency_key"
      ) {
        await client.query("ROLLBACK");
        const existing = await pool.query(
          `SELECT * FROM story_pipeline_runs WHERE idempotency_key = $1`,
          [idempotencyKey]
        );
        return { run: existing.rows[0], replayed: true };
      }

      if (
        error &&
        error.code === "23505" &&
        error.constraint ===
          "idx_story_pipeline_runs_fusion_candidate_active"
      ) {
        await client.query("ROLLBACK");
        fail(
          "ACTIVE_STORY_RUN_EXISTS",
          `Fusion candidate ${fusionCandidateId} already has an active Story Run.`,
          409
        );
      }

      throw error;
    }

    const run = insertResult.rows[0];

    await insertEvent(client, run.id, "STORY_RUN_CREATED", null, {
      fusion_candidate_id: String(fusionCandidateId)
    });

    await client.query("COMMIT");

    return { run, replayed: false };
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
// GATE 1
// CANDIDATE APPROVAL
// =========================================================

function validateGate1Payload(body) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    fail("VALIDATION_ERROR", "Request body must be a JSON object.", 400);
  }

  if (body.approved_by !== "michael") {
    fail(
      "VALIDATION_ERROR",
      "approved_by must be \"michael\".",
      400
    );
  }

  if (!CANDIDATE_SLOT_PATTERN.test(String(body.candidate_slot_id || ""))) {
    fail(
      "VALIDATION_ERROR",
      "candidate_slot_id must be CANDIDATE_SLOT_01 through CANDIDATE_SLOT_15.",
      400
    );
  }

  if (!BEAT_ID_PATTERN.test(String(body.beat_id || ""))) {
    fail(
      "VALIDATION_ERROR",
      "beat_id must be BEAT-01 through BEAT-15.",
      400
    );
  }

  if (!APEX_STAGE_ALLOWLIST.includes(body.apex_stage)) {
    fail(
      "VALIDATION_ERROR",
      `apex_stage must be one of ${APEX_STAGE_ALLOWLIST.join(", ")}.`,
      400
    );
  }

  if (!LANGUAGE_PATTERN.test(String(body.review_language || ""))) {
    fail(
      "VALIDATION_ERROR",
      "review_language must be a valid language tag (e.g. zh-TW).",
      400
    );
  }

  if (!LANGUAGE_PATTERN.test(String(body.script_language || ""))) {
    fail(
      "VALIDATION_ERROR",
      "script_language must be a valid language tag (e.g. en).",
      400
    );
  }

  const forbiddenElements =
    body.forbidden_elements === undefined ||
    body.forbidden_elements === null
      ? []
      : body.forbidden_elements;

  if (!Array.isArray(forbiddenElements)) {
    fail(
      "VALIDATION_ERROR",
      "forbidden_elements must be an array when provided.",
      400
    );
  }

  return {
    approvedBy: body.approved_by,
    candidateSlotId: body.candidate_slot_id,
    beatId: body.beat_id,
    apexStage: body.apex_stage,
    creatorNotes: body.creator_notes || null,
    forbiddenElements,
    reviewLanguage: body.review_language,
    scriptLanguage: body.script_language
  };
}

async function approveCandidate(pool, runId, body, context = {}) {
  const parsed = validateGate1Payload(body);

  // Lock the Canon Bundle for this run's entire lifetime. Every
  // later generation stage (including Regenerate and Resume)
  // compares its freshly-loaded bundle against exactly these
  // four locked values and fails closed (CANON_CHANGED_DURING_RUN)
  // on any mismatch -- Directions, Outline, and Scripts must
  // never be generated against different Canon versions.
  const loadCanonBundleFn = context.loadCanonBundleFn || loadCanonBundle;
  const canonBundle = loadCanonBundleFn();

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const run = await fetchRunForUpdate(client, runId);

    if (!run) {
      await client.query("ROLLBACK");
      fail("STORY_RUN_NOT_FOUND", `Story run ${runId} was not found.`, 404);
    }

    if (run.status !== "AWAITING_CANDIDATE_APPROVAL") {
      await client.query("ROLLBACK");
      fail(
        "INVALID_STORY_STATE",
        `Story run ${runId} is ${run.status}, expected AWAITING_CANDIDATE_APPROVAL.`,
        409
      );
    }

    const updateResult = await client.query(
      `
        UPDATE story_pipeline_runs
        SET
          status = 'QUEUED_DIRECTIONS',
          current_stage = 'QUEUED_DIRECTIONS',
          candidate_slot_id = $1,
          beat_id = $2,
          apex_stage = $3,
          creator_notes = $4,
          forbidden_elements = $5::jsonb,
          review_language = $6,
          script_language = $7,
          canon_version = $8,
          rules_version = $9,
          season_version = $10,
          canon_hash = $11,
          stage_attempt_count = 0,
          updated_at = NOW()
        WHERE id = $12
        RETURNING *
      `,
      [
        parsed.candidateSlotId,
        parsed.beatId,
        parsed.apexStage,
        parsed.creatorNotes,
        JSON.stringify(parsed.forbiddenElements),
        parsed.reviewLanguage,
        parsed.scriptLanguage,
        canonBundle.canon_version,
        canonBundle.rules_version,
        canonBundle.season_version,
        canonBundle.canon_hash,
        runId
      ]
    );

    await insertEvent(client, runId, "CANDIDATE_APPROVED", null, {
      approved_by: parsed.approvedBy,
      candidate_slot_id: parsed.candidateSlotId,
      beat_id: parsed.beatId,
      apex_stage: parsed.apexStage,
      canon_hash: canonBundle.canon_hash
    });

    await client.query("COMMIT");

    return updateResult.rows[0];
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
// GATE 2 — DIRECTION SELECTION
// =========================================================

async function selectDirection(pool, runId, body) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    fail("VALIDATION_ERROR", "Request body must be a JSON object.", 400);
  }

  if (body.approved_by !== "michael") {
    fail("VALIDATION_ERROR", "approved_by must be \"michael\".", 400);
  }

  const selectedIds = body.selected_direction_ids;

  if (
    !Array.isArray(selectedIds) ||
    selectedIds.length < 1 ||
    selectedIds.length > 2
  ) {
    fail(
      "VALIDATION_ERROR",
      "selected_direction_ids must contain 1 or 2 entries.",
      400
    );
  }

  const selectionMode = body.selection_mode;

  if (selectedIds.length === 2 && selectionMode !== "MERGE") {
    fail(
      "VALIDATION_ERROR",
      "selection_mode must be MERGE when selecting two directions.",
      400
    );
  }

  if (selectedIds.length === 1 && selectionMode !== "SINGLE") {
    fail(
      "VALIDATION_ERROR",
      "selection_mode must be SINGLE when selecting one direction.",
      400
    );
  }

  const rawMergeNotes = body.merge_notes;

  if (selectionMode === "MERGE") {
    if (
      typeof rawMergeNotes !== "string" ||
      rawMergeNotes.trim().length === 0
    ) {
      fail(
        "VALIDATION_ERROR",
        "merge_notes must be a non-empty string when selection_mode is MERGE.",
        400
      );
    }
  } else if (
    rawMergeNotes !== undefined &&
    rawMergeNotes !== null &&
    String(rawMergeNotes).trim().length > 0
  ) {
    fail(
      "VALIDATION_ERROR",
      "merge_notes must be null when selection_mode is SINGLE.",
      400
    );
  }

  const mergeNotes =
    selectionMode === "MERGE" ? rawMergeNotes.trim() : null;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const run = await fetchRunForUpdate(client, runId);

    if (!run) {
      await client.query("ROLLBACK");
      fail("STORY_RUN_NOT_FOUND", `Story run ${runId} was not found.`, 404);
    }

    if (run.status === "FAILED" && run.error_code === "NO_SELECTABLE_DIRECTION") {
      await client.query("ROLLBACK");
      fail(
        "NO_SELECTABLE_DIRECTION",
        "All generated directions are BLOCKED; regenerate directions before selection.",
        422
      );
    }

    if (run.status !== "AWAITING_DIRECTION_SELECTION") {
      await client.query("ROLLBACK");
      fail(
        "INVALID_STORY_STATE",
        `Story run ${runId} is ${run.status}, expected AWAITING_DIRECTION_SELECTION.`,
        409
      );
    }

    const directionsResult = await client.query(
      `
        SELECT *
        FROM story_directions
        WHERE story_run_id = $1
          AND id = ANY($2::bigint[])
          AND superseded_at IS NULL
      `,
      [runId, selectedIds]
    );

    if (directionsResult.rowCount !== selectedIds.length) {
      await client.query("ROLLBACK");
      fail(
        "ARTIFACT_NOT_LOCKABLE",
        "One or more selected directions do not exist or have been superseded.",
        409
      );
    }

    const blocked = directionsResult.rows.filter(
      row => row.validation_status !== "PASS"
    );

    if (blocked.length > 0) {
      await client.query("ROLLBACK");
      fail(
        "VALIDATION_BLOCKED",
        "One or more selected directions are BLOCKED and cannot be selected.",
        422,
        { blocked_direction_ids: blocked.map(row => String(row.id)) }
      );
    }

    // Task 3.5E: a legacy-schema direction (generated before the
    // Integrated Story fix) structurally used only one evidence
    // layer -- it can never be selected at Gate 2, no matter what
    // its stored validation_status is. This is enforced here, at
    // the actual selection endpoint, not only as a display hint in
    // lib/story/api.js's can_select_direction flag.
    const legacy = directionsResult.rows.filter(
      row => row.direction_type !== INTEGRATED_STORY_DIRECTION_TYPE
    );

    if (legacy.length > 0) {
      await client.query("ROLLBACK");
      fail(
        "LEGACY_DIRECTION_NOT_SELECTABLE",
        "One or more selected directions predate the Integrated Story fix and must be regenerated, not selected.",
        422,
        { legacy_direction_ids: legacy.map(row => String(row.id)) }
      );
    }

    const updateResult = await client.query(
      `
        UPDATE story_pipeline_runs
        SET
          status = 'QUEUED_OUTLINE',
          current_stage = 'QUEUED_OUTLINE',
          selected_direction_ids = $1::jsonb,
          selection_mode = $2,
          merge_notes = $3,
          stage_attempt_count = 0,
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `,
      [
        JSON.stringify(selectedIds.map(id => String(id))),
        selectionMode,
        mergeNotes,
        runId
      ]
    );

    await insertEvent(client, runId, "DIRECTION_SELECTED", "DIRECTIONS", {
      approved_by: body.approved_by,
      selected_direction_ids: selectedIds.map(id => String(id)),
      selection_mode: selectionMode,
      merge_notes: mergeNotes
    });

    await client.query("COMMIT");

    return updateResult.rows[0];
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
// GATE 3 — OUTLINE LOCK
// =========================================================

async function lockOutline(pool, runId, body) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    fail("VALIDATION_ERROR", "Request body must be a JSON object.", 400);
  }

  if (body.approved_by !== "michael") {
    fail("VALIDATION_ERROR", "approved_by must be \"michael\".", 400);
  }

  if (
    body.outline_id === undefined ||
    body.outline_id === null ||
    !/^[0-9]+$/.test(String(body.outline_id))
  ) {
    fail("VALIDATION_ERROR", "outline_id must be a positive integer.", 400);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const run = await fetchRunForUpdate(client, runId);

    if (!run) {
      await client.query("ROLLBACK");
      fail("STORY_RUN_NOT_FOUND", `Story run ${runId} was not found.`, 404);
    }

    if (run.status !== "AWAITING_OUTLINE_LOCK") {
      await client.query("ROLLBACK");
      fail(
        "INVALID_STORY_STATE",
        `Story run ${runId} is ${run.status}, expected AWAITING_OUTLINE_LOCK.`,
        409
      );
    }

    const outlineResult = await client.query(
      `
        SELECT *
        FROM story_outlines
        WHERE id = $1
          AND story_run_id = $2
          AND superseded_at IS NULL
        FOR UPDATE
      `,
      [body.outline_id, runId]
    );

    if (outlineResult.rowCount === 0) {
      await client.query("ROLLBACK");
      fail(
        "ARTIFACT_NOT_LOCKABLE",
        "Outline does not exist for this run or has been superseded.",
        409
      );
    }

    const outline = outlineResult.rows[0];

    if (outline.validation_status !== "PASS") {
      await client.query("ROLLBACK");
      fail(
        "VALIDATION_BLOCKED",
        "This outline is BLOCKED and cannot be locked.",
        422,
        { issues: outline.validation_issues }
      );
    }

    // Review fix: a legacy row predating the Outline/Script Integrated
    // Signals fix carries no signal_contributions/coverage_status/
    // locked_beat_id and never went through the per-layer continuity
    // checks -- a stored PASS on such a row cannot be trusted for
    // locking, no matter how it got there.
    if (!isIntegratedOutlineCoverage(outline)) {
      await client.query("ROLLBACK");
      fail(
        "LEGACY_COVERAGE_NOT_LOCKABLE",
        "This outline predates the Integrated Signals coverage fix and cannot be locked. Regenerate the Outline to produce a lockable, coverage-validated artifact.",
        422
      );
    }

    await client.query(
      `
        UPDATE story_outlines
        SET locked_by = $1, locked_at = NOW()
        WHERE id = $2
      `,
      [body.approved_by, outline.id]
    );

    const updateResult = await client.query(
      `
        UPDATE story_pipeline_runs
        SET
          status = 'QUEUED_SCRIPTS',
          current_stage = 'QUEUED_SCRIPTS',
          stage_attempt_count = 0,
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [runId]
    );

    await insertEvent(client, runId, "OUTLINE_LOCKED", "OUTLINE", {
      approved_by: body.approved_by,
      outline_id: String(outline.id),
      lock_note: body.lock_note || null
    });

    await client.query("COMMIT");

    return updateResult.rows[0];
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
// GATE 4 — SCRIPT LOCK
// =========================================================

async function lockScript(pool, runId, body) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    fail("VALIDATION_ERROR", "Request body must be a JSON object.", 400);
  }

  if (body.approved_by !== "michael") {
    fail("VALIDATION_ERROR", "approved_by must be \"michael\".", 400);
  }

  if (
    body.script_id === undefined ||
    body.script_id === null ||
    !/^[0-9]+$/.test(String(body.script_id))
  ) {
    fail("VALIDATION_ERROR", "script_id must be a positive integer.", 400);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const run = await fetchRunForUpdate(client, runId);

    if (!run) {
      await client.query("ROLLBACK");
      fail("STORY_RUN_NOT_FOUND", `Story run ${runId} was not found.`, 404);
    }

    if (run.status !== "AWAITING_SCRIPT_LOCK") {
      await client.query("ROLLBACK");
      fail(
        "INVALID_STORY_STATE",
        `Story run ${runId} is ${run.status}, expected AWAITING_SCRIPT_LOCK.`,
        409
      );
    }

    const scriptResult = await client.query(
      `
        SELECT *
        FROM story_scripts
        WHERE id = $1
          AND story_run_id = $2
          AND superseded_at IS NULL
        FOR UPDATE
      `,
      [body.script_id, runId]
    );

    if (scriptResult.rowCount === 0) {
      await client.query("ROLLBACK");
      fail(
        "ARTIFACT_NOT_LOCKABLE",
        "Script does not exist for this run or has been superseded.",
        409
      );
    }

    const script = scriptResult.rows[0];

    if (script.validation_status !== "PASS") {
      await client.query("ROLLBACK");
      fail(
        "VALIDATION_BLOCKED",
        "This script is BLOCKED and cannot be locked.",
        422,
        { issues: script.validation_issues }
      );
    }

    // Review fix: same legacy-coverage guard as lockOutline -- a
    // pre-fix row's stored PASS never went through the per-layer
    // continuity checks and cannot be trusted for locking.
    if (!isIntegratedScriptCoverage(script)) {
      await client.query("ROLLBACK");
      fail(
        "LEGACY_COVERAGE_NOT_LOCKABLE",
        "This script predates the Integrated Signals coverage fix and cannot be locked. Regenerate the Script to produce a lockable, coverage-validated artifact.",
        422
      );
    }

    await client.query(
      `
        UPDATE story_scripts
        SET locked_by = $1, locked_at = NOW()
        WHERE id = $2
      `,
      [body.approved_by, script.id]
    );

    const updateResult = await client.query(
      `
        UPDATE story_pipeline_runs
        SET
          status = 'COMPLETED',
          current_stage = 'COMPLETED',
          selected_script_id = $1,
          completed_at = NOW(),
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `,
      [script.id, runId]
    );

    await insertEvent(client, runId, "SCRIPT_LOCKED", "SCRIPTS", {
      approved_by: body.approved_by,
      script_id: String(script.id),
      lock_note: body.lock_note || null
    });

    await insertEvent(
      client,
      runId,
      "STORY_PIPELINE_COMPLETED",
      null,
      {}
    );

    await client.query("COMMIT");

    return updateResult.rows[0];
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
// REGENERATE
// =========================================================

const REGENERATE_STAGE_REQUIREMENT = {
  DIRECTIONS: { awaiting: "AWAITING_DIRECTION_SELECTION", table: "story_directions" },
  OUTLINE: { awaiting: "AWAITING_OUTLINE_LOCK", table: "story_outlines" },
  SCRIPTS: { awaiting: "AWAITING_SCRIPT_LOCK", table: "story_scripts" }
};

async function regenerateStage(pool, runId, body) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    fail("VALIDATION_ERROR", "Request body must be a JSON object.", 400);
  }

  if (body.approved_by !== "michael") {
    fail("VALIDATION_ERROR", "approved_by must be \"michael\".", 400);
  }

  const stage = body.stage;

  if (!Object.prototype.hasOwnProperty.call(
    REGENERATE_STAGE_REQUIREMENT,
    stage
  )) {
    fail(
      "VALIDATION_ERROR",
      "stage must be DIRECTIONS, OUTLINE, or SCRIPTS.",
      400
    );
  }

  const requirement = REGENERATE_STAGE_REQUIREMENT[stage];

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const run = await fetchRunForUpdate(client, runId);

    if (!run) {
      await client.query("ROLLBACK");
      fail("STORY_RUN_NOT_FOUND", `Story run ${runId} was not found.`, 404);
    }

    const retryingNoSelectableDirections =
      stage === "DIRECTIONS" &&
      run.status === "FAILED" &&
      run.error_code === "NO_SELECTABLE_DIRECTION";

    if (run.status !== requirement.awaiting && !retryingNoSelectableDirections) {
      await client.query("ROLLBACK");
      fail(
        "INVALID_STORY_STATE",
        `Story run ${runId} is ${run.status}, expected ${requirement.awaiting} to regenerate ${stage}.`,
        409
      );
    }

    await client.query(
      `
        UPDATE ${requirement.table}
        SET superseded_at = NOW()
        WHERE story_run_id = $1 AND superseded_at IS NULL
      `,
      [runId]
    );

    const queuedStatus = STAGE_CONFIG[stage].queued;

    // Regenerating DIRECTIONS invalidates the human's prior Gate 2
    // decision entirely (new directions will need a fresh
    // selection), so selected_direction_ids/selection_mode/
    // merge_notes are all cleared. Regenerating OUTLINE keeps
    // them -- the selected direction(s) and merge instructions
    // still apply to the new outline attempt. Regenerating
    // SCRIPTS only clears selected_script_id (Gate 4 hasn't
    // happened yet by definition at this point anyway).
    const resetFields =
      stage === "DIRECTIONS"
        ? `, selected_direction_ids = '[]'::jsonb, selection_mode = NULL, merge_notes = NULL`
        : stage === "SCRIPTS"
        ? `, selected_script_id = NULL`
        : "";

    const updateResult = await client.query(
      `
        UPDATE story_pipeline_runs
        SET
          status = $1,
          current_stage = $1,
          stage_attempt_count = 0,
          failure_stage = NULL,
          error_code = NULL,
          error_message = NULL,
          updated_at = NOW()
          ${resetFields}
        WHERE id = $2
        RETURNING *
      `,
      [queuedStatus, runId]
    );

    await insertEvent(client, runId, "REGENERATE_REQUESTED", stage, {
      approved_by: body.approved_by,
      stage,
      revision_notes: body.revision_notes || null
    });

    await client.query("COMMIT");

    return updateResult.rows[0];
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
// CANCEL / RESUME
// =========================================================

async function cancelRun(pool, runId, body = {}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const run = await fetchRunForUpdate(client, runId);

    if (!run) {
      await client.query("ROLLBACK");
      fail("STORY_RUN_NOT_FOUND", `Story run ${runId} was not found.`, 404);
    }

    if (TERMINAL_STATUSES.has(run.status)) {
      await client.query("ROLLBACK");
      fail(
        "INVALID_STORY_STATE",
        `Story run ${runId} is already ${run.status}.`,
        409
      );
    }

    const updateResult = await client.query(
      `
        UPDATE story_pipeline_runs
        SET
          status = 'CANCELLED',
          current_stage = 'CANCELLED',
          cancelled_at = NOW(),
          updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [runId]
    );

    await insertEvent(client, runId, "STORY_RUN_CANCELLED", null, {
      reason: body.reason || null
    });

    await client.query("COMMIT");

    return updateResult.rows[0];
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

async function resumeRun(pool, runId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const run = await fetchRunForUpdate(client, runId);

    if (!run) {
      await client.query("ROLLBACK");
      fail("STORY_RUN_NOT_FOUND", `Story run ${runId} was not found.`, 404);
    }

    if (run.status !== "FAILED") {
      await client.query("ROLLBACK");
      fail(
        "INVALID_STORY_STATE",
        `Story run ${runId} is ${run.status}, expected FAILED.`,
        409
      );
    }

    const stage = run.failure_stage;

    if (
      !stage ||
      !Object.prototype.hasOwnProperty.call(STAGE_CONFIG, stage)
    ) {
      await client.query("ROLLBACK");
      fail(
        "INVALID_STORY_STATE",
        `Story run ${runId} has no resumable failure_stage.`,
        409
      );
    }

    const queuedStatus = STAGE_CONFIG[stage].queued;

    const updateResult = await client.query(
      `
        UPDATE story_pipeline_runs
        SET
          status = $1,
          current_stage = $1,
          failure_stage = NULL,
          error_code = NULL,
          error_message = NULL,
          worker_id = NULL,
          lease_expires_at = NULL,
          updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `,
      [queuedStatus, runId]
    );

    await insertEvent(client, runId, "STORY_RUN_RESUMED", stage, {});

    await client.query("COMMIT");

    return updateResult.rows[0];
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
// WORKER — CLAIM
// =========================================================

async function claimNextStoryRun(
  pool,
  workerId,
  { leaseDurationMs = STORY_LEASE_DURATION_MS } = {}
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const queuedStatuses = Object.values(STAGE_CONFIG).map(
      cfg => cfg.queued
    );
    const generatingStatuses = Object.values(STAGE_CONFIG).map(
      cfg => cfg.generating
    );

    const claimResult = await client.query(
      `
        SELECT *
        FROM story_pipeline_runs
        WHERE
          status = ANY($1::text[])
          OR (
            status = ANY($2::text[])
            AND lease_expires_at IS NOT NULL
            AND lease_expires_at < NOW()
          )
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `,
      [queuedStatuses, generatingStatuses]
    );

    if (claimResult.rowCount === 0) {
      await client.query("COMMIT");
      return null;
    }

    const run = claimResult.rows[0];

    const stage =
      STAGE_BY_QUEUED_STATUS[run.status] ||
      STAGE_BY_GENERATING_STATUS[run.status];

    // The 3-attempt ceiling is enforced against stage_attempt_count
    // (claims of THIS stage only), never attempt_count (the
    // lifetime total across all three stages) -- otherwise a
    // normal DIRECTIONS -> OUTLINE -> SCRIPTS run would already
    // be at 3 total claims by the time it reaches Scripts, and
    // Regenerate/Resume would exceed the ceiling immediately.
    const nextAttemptCount = run.attempt_count + 1;
    const nextStageAttemptCount = run.stage_attempt_count + 1;

    if (nextStageAttemptCount > STORY_MAX_STAGE_ATTEMPTS) {
      const failResult = await client.query(
        `
          UPDATE story_pipeline_runs
          SET
            status = 'FAILED',
            current_stage = 'FAILED',
            failure_stage = $1,
            error_code = 'STAGE_MAX_ATTEMPTS_EXCEEDED',
            error_message = $2,
            attempt_count = $3,
            stage_attempt_count = $4,
            worker_id = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
          WHERE id = $5
          RETURNING *
        `,
        [
          stage,
          `Stage ${stage} exceeded the maximum of ${STORY_MAX_STAGE_ATTEMPTS} attempts.`,
          nextAttemptCount,
          nextStageAttemptCount,
          run.id
        ]
      );

      await insertEvent(
        client,
        run.id,
        "STORY_GENERATION_FAILED",
        stage,
        { error_code: "STAGE_MAX_ATTEMPTS_EXCEEDED" }
      );

      await client.query("COMMIT");

      return { run: failResult.rows[0], stage, outcome: "RUN_FAILED" };
    }

    const generatingStatus = STAGE_CONFIG[stage].generating;

    const updateResult = await client.query(
      `
        UPDATE story_pipeline_runs
        SET
          status = $1,
          current_stage = $1,
          worker_id = $2,
          lease_expires_at = NOW() + ($3 || ' milliseconds')::interval,
          attempt_count = $4,
          stage_attempt_count = $5,
          updated_at = NOW()
        WHERE id = $6
        RETURNING *
      `,
      [
        generatingStatus,
        workerId,
        String(leaseDurationMs),
        nextAttemptCount,
        nextStageAttemptCount,
        run.id
      ]
    );

    await client.query("COMMIT");

    return {
      run: updateResult.rows[0],
      stage,
      outcome: "CLAIMED"
    };
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
// WORKER — GENERATION HELPERS
// =========================================================

async function latestRevisionNotes(pool, runId, stage) {
  const result = await pool.query(
    `
      SELECT payload
      FROM story_pipeline_events
      WHERE story_run_id = $1
        AND event_type = 'REGENERATE_REQUESTED'
        AND stage = $2
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [runId, stage]
  );

  return result.rowCount > 0
    ? result.rows[0].payload.revision_notes || null
    : null;
}

async function nextArtifactVersion(pool, runId, table) {
  const result = await pool.query(
    `SELECT COALESCE(MAX(version), 0) AS max_version FROM ${table} WHERE story_run_id = $1`,
    [runId]
  );

  return Number(result.rows[0].max_version) + 1;
}

async function recordGenerationAttempt(queryable, {
  runId,
  stage,
  artifactVersion,
  provider,
  model,
  promptVersion,
  requestPayload,
  responsePayload,
  inputTokens,
  outputTokens,
  totalTokens,
  latencyMs,
  attemptNumber,
  status,
  errorCode,
  errorMessage,
  directionKey,
  validationStatus,
  issueCodes,
  evidenceRefs,
  beatId,
  stateTransition
}) {
  await queryable.query(
    `
      INSERT INTO story_generation_attempts (
        story_run_id, stage, artifact_version, provider, model,
        prompt_version, request_hash, response_hash,
        input_tokens, output_tokens, total_tokens, latency_ms,
        attempt_number, status, error_code, error_message,
        direction_key, validation_status, issue_codes, evidence_refs,
        beat_id, state_transition
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19::jsonb, $20::jsonb, $21, $22::jsonb
      )
    `,
    [
      runId,
      stage,
      artifactVersion,
      provider,
      model,
      promptVersion,
      requestPayload ? `sha256:${sha256(JSON.stringify(requestPayload))}` : null,
      responsePayload ? `sha256:${sha256(JSON.stringify(responsePayload))}` : null,
      inputTokens ?? null,
      outputTokens ?? null,
      totalTokens ?? null,
      latencyMs ?? null,
      attemptNumber,
      status,
      errorCode ? redactSecrets(String(errorCode)) : null,
      errorMessage
        ? redactSecrets(String(errorMessage).slice(0, 2000))
        : null,
      directionKey || null,
      validationStatus || null,
      JSON.stringify(issueCodes || []),
      JSON.stringify(evidenceRefs || []),
      beatId || null,
      JSON.stringify(stateTransition || null)
    ]
  );
}

// Canon Bundle is locked once, at Gate 1 (approveCandidate). Every
// generation stage re-loads the bundle fresh but must reject any
// drift from the locked values instead of silently generating
// against a different Canon -- Directions, Outline, and Scripts
// (including Regenerate/Resume attempts) must all see the exact
// same Canon the human approved the candidate against.
function detectCanonMismatch(run, canonBundle) {
  if (
    !run.canon_hash ||
    run.canon_version !== canonBundle.canon_version ||
    run.rules_version !== canonBundle.rules_version ||
    run.season_version !== canonBundle.season_version ||
    run.canon_hash !== canonBundle.canon_hash
  ) {
    const error = new Error(
      `Canon changed during run: locked ${run.canon_hash || "(none)"}, now ${canonBundle.canon_hash}.`
    );
    error.code = "CANON_CHANGED_DURING_RUN";
    return error;
  }

  return null;
}

// =========================================================
// ATOMIC ARTIFACT PERSIST (ownership/lease-checked)
//
// Every persist of generation output -- success or failure --
// happens inside one transaction that starts by re-reading the
// run FOR UPDATE and verifying this worker still owns the
// GENERATING_* claim (status + worker_id + lease not expired).
// If ownership was lost (Cancelled, reclaimed by another worker
// after a stale lease), the whole persist is skipped: no
// artifact rows, no generation_attempts row, no run mutation.
// The Provider HTTP call itself always happens OUTSIDE this
// transaction (before withStageOwnership is invoked).
// =========================================================

async function withStageOwnership(pool, run, stage, fn) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const current = await fetchRunForUpdate(client, run.id);
    const generatingStatus = STAGE_CONFIG[stage].generating;

    // A NULL lease_expires_at is never treated as "no lease
    // needed" -- it is treated as no valid lease at all. Only a
    // non-NULL, still-in-the-future (per Postgres NOW(), not
    // Node's clock) lease counts as ownership.
    const ownershipOk =
      Boolean(current) &&
      current.status === generatingStatus &&
      current.worker_id === run.worker_id &&
      current.lease_is_valid === true;

    if (!ownershipOk) {
      await client.query("ROLLBACK");
      return { ok: false };
    }

    const result = await fn(client, current);

    await client.query("COMMIT");

    return { ok: true, result };
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

async function persistStageFailure(pool, run, stage, error, { requestPayload } = {}) {
  const errorCode = error?.code || error?.storyCode || "GENERATION_FAILED";
  const errorMessage = String(error?.message || "Unknown generation failure");

  const persistOutcome = await withStageOwnership(pool, run, stage, async client => {
    await recordGenerationAttempt(client, {
      runId: run.id,
      stage,
      artifactVersion: null,
      provider: process.env.STORY_LLM_PROVIDER || "gemini",
      model: process.env.STORY_GEMINI_MODEL || "unknown",
      promptVersion: PROMPT_VERSION,
      requestPayload: requestPayload || null,
      responsePayload: null,
      attemptNumber: run.stage_attempt_count,
      status: "FAILED",
      errorCode,
      errorMessage
    });

    const updateResult = await client.query(
      `
        UPDATE story_pipeline_runs
        SET
          status = 'FAILED',
          current_stage = 'FAILED',
          failure_stage = $1,
          error_code = $2,
          error_message = $3,
          worker_id = NULL,
          lease_expires_at = NULL,
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `,
      [
        stage,
        redactSecrets(errorCode),
        redactSecrets(errorMessage.slice(0, 2000)),
        run.id
      ]
    );

    await insertEvent(client, run.id, "STORY_GENERATION_FAILED", stage, {
      error_code: errorCode,
      error_message: redactSecrets(errorMessage.slice(0, 500))
    });

    return updateResult.rows[0];
  });

  if (!persistOutcome.ok) {
    return { outcome: "NO_CHANGE", stage };
  }

  return { outcome: "RUN_FAILED", stage };
}

const PROMPT_VERSION = "story-pipeline-v1";

// Gemini's structured-output engine rejects DIRECTION_JSON_SCHEMA
// wrapped in an array once minItems/maxItems >= 3 (confirmed live
// against gemini-3.1-flash-lite: array length <= 2 with this exact
// per-item schema succeeds, length >= 3 fails with a generic 400
// INVALID_ARGUMENT, independent of anyOf usage, description text,
// or additionalProperties -- a real request-size/complexity limit,
// not a schema bug). A batch is generated as this many separate
// single-direction calls instead of one call requesting the whole
// array; each call still independently enforces full signal-fusion
// coverage via the same per-direction schema.
const DIRECTIONS_PER_BATCH = 4;
const DIRECTION_VALIDATION_MAX_ATTEMPTS = 3;
const OUTLINE_VALIDATION_MAX_ATTEMPTS = 3;
const SCRIPT_VALIDATION_MAX_ATTEMPTS = 3;

function canonicalizeDirectionEvidenceRefs(payload) {
  function walk(value, key = "") {
    if (Array.isArray(value)) {
      return value.map(item =>
        typeof item === "string" && (key === "evidence_refs" || key === "evidence_map")
          ? item.trim()
          : walk(item)
      );
    }

    if (value && typeof value === "object") {
      for (const [childKey, childValue] of Object.entries(value)) {
        value[childKey] = walk(childValue, childKey);
      }
    }

    return value;
  }

  return walk(payload);
}

function directionSchemaForContext({ allowedEvidenceRefs, currentEntityState, allowedNextStates }) {
  const schema = JSON.parse(JSON.stringify(DIRECTION_JSON_SCHEMA));

  function constrainEvidenceRefs(value) {
    if (!value || typeof value !== "object") return;
    if (value.properties && value.properties.evidence_refs) {
      value.properties.evidence_refs.items.enum = allowedEvidenceRefs;
    }
    for (const child of Object.values(value)) constrainEvidenceRefs(child);
  }

  constrainEvidenceRefs(schema);

  const stateChange = schema.properties.proposed_state_changes.items.properties;
  stateChange.target_state.enum = allowedNextStates;
  stateChange.previous_state = {
    anyOf: [{ type: "string", enum: [currentEntityState] }, { type: "null" }]
  };

  return schema;
}

function directionAttemptObservation(direction, validation) {
  const stateChange = Array.isArray(direction.proposed_state_changes)
    ? direction.proposed_state_changes[0] || null
    : null;

  return {
    issueCodes: validation.issues.map(item => item.code),
    evidenceRefs: require("./validators").collectEvidenceRefs(direction),
    beatId: direction.signal_contributions?.apex?.beat_id || null,
    stateTransition: stateChange
      ? { previous_state: stateChange.previous_state, target_state: stateChange.target_state }
      : null
  };
}

async function executeDirectionsGeneration(pool, run, deps) {
  const snapshot = run.candidate_snapshot;
  const revisionNotes = await latestRevisionNotes(pool, run.id, "DIRECTIONS");

  let lastPromptInput = null;
  const directions = [];
  const attempts = [];

  try {
    const canonBundle = deps.loadCanonBundle();
    const canonMismatch = detectCanonMismatch(run, canonBundle);

    if (canonMismatch) {
      throw canonMismatch;
    }

    const evidenceIds = evidenceIdsFromSnapshot(snapshot);
    const allowedEvidenceRefs = [...evidenceIds].sort();
    const currentEntityState = "CANDIDATE_APPROVED";
    const allowedNextStates = CANON_STATE_TRANSITIONS[currentEntityState] || [];
    const stateTransitionContext = {
      current_entity_state: currentEntityState,
      allowed_next_states: allowedNextStates,
      forbidden_state_skips: ["QUALIFIER_PASSED"]
    };
    const validationContext = {
      evidenceIds,
      noPersonSignal: Boolean(snapshot.no_person_signal),
      personCanonicalName: snapshot.person ? snapshot.person.canonical_name : null,
      personAliases: snapshot.person ? snapshot.person.aliases : [],
      hasCountrySignal: Boolean(snapshot.country_news),
      lockedBeatId: run.beat_id,
      lockedCanon: snapshot.locked_canon || null
    };

    for (let i = 0; i < DIRECTIONS_PER_BATCH; i += 1) {
      const directionKey = `DIR-${String(i + 1).padStart(3, "0")}`;
      let retryFeedback = null;
      let finalDirection = null;

      for (let attemptNumber = 1; attemptNumber <= DIRECTION_VALIDATION_MAX_ATTEMPTS; attemptNumber += 1) {
        const prompt = buildDirectionsPrompt({
          canonBundle,
          candidateSnapshot: snapshot,
          creatorNotes: run.creator_notes,
          forbiddenElements: run.forbidden_elements,
          reviewLanguage: run.review_language,
          apexStage: run.apex_stage,
          beatId: run.beat_id,
          revisionNotes,
          targetNarrativeEmphasis:
            NARRATIVE_EMPHASIS_TYPES[i % NARRATIVE_EMPHASIS_TYPES.length],
          usedNarrativeEmphases: directions.map(d => d.narrative_emphasis),
          retryFeedback,
          stateTransitionContext,
          allowedEvidenceRefs
        });

        lastPromptInput = prompt.input;
        const generation = await deps.generateJson({
          task: "STORY_DIRECTIONS",
          systemPrompt: prompt.systemPrompt,
          input: prompt.input,
          schemaName: "story_direction_v1",
          responseJsonSchema: directionSchemaForContext({
            allowedEvidenceRefs,
            currentEntityState,
            allowedNextStates
          }),
          temperature: 0.8,
          validate: parsed => {
            const issues = validateDirectionShape(parsed);
            return { valid: issues.length === 0, errors: issues.map(item => item.message) };
          }
        });

        generation.data.direction_id = directionKey;
        canonicalizeDirectionEvidenceRefs(generation.data);
        const validation = validateDirection(generation.data, validationContext);
        attempts.push({ directionKey, attemptNumber, prompt, generation, validation });
        finalDirection = generation.data;

        if (validation.validation_status === "PASS") break;

        retryFeedback = {
          previous_attempt_failed: true,
          validation_issues: validation.issues.map(item => ({
            code: item.code,
            message: item.message,
            path: item.path,
            allowed_next_states: item.code === "STATE_TRANSITION_INVALID"
              ? allowedNextStates
              : undefined,
            allowed_evidence_refs: item.code === "EVIDENCE_REF_NOT_FOUND"
              ? allowedEvidenceRefs
              : undefined
          }))
        };
      }

      directions.push(finalDirection);
    }
  } catch (error) {
    return persistStageFailure(pool, run, "DIRECTIONS", error, {
      requestPayload: lastPromptInput
    });
  }

  const evidenceIds = evidenceIdsFromSnapshot(snapshot);
  const noPersonSignal = Boolean(snapshot.no_person_signal);
  const personCanonicalName = snapshot.person
    ? snapshot.person.canonical_name
    : null;
  const personAliases = snapshot.person ? snapshot.person.aliases : [];
  const hasCountrySignal = Boolean(snapshot.country_news);
  const lockedBeatId = run.beat_id;

  const { perDirection } = validateDirectionBatch(
    directions,
    {
      evidenceIds,
      noPersonSignal,
      personCanonicalName,
      personAliases,
      hasCountrySignal,
      lockedBeatId
    }
  );

  const persistOutcome = await withStageOwnership(
    pool,
    run,
    "DIRECTIONS",
    async client => {
      const version = await nextArtifactVersion(
        client,
        run.id,
        "story_directions"
      );

      for (let index = 0; index < directions.length; index += 1) {
        const direction = directions[index];
        const result = perDirection[index];

        await client.query(
          `
            INSERT INTO story_directions (
              story_run_id, version, direction_key, direction_type,
              payload, validation_status, validation_issues
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb)
          `,
          [
            run.id,
            version,
            direction.direction_id,
            direction.direction_type,
            JSON.stringify(direction),
            result.validation_status,
            JSON.stringify(result.issues)
          ]
        );
      }

      for (const attempt of attempts) {
        const observation = directionAttemptObservation(
          attempt.generation.data,
          attempt.validation
        );

        await recordGenerationAttempt(client, {
          runId: run.id,
          stage: "DIRECTIONS",
          artifactVersion: version,
          provider: attempt.generation.provider,
          model: attempt.generation.model,
          promptVersion: PROMPT_VERSION,
          requestPayload: attempt.prompt.input,
          responsePayload: attempt.generation.data,
          inputTokens: attempt.generation.inputTokens,
          outputTokens: attempt.generation.outputTokens,
          totalTokens: attempt.generation.totalTokens,
          latencyMs: attempt.generation.latencyMs,
          attemptNumber: attempt.attemptNumber,
          status: attempt.validation.validation_status === "PASS" ? "SUCCESS" : "FAILED",
          errorCode: observation.issueCodes.join(",") || null,
          errorMessage: attempt.validation.validation_status === "BLOCKED"
            ? "Direction blocked by deterministic validators."
            : null,
          directionKey: attempt.directionKey,
          validationStatus: attempt.validation.validation_status,
          ...observation
        });
      }

      const selectableCount = perDirection.filter(
        result => result.validation_status === "PASS"
      ).length;
      const noSelectableDirection = selectableCount === 0;

      const updateResult = await client.query(
        `
          UPDATE story_pipeline_runs
          SET
            status = $2,
            current_stage = $3,
            failure_stage = $4,
            error_code = $5,
            error_message = $6,
            worker_id = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [
          run.id,
          noSelectableDirection ? "FAILED" : "AWAITING_DIRECTION_SELECTION",
          noSelectableDirection ? "FAILED" : "AWAITING_DIRECTION_SELECTION",
          noSelectableDirection ? "DIRECTIONS" : null,
          noSelectableDirection ? "NO_SELECTABLE_DIRECTION" : null,
          noSelectableDirection
            ? "All generated directions remained BLOCKED after validator-guided retries."
            : null
        ]
      );

      await insertEvent(client, run.id, "STORY_DIRECTIONS_GENERATED", "DIRECTIONS", {
        version,
        selectable_direction_count: selectableCount,
        failure_status: noSelectableDirection ? "NO_SELECTABLE_DIRECTION" : null
      });

      return updateResult.rows[0];
    }
  );

  if (!persistOutcome.ok) {
    return { outcome: "NO_CHANGE", stage: "DIRECTIONS" };
  }

  return {
    outcome: "STAGE_ADVANCED",
    stage: "DIRECTIONS",
    run: persistOutcome.result
  };
}

async function executeOutlineGeneration(pool, run, deps) {
  const snapshot = run.candidate_snapshot;
  const revisionNotes = await latestRevisionNotes(pool, run.id, "OUTLINE");

  const selectedIds = Array.isArray(run.selected_direction_ids)
    ? run.selected_direction_ids
    : [];

  let lastPromptInput = null;
  let inheritedSignalContributions;
  let inheritedCoverageStatus;
  const attempts = [];
  let outline = null;

  try {
    const canonBundle = deps.loadCanonBundle();
    const canonMismatch = detectCanonMismatch(run, canonBundle);

    if (canonMismatch) {
      throw canonMismatch;
    }

    const selectedDirectionsResult = await pool.query(
      `
        SELECT * FROM story_directions
        WHERE story_run_id = $1 AND id = ANY($2::bigint[])
        ORDER BY id ASC
      `,
      [run.id, selectedIds]
    );

    const selectedDirectionRows = selectedDirectionsResult.rows;
    const selectedDirections = selectedDirectionRows.map(row => row.payload);

    // signal_contributions / coverage_status are never re-requested
    // from Gemini here -- both are inherited deterministically from
    // the selected direction(s) and the same immutable snapshot facts
    // already used at Direction-generation time (see
    // computeCoverageStatusFromSnapshot / mergeSignalContributions).
    inheritedSignalContributions = mergeSignalContributions(selectedDirections);
    inheritedCoverageStatus = computeCoverageStatusFromSnapshot(snapshot);

    // Sanity invariant, not a validator issue: both sides are pure
    // functions of the same immutable candidate_snapshot, so they must
    // agree. A mismatch means an upstream bug, never something to
    // defer to a BLOCKED validation_status.
    for (const row of selectedDirectionRows) {
      const stored = row.payload && row.payload.coverage_status;

      if (
        stored &&
        (stored.country_signal !== inheritedCoverageStatus.country_signal ||
          stored.person_signal !== inheritedCoverageStatus.person_signal ||
          stored.historical_resonance !== inheritedCoverageStatus.historical_resonance)
      ) {
        fail(
          "INTERNAL_COVERAGE_MISMATCH",
          `Selected direction ${row.id}'s stored coverage_status does not match the candidate snapshot's coverage facts.`,
          500
        );
      }
    }

    const evidenceIds = evidenceIdsFromSnapshot(snapshot);
    const allowedEvidenceRefs = [...evidenceIds].sort();

    const validationContext = {
      evidenceIds,
      noPersonSignal: Boolean(snapshot.no_person_signal),
      personCanonicalName: snapshot.person
        ? snapshot.person.canonical_name
        : null,
      personAliases: snapshot.person ? snapshot.person.aliases : [],
      inheritedSignalContributions,
      inheritedCoverageStatus,
      lockedCanon: snapshot.locked_canon || null
    };

    let retryFeedback = null;

    // The Human Decision from Gate 2 is read directly from the run
    // row -- selection_mode / merge_notes were persisted verbatim by
    // selectDirection, never re-derived from selected_direction_ids
    // .length (which cannot distinguish a deliberate MERGE decision
    // from an accidental two-item array).
    for (
      let attemptNumber = 1;
      attemptNumber <= OUTLINE_VALIDATION_MAX_ATTEMPTS;
      attemptNumber += 1
    ) {
      const prompt = buildOutlinePrompt({
        canonBundle,
        candidateSnapshot: snapshot,
        selectedDirections,
        selectionMode: run.selection_mode,
        mergeNotes: run.merge_notes,
        reviewLanguage: run.review_language,
        forbiddenElements: run.forbidden_elements,
        revisionNotes,
        allowedEvidenceRefs,
        lockedBeatId: run.beat_id,
        retryFeedback
      });

      lastPromptInput = prompt.input;

      const generation = await deps.generateJson({
        task: "STORY_OUTLINE",
        systemPrompt: prompt.systemPrompt,
        input: prompt.input,
        schemaName: "story_outline_v1",
        responseJsonSchema: STORY_OUTLINE_RESPONSE_JSON_SCHEMA,
        temperature: 0.7,
        validate: parsed => {
          const issues = validateOutlineShape(parsed);
          return { valid: issues.length === 0, errors: issues.map(i => i.message) };
        }
      });

      const validation = validateOutline(generation.data, validationContext);
      attempts.push({ attemptNumber, prompt, generation, validation });
      outline = generation.data;

      if (validation.validation_status === "PASS") break;

      retryFeedback = {
        previous_attempt_failed: true,
        validation_issues: validation.issues.map(item => ({
          code: item.code,
          message: item.message,
          path: item.path,
          allowed_evidence_refs:
            item.code === "EVIDENCE_REF_NOT_FOUND" ? allowedEvidenceRefs : undefined
        }))
      };
    }
  } catch (error) {
    return persistStageFailure(pool, run, "OUTLINE", error, {
      requestPayload: lastPromptInput
    });
  }

  const finalAttempt = attempts[attempts.length - 1];
  const result = finalAttempt.validation;

  const persistOutcome = await withStageOwnership(
    pool,
    run,
    "OUTLINE",
    async client => {
      const version = await nextArtifactVersion(client, run.id, "story_outlines");

      await client.query(
        `
          INSERT INTO story_outlines (
            story_run_id, version, payload, validation_status, validation_issues,
            signal_contributions, coverage_status, source_direction_ids, locked_beat_id
          )
          VALUES ($1, $2, $3::jsonb, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9)
        `,
        [
          run.id,
          version,
          JSON.stringify(outline),
          result.validation_status,
          JSON.stringify(result.issues),
          JSON.stringify(inheritedSignalContributions),
          JSON.stringify(inheritedCoverageStatus),
          JSON.stringify(selectedIds.map(id => String(id))),
          run.beat_id || null
        ]
      );

      for (const attempt of attempts) {
        await recordGenerationAttempt(client, {
          runId: run.id,
          stage: "OUTLINE",
          artifactVersion: version,
          provider: attempt.generation.provider,
          model: attempt.generation.model,
          promptVersion: PROMPT_VERSION,
          requestPayload: attempt.prompt.input,
          responsePayload: attempt.generation.data,
          inputTokens: attempt.generation.inputTokens,
          outputTokens: attempt.generation.outputTokens,
          totalTokens: attempt.generation.totalTokens,
          latencyMs: attempt.generation.latencyMs,
          attemptNumber: attempt.attemptNumber,
          status: attempt.validation.validation_status === "PASS" ? "SUCCESS" : "FAILED",
          validationStatus: attempt.validation.validation_status,
          issueCodes: attempt.validation.issues.map(item => item.code),
          beatId: run.beat_id || null
        });
      }

      const updateResult = await client.query(
        `
          UPDATE story_pipeline_runs
          SET
            status = 'AWAITING_OUTLINE_LOCK',
            current_stage = 'AWAITING_OUTLINE_LOCK',
            worker_id = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [run.id]
      );

      await insertEvent(client, run.id, "STORY_OUTLINE_GENERATED", "OUTLINE", {
        version,
        validation_status: result.validation_status
      });

      return updateResult.rows[0];
    }
  );

  if (!persistOutcome.ok) {
    return { outcome: "NO_CHANGE", stage: "OUTLINE" };
  }

  return {
    outcome: "STAGE_ADVANCED",
    stage: "OUTLINE",
    run: persistOutcome.result
  };
}

// Gemini's structured-output engine rejects a schema wrapped in an
// array once minItems/maxItems >= 3 -- the same request-size/
// complexity limit already worked around for Directions (see
// directionSchemaForContext above). SCRIPT_JSON_SCHEMA describes ONE
// Script; each of the three variants is requested as its own call
// with variant_type constrained to exactly that call's target, never
// via the three-item STORY_SCRIPTS_RESPONSE_JSON_SCHEMA wrapper
// (still exported from schemas.js for local batch-shape
// documentation/tests, just never sent to Gemini after this fix).
function scriptSchemaForVariant(targetVariantType) {
  const schema = JSON.parse(JSON.stringify(SCRIPT_JSON_SCHEMA));
  schema.properties.variant_type.enum = [targetVariantType];
  return schema;
}

async function executeScriptsGeneration(pool, run, deps) {
  const snapshot = run.candidate_snapshot;
  const revisionNotes = await latestRevisionNotes(pool, run.id, "SCRIPTS");

  let lastPromptInput = null;
  let lockedOutlineRow;
  const attempts = [];
  const scripts = [];

  try {
    const canonBundle = deps.loadCanonBundle();
    const canonMismatch = detectCanonMismatch(run, canonBundle);

    if (canonMismatch) {
      throw canonMismatch;
    }

    const outlineResult = await pool.query(
      `
        SELECT * FROM story_outlines
        WHERE story_run_id = $1 AND locked_at IS NOT NULL
        ORDER BY locked_at DESC
        LIMIT 1
      `,
      [run.id]
    );

    lockedOutlineRow = outlineResult.rows[0] || null;
    const outline = lockedOutlineRow ? lockedOutlineRow.payload : null;

    // signal_contributions / coverage_status are forward-propagated
    // verbatim from the locked outline -- never re-requested from
    // Gemini here. All three variants share identical signal
    // provenance since they all derive from the one locked outline.
    const inheritedSignalContributions = lockedOutlineRow
      ? lockedOutlineRow.signal_contributions
      : null;
    const inheritedCoverageStatus = lockedOutlineRow
      ? lockedOutlineRow.coverage_status
      : null;

    const evidenceIds = evidenceIdsFromSnapshot(snapshot);
    const allowedEvidenceRefs = [...evidenceIds].sort();

    const validationContext = {
      evidenceIds,
      noPersonSignal: Boolean(snapshot.no_person_signal),
      personCanonicalName: snapshot.person
        ? snapshot.person.canonical_name
        : null,
      personAliases: snapshot.person ? snapshot.person.aliases : [],
      language: run.script_language,
      inheritedSignalContributions,
      inheritedCoverageStatus,
      lockedCanon: snapshot.locked_canon || null
    };

    for (const targetVariantType of SCRIPT_VARIANT_TYPES) {
      let retryFeedback = null;
      let finalScript = null;

      for (
        let attemptNumber = 1;
        attemptNumber <= SCRIPT_VALIDATION_MAX_ATTEMPTS;
        attemptNumber += 1
      ) {
        const prompt = buildScriptsPrompt({
          canonBundle,
          candidateSnapshot: snapshot,
          outline,
          scriptLanguage: run.script_language,
          forbiddenElements: run.forbidden_elements,
          revisionNotes,
          allowedEvidenceRefs,
          lockedBeatId: run.beat_id,
          retryFeedback,
          targetVariantType,
          usedVariantTypes: scripts.map(script => script.variant_type)
        });

        lastPromptInput = prompt.input;

        const generation = await deps.generateJson({
          task: "STORY_SCRIPTS",
          systemPrompt: prompt.systemPrompt,
          input: prompt.input,
          schemaName: "story_script_v1",
          responseJsonSchema: scriptSchemaForVariant(targetVariantType),
          temperature: 0.8,
          validate: parsed => {
            const issues = validateScriptShape(parsed, {
              expectedVariant: targetVariantType,
              language: run.script_language
            });
            return { valid: issues.length === 0, errors: issues.map(i => i.message) };
          }
        });

        const validation = validateScript(generation.data, {
          ...validationContext,
          expectedVariant: targetVariantType
        });

        attempts.push({ targetVariantType, attemptNumber, prompt, generation, validation });
        finalScript = generation.data;

        if (validation.validation_status === "PASS") break;

        retryFeedback = {
          previous_attempt_failed: true,
          validation_issues: validation.issues.map(item => ({
            code: item.code,
            message: item.message,
            path: item.path,
            allowed_evidence_refs:
              item.code === "EVIDENCE_REF_NOT_FOUND" ? allowedEvidenceRefs : undefined
          }))
        };
      }

      scripts.push(finalScript);
    }
  } catch (error) {
    return persistStageFailure(pool, run, "SCRIPTS", error, {
      requestPayload: lastPromptInput
    });
  }

  const evidenceIds = evidenceIdsFromSnapshot(snapshot);
  const noPersonSignal = Boolean(snapshot.no_person_signal);
  const personCanonicalName = snapshot.person
    ? snapshot.person.canonical_name
    : null;
  const personAliases = snapshot.person ? snapshot.person.aliases : [];
  const inheritedSignalContributions = lockedOutlineRow
    ? lockedOutlineRow.signal_contributions
    : null;
  const inheritedCoverageStatus = lockedOutlineRow
    ? lockedOutlineRow.coverage_status
    : null;
  const lockedBeatId = lockedOutlineRow
    ? lockedOutlineRow.locked_beat_id
    : run.beat_id || null;

  // Each variant was generated and retried INDEPENDENTLY above (a
  // failed VEHICLE_FIRST retries only VEHICLE_FIRST, never
  // regenerating an already-successful WORLD_FIRST/CHARACTER_FIRST),
  // but the batch is still the unit of validity at persistence time --
  // this final cross-variant pass (duplicate/missing variant_type,
  // per-script continuity against the locked outline) runs across the
  // three FINAL results exactly as it did when all three came from one
  // call, so a batch-level failure -- or one variant that exhausted
  // its retries still BLOCKED -- still blocks every row from locking,
  // never just the offending one(s).
  const { batch: finalBatch, perScript } = validateScriptBatchWithContext(
    scripts,
    {
      evidenceIds,
      noPersonSignal,
      personCanonicalName,
      personAliases,
      language: run.script_language,
      inheritedSignalContributions,
      inheritedCoverageStatus
    }
  );

  const finalBatchPass =
    finalBatch.validation_status === "PASS" &&
    perScript.every(result => result.validation_status === "PASS");

  const persistOutcome = await withStageOwnership(
    pool,
    run,
    "SCRIPTS",
    async client => {
      const version = await nextArtifactVersion(client, run.id, "story_scripts");

      for (let index = 0; index < scripts.length; index += 1) {
        const script = scripts[index];
        const result = perScript[index];

        const wordCount = countEnglishWords(script.vo_text);
        const duration = computeScriptDuration(script.shots);

        // A batch failure blocks every row from this attempt, even one
        // whose own shape/content happened to validate cleanly -- see
        // finalBatchPass above. The row keeps its own perScript issues
        // (observability must not lose them) plus the batch-level
        // issues plus one explicit marker naming why an
        // otherwise-clean script was still blocked.
        const validationStatus = finalBatchPass
          ? result.validation_status
          : "BLOCKED";
        const validationIssues = finalBatchPass
          ? result.issues
          : [
              ...result.issues,
              ...finalBatch.issues,
              issue(
                "STRUCTURE",
                "SCRIPT_BATCH_BLOCKED",
                "The Script batch did not pass as a complete set, so no variant from this batch may be locked.",
                "scripts"
              )
            ];

        await client.query(
          `
            INSERT INTO story_scripts (
              story_run_id, version, variant_type, payload,
              word_count, estimated_duration_seconds,
              validation_status, validation_issues,
              signal_contributions, coverage_status, source_outline_id, locked_beat_id
            )
            VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb, $11, $12)
          `,
          [
            run.id,
            version,
            script.variant_type,
            JSON.stringify(script),
            wordCount,
            duration,
            validationStatus,
            JSON.stringify(validationIssues),
            JSON.stringify(inheritedSignalContributions),
            JSON.stringify(inheritedCoverageStatus),
            lockedOutlineRow ? lockedOutlineRow.id : null,
            lockedBeatId
          ]
        );
      }

      for (const attempt of attempts) {
        await recordGenerationAttempt(client, {
          runId: run.id,
          stage: "SCRIPTS",
          artifactVersion: version,
          provider: attempt.generation.provider,
          model: attempt.generation.model,
          promptVersion: PROMPT_VERSION,
          requestPayload: attempt.prompt.input,
          responsePayload: attempt.generation.data,
          inputTokens: attempt.generation.inputTokens,
          outputTokens: attempt.generation.outputTokens,
          totalTokens: attempt.generation.totalTokens,
          latencyMs: attempt.generation.latencyMs,
          attemptNumber: attempt.attemptNumber,
          status: attempt.validation.validation_status === "PASS" ? "SUCCESS" : "FAILED",
          validationStatus: attempt.validation.validation_status,
          issueCodes: attempt.validation.issues.map(item => item.code),
          beatId: lockedBeatId
        });
      }

      const updateResult = await client.query(
        `
          UPDATE story_pipeline_runs
          SET
            status = 'AWAITING_SCRIPT_LOCK',
            current_stage = 'AWAITING_SCRIPT_LOCK',
            worker_id = NULL,
            lease_expires_at = NULL,
            updated_at = NOW()
          WHERE id = $1
          RETURNING *
        `,
        [run.id]
      );

      await insertEvent(client, run.id, "STORY_SCRIPTS_GENERATED", "SCRIPTS", {
        version
      });

      return updateResult.rows[0];
    }
  );

  if (!persistOutcome.ok) {
    return { outcome: "NO_CHANGE", stage: "SCRIPTS" };
  }

  return {
    outcome: "STAGE_ADVANCED",
    stage: "SCRIPTS",
    run: persistOutcome.result
  };
}

function validateScriptBatchWithContext(scripts, context) {
  const { validateScriptBatch } = require("./validators");
  return validateScriptBatch(scripts, context);
}

async function processNextStoryRun(pool, options = {}) {
  const {
    workerId,
    generateJsonFn = generateJson,
    loadCanonBundleFn = loadCanonBundle,
    onStageStarted = null
  } = options;

  const claimed = await claimNextStoryRun(pool, workerId);

  if (!claimed) {
    return null;
  }

  if (claimed.outcome === "RUN_FAILED") {
    return {
      outcome: "RUN_FAILED",
      stage: claimed.stage,
      runId: String(claimed.run.id),
      errorCode: claimed.run.error_code
    };
  }

  const deps = {
    generateJson: generateJsonFn,
    loadCanonBundle: loadCanonBundleFn
  };

  const run = claimed.run;

  if (onStageStarted) {
    onStageStarted(claimed.stage, run);
  }

  if (claimed.stage === "DIRECTIONS") {
    return executeDirectionsGeneration(pool, run, deps);
  }

  if (claimed.stage === "OUTLINE") {
    return executeOutlineGeneration(pool, run, deps);
  }

  return executeScriptsGeneration(pool, run, deps);
}

module.exports = {
  StoryError,
  STORY_STATUSES,
  TERMINAL_STATUSES,
  STAGE_CONFIG,
  STORY_LEASE_DURATION_MS,
  STORY_MAX_STAGE_ATTEMPTS,
  APEX_STAGE_ALLOWLIST,
  buildCandidateSnapshot,
  evidenceIdsFromSnapshot,
  computeCoverageStatusFromSnapshot,
  mergeSignalContributions,
  createStoryRun,
  approveCandidate,
  selectDirection,
  lockOutline,
  lockScript,
  regenerateStage,
  cancelRun,
  resumeRun,
  claimNextStoryRun,
  executeDirectionsGeneration,
  executeOutlineGeneration,
  executeScriptsGeneration,
  processNextStoryRun,
  fetchRun,
  detectCanonMismatch,
  withStageOwnership,
  persistStageFailure
};

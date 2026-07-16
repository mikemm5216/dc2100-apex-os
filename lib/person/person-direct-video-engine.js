// =========================================================
// PERSON DIRECT VIDEO ENGINE
//
// Claims queued person-direct-video runs. For each ACTIVE
// catalog person, issues a REAL per-person YouTube search --
// never a scan of the first N ingested vehicle signals --
// fetches full video metadata, validates that the person is
// DIRECTLY mentioned (title / tags / description), and
// persists the single highest-viewed matching video.
//
// Search calls are strictly sequential (one person at a time,
// awaited); nothing here ever issues parallel YouTube
// requests. GET reads of the resulting pack never call this
// engine and never write to the database -- they only read
// whatever the most recent completed run persisted.
// =========================================================

const {
  aliasMatchesNormalizedText,
  normalizePersonText
} = require("./normalization");

const { sanitizeQueryTerm } = require("./query-builder");

const {
  fetchVideos,
  searchVideos
} = require("../scanner/youtube");
const {
  governedSearchVideos,
  SearchBudgetExhaustedError
} = require("../scanner/search-governor");

const {
  classifyShortFormat,
  parseIso8601Duration
} = require("../scanner/metrics");

const SEARCH_MAX_RESULTS = 20;
const DESCRIPTION_EXCERPT_LENGTH = 500;

const RESOLVER_VERSION = "person-direct-video-search-v1";

const MAX_ENTITIES_LIMITS = { min: 1, max: 50, fallback: 50 };

const DIRECT_MENTION_FIELDS = ["TITLE", "TAGS", "DESCRIPTION"];

const HISTORY_SCOPES_ALLOWED = new Set([
  "ONE_YEAR",
  "TEN_YEARS",
  "ALL_TIME"
]);
const HISTORY_SCOPE_FALLBACK = "ALL_TIME";

const FORMATS_ALLOWED = new Set(["SHORTS", "ALL"]);
const FORMAT_FALLBACK = "SHORTS";

function clampInteger(value, { min, max, fallback }) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizePersonDirectVideoRunPayload(
  payload = {}
) {
  const requestedScope = String(
    payload.history_scope || ""
  ).toUpperCase();

  const historyScope = HISTORY_SCOPES_ALLOWED.has(
    requestedScope
  )
    ? requestedScope
    : HISTORY_SCOPE_FALLBACK;

  const requestedFormat = String(
    payload.format || ""
  ).toUpperCase();

  const format = FORMATS_ALLOWED.has(requestedFormat)
    ? requestedFormat
    : FORMAT_FALLBACK;

  return {
    historyScope,
    format,
    maxEntities: clampInteger(
      payload.max_entities,
      MAX_ENTITIES_LIMITS
    ),
    stationRunKey: payload.station_run_key ? String(payload.station_run_key) : null
  };
}

// Cumulative history scope: ONE_YEAR and TEN_YEARS impose a
// published_at lower bound; ALL_TIME has none.
function historyScopeCutoff(historyScope, now) {
  if (historyScope === "ONE_YEAR") {
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() - 1);
    return cutoff;
  }

  if (historyScope === "TEN_YEARS") {
    const cutoff = new Date(now);
    cutoff.setFullYear(cutoff.getFullYear() - 10);
    return cutoff;
  }

  return null;
}

// =========================================================
// RUN QUEUE
// =========================================================

async function claimNextPersonDirectVideoRun(
  pool,
  workerId
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const queuedResult = await client.query(
      `
        SELECT
          id,
          request_payload
        FROM person_direct_video_signal_runs
        WHERE status = 'QUEUED'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `
    );

    if (queuedResult.rowCount === 0) {
      await client.query("COMMIT");
      return null;
    }

    const run = queuedResult.rows[0];

    await client.query(
      `
        UPDATE person_direct_video_signal_runs
        SET
          status = 'RUNNING',
          locked_by = $1,
          locked_at = NOW(),
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW()
        WHERE id = $2
      `,
      [workerId, run.id]
    );

    await client.query("COMMIT");

    return run;
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
// ENTITY SELECTION
// =========================================================

async function fetchActivePeople(pool, { maxEntities }) {
  const result = await pool.query(
    `
      SELECT id, slug, canonical_name, aliases, role_category
      FROM people
      WHERE active = TRUE
      ORDER BY id ASC
      LIMIT $1
    `,
    [maxEntities]
  );

  return result.rows;
}

// The strongest vehicle association a person carries, used
// only to sharpen the search query (never to substitute for
// direct-mention validation).
async function fetchStrongestAssociation(pool, personId) {
  const result = await pool.query(
    `
      SELECT
        vehicle_brand,
        vehicle_series,
        vehicle_model,
        relation_type,
        link_confidence
      FROM vehicle_person_links
      WHERE person_id = $1
      ORDER BY
        link_confidence DESC NULLS LAST,
        id ASC
      LIMIT 1
    `,
    [personId]
  );

  return result.rows[0] || null;
}

function buildDirectHookSearchQuery(person, association) {
  const name = sanitizeQueryTerm(person.canonical_name);

  if (!name) {
    return "";
  }

  const vehicleTerm = sanitizeQueryTerm(
    association
      ? association.vehicle_model ||
        association.vehicle_series ||
        association.vehicle_brand ||
        ""
      : ""
  );

  return [name, vehicleTerm].filter(Boolean).join(" ");
}

// =========================================================
// CANDIDATE VALIDATION
// =========================================================

// Direct Mention only counts from TITLE / TAGS / DESCRIPTION.
// CHANNEL_TITLE is supplementary evidence only -- it can never
// establish a Direct Mention on its own, because a channel
// named after the person does not mean this specific video is
// about them.
function evaluateCandidate(
  video,
  { terms, historyScope, format, now }
) {
  const normalizedTitle = normalizePersonText(video.title);

  const titleMatch = terms.find(term =>
    aliasMatchesNormalizedText(normalizedTitle, term)
  );

  const normalizedTags = normalizePersonText(
    (Array.isArray(video.tags) ? video.tags : []).join(" ")
  );

  const tagsMatch = terms.find(term =>
    aliasMatchesNormalizedText(normalizedTags, term)
  );

  const normalizedDescription = normalizePersonText(
    video.description
  );

  const descriptionMatch = terms.find(term =>
    aliasMatchesNormalizedText(normalizedDescription, term)
  );

  const normalizedChannel = normalizePersonText(
    video.channelTitle
  );

  const channelMatch = terms.find(term =>
    aliasMatchesNormalizedText(normalizedChannel, term)
  );

  let field = null;
  let matchedAlias = null;

  if (titleMatch) {
    field = "TITLE";
    matchedAlias = titleMatch;
  } else if (tagsMatch) {
    field = "TAGS";
    matchedAlias = tagsMatch;
  } else if (descriptionMatch) {
    field = "DESCRIPTION";
    matchedAlias = descriptionMatch;
  }

  if (!field) {
    // CHANNEL_TITLE-only matches are rejected as a Direct
    // Mention, even though the evidence is recorded above the
    // call site for auditability.
    return null;
  }

  const cutoff = historyScopeCutoff(historyScope, now);

  if (cutoff) {
    const publishedTime = video.publishedAt
      ? new Date(video.publishedAt).getTime()
      : NaN;

    if (
      Number.isNaN(publishedTime) ||
      publishedTime < cutoff.getTime()
    ) {
      return null;
    }
  }

  const durationSeconds = parseIso8601Duration(
    video.duration
  );

  const shortInfo = classifyShortFormat(durationSeconds);

  if (format === "SHORTS" && !shortInfo.isShort) {
    return null;
  }

  return {
    video,
    durationSeconds,
    shortInfo,
    field,
    matchedAlias,
    channelSupplementaryMatch: Boolean(channelMatch),
    views: Math.max(0, Number(video.views) || 0)
  };
}

// views DESC, published_at DESC, external_video_id ASC.
function rankCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    if (a.views !== b.views) {
      return b.views - a.views;
    }

    const timeA = a.video.publishedAt
      ? new Date(a.video.publishedAt).getTime()
      : 0;
    const timeB = b.video.publishedAt
      ? new Date(b.video.publishedAt).getTime()
      : 0;

    if (timeA !== timeB) {
      return timeB - timeA;
    }

    return a.video.videoId.localeCompare(b.video.videoId);
  });
}

// =========================================================
// PERSISTENCE
// =========================================================

async function lookupExistingSignalId(pool, externalVideoId) {
  const result = await pool.query(
    `
      SELECT id
      FROM signals
      WHERE external_id = $1
      LIMIT 1
    `,
    [externalVideoId]
  );

  return result.rowCount > 0 ? result.rows[0].id : null;
}

async function upsertPersonDirectVideoSignal(
  pool,
  {
    personId,
    signalId,
    video,
    durationSeconds,
    matchedAlias,
    field,
    searchQuery,
    evidence
  }
) {
  const existing = await pool.query(
    `
      SELECT id
      FROM person_direct_video_signals
      WHERE person_id = $1
        AND external_video_id = $2
    `,
    [personId, video.videoId]
  );

  const inserted = existing.rowCount === 0;

  const result = await pool.query(
    `
      INSERT INTO person_direct_video_signals (
        person_id,
        signal_id,
        external_video_id,
        video_title,
        video_url,
        thumbnail_url,
        video_views,
        published_at,
        channel_id,
        channel_title,
        duration_seconds,
        description_excerpt,
        tags,
        search_query,
        matched_alias,
        direct_mention_field,
        evidence,
        resolver_version,
        computed_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13::jsonb, $14, $15, $16,
        $17::jsonb, $18, NOW(), NOW()
      )
      ON CONFLICT (person_id, external_video_id)
      DO UPDATE SET
        signal_id = EXCLUDED.signal_id,
        video_title = EXCLUDED.video_title,
        video_url = EXCLUDED.video_url,
        thumbnail_url = EXCLUDED.thumbnail_url,
        video_views = EXCLUDED.video_views,
        published_at = EXCLUDED.published_at,
        channel_id = EXCLUDED.channel_id,
        channel_title = EXCLUDED.channel_title,
        duration_seconds = EXCLUDED.duration_seconds,
        description_excerpt = EXCLUDED.description_excerpt,
        tags = EXCLUDED.tags,
        search_query = EXCLUDED.search_query,
        matched_alias = EXCLUDED.matched_alias,
        direct_mention_field = EXCLUDED.direct_mention_field,
        evidence = EXCLUDED.evidence,
        resolver_version = EXCLUDED.resolver_version,
        computed_at = NOW(),
        updated_at = NOW()
      RETURNING id
    `,
    [
      personId,
      signalId,
      video.videoId,
      video.title,
      `https://www.youtube.com/watch?v=${video.videoId}`,
      video.thumbnailUrl,
      Math.max(0, Number(video.views) || 0),
      video.publishedAt,
      video.channelId,
      video.channelTitle,
      durationSeconds,
      (video.description || "").slice(
        0,
        DESCRIPTION_EXCERPT_LENGTH
      ),
      JSON.stringify(
        Array.isArray(video.tags) ? video.tags : []
      ),
      searchQuery,
      matchedAlias,
      field,
      JSON.stringify(evidence),
      RESOLVER_VERSION
    ]
  );

  return { id: result.rows[0].id, inserted };
}

// =========================================================
// RUN EXECUTION
// =========================================================

function createRunState(options) {
  return {
    entitiesAttempted: 0,
    completedEntityCount: 0,
    failedEntityCount: 0,
    searchQueryCount: 0,
    searchCacheHitCount: 0,
    searchBudgetExhausted: false,
    videosDiscoveredCount: 0,
    videosEvaluatedCount: 0,
    videosMatchedCount: 0,
    signalsInsertedCount: 0,
    signalsUpdatedCount: 0,
    noMatchEntityCount: 0,
    quotaUnits: 0,

    entityResults: [],
    errors: [],

    options
  };
}

function buildRunSummary(state) {
  return {
    entities_attempted: state.entitiesAttempted,
    search_queries: state.searchQueryCount,
    search_cache_hits: state.searchCacheHitCount,
    result_code: state.searchBudgetExhausted ? "SEARCH_BUDGET_EXHAUSTED" : null,
    videos_discovered: state.videosDiscoveredCount,
    videos_evaluated: state.videosEvaluatedCount,
    videos_matched: state.videosMatchedCount,
    signals_inserted: state.signalsInsertedCount,
    signals_updated: state.signalsUpdatedCount,
    no_match_entities: state.noMatchEntityCount,
    quota_units: state.quotaUnits,
    errors: state.errors,

    entity_results: state.entityResults,

    resolver_version: RESOLVER_VERSION,
    history_scope: state.options.historyScope,
    format: state.options.format,
    max_entities: state.options.maxEntities
  };
}

async function updateRunProgress(pool, runId, state) {
  await pool.query(
    `
      UPDATE person_direct_video_signal_runs
      SET
        entities_attempted = $1,
        search_query_count = $2,
        videos_discovered_count = $3,
        videos_evaluated_count = $4,
        videos_matched_count = $5,
        signals_inserted_count = $6,
        signals_updated_count = $7,
        no_match_entity_count = $8,
        quota_units_estimated = $9,
        summary = $10::jsonb,
        updated_at = NOW()
      WHERE id = $11
    `,
    [
      state.entitiesAttempted,
      state.searchQueryCount,
      state.videosDiscoveredCount,
      state.videosEvaluatedCount,
      state.videosMatchedCount,
      state.signalsInsertedCount,
      state.signalsUpdatedCount,
      state.noMatchEntityCount,
      state.quotaUnits,
      JSON.stringify(buildRunSummary(state)),
      runId
    ]
  );
}

async function finalizeRun(pool, runId, state) {
  const completed = state.completedEntityCount > 0;
  const status = state.searchBudgetExhausted
    ? "PARTIAL"
    : (completed ? "COMPLETED" : "FAILED");

  const errorMessage = completed
    ? null
    : (
        state.errors
          .slice(0, 3)
          .map(item => `${item.person_slug}: ${item.message}`)
          .join(" | ") ||
        "No people were processed successfully."
      );

  await pool.query(
    `
      UPDATE person_direct_video_signal_runs
      SET
        status = $1,
        entities_attempted = $2,
        search_query_count = $3,
        videos_discovered_count = $4,
        videos_evaluated_count = $5,
        videos_matched_count = $6,
        signals_inserted_count = $7,
        signals_updated_count = $8,
        no_match_entity_count = $9,
        quota_units_estimated = $10,
        summary = $11::jsonb,
        error_message = $12,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $13
    `,
    [
      status,
      state.entitiesAttempted,
      state.searchQueryCount,
      state.videosDiscoveredCount,
      state.videosEvaluatedCount,
      state.videosMatchedCount,
      state.signalsInsertedCount,
      state.signalsUpdatedCount,
      state.noMatchEntityCount,
      state.quotaUnits,
      JSON.stringify(buildRunSummary(state)),
      errorMessage,
      runId
    ]
  );

  return {
    runId: String(runId),
    status,
    ...state
  };
}

async function failPersonDirectVideoRun(pool, runId, error) {
  await pool.query(
    `
      UPDATE person_direct_video_signal_runs
      SET
        status = 'FAILED',
        error_message = $1,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `,
    [
      String(
        error?.message ||
        "Unknown person direct video failure"
      ).slice(0, 2000),
      runId
    ]
  );
}

async function processPersonEntity(
  pool,
  person,
  state,
  { apiKey, now }
) {
  const association = await fetchStrongestAssociation(
    pool,
    person.id
  );

  const query = buildDirectHookSearchQuery(
    person,
    association
  );

  const result = {
    person_slug: person.slug,
    query,
    status: "NO_MATCH"
  };

  if (!query) {
    state.noMatchEntityCount += 1;
    state.entityResults.push(result);
    return;
  }

  const terms = [
    person.canonical_name,
    ...(Array.isArray(person.aliases) ? person.aliases : [])
  ].filter(Boolean);

  state.searchQueryCount += 1;

  // The search call itself is never scoped by publishedAfter --
  // history_scope and format are applied to the fetched
  // candidates below, before ranking, so the correct video for
  // THIS run's scope/format is what gets persisted.
  const searchResult = await governedSearchVideos({
    pool,
    engine: "PERSON",
    query,
    format: state.options.format,
    apiKey,
    maxResults: SEARCH_MAX_RESULTS,
    searchVideos,
    stationRunKey: state.options.stationRunKey,
    stationCategory: "person",
    onRequest() { state.quotaUnits += 1; }
  });
  const videoIds = searchResult.videoIds;
  if (searchResult.cacheHit) state.searchCacheHitCount += 1;

  state.videosDiscoveredCount += videoIds.length;

  const videos = await fetchVideos(videoIds, {
    apiKey,
    onRequest() {
      state.quotaUnits += 1;
    }
  });

  state.videosEvaluatedCount += videos.length;

  const candidates = videos
    .map(video =>
      evaluateCandidate(video, {
        terms,
        historyScope: state.options.historyScope,
        format: state.options.format,
        now
      })
    )
    .filter(Boolean);

  if (candidates.length === 0) {
    state.noMatchEntityCount += 1;
    state.entityResults.push(result);
    return;
  }

  const [best] = rankCandidates(candidates);

  const existingSignalId = await lookupExistingSignalId(
    pool,
    best.video.videoId
  );

  const saved = await upsertPersonDirectVideoSignal(pool, {
    personId: person.id,
    signalId: existingSignalId,
    video: best.video,
    durationSeconds: best.durationSeconds,
    matchedAlias: best.matchedAlias,
    field: best.field,
    searchQuery: query,
    evidence: {
      matched_alias: best.matchedAlias,
      field: best.field,
      channel_title_supplementary_match:
        best.channelSupplementaryMatch,
      short_format: best.shortInfo.shortFormat
    }
  });

  if (saved.inserted) {
    state.signalsInsertedCount += 1;
  } else {
    state.signalsUpdatedCount += 1;
  }

  state.videosMatchedCount += 1;

  result.status = "MATCHED";
  result.external_video_id = best.video.videoId;
  state.entityResults.push(result);
}

async function executePersonDirectVideoRun(
  pool,
  run,
  { apiKey, now = new Date(), onEntityCompleted = null } = {}
) {
  const options = normalizePersonDirectVideoRunPayload(
    run.request_payload
  );

  const state = createRunState(options);

  const people = await fetchActivePeople(pool, {
    maxEntities: options.maxEntities
  });

  state.entitiesAttempted = people.length;

  await updateRunProgress(pool, run.id, state);

  for (const person of people) {
    try {
      await processPersonEntity(pool, person, state, {
        apiKey,
        now
      });

      state.completedEntityCount += 1;

      if (onEntityCompleted) {
        onEntityCompleted(person, state);
      }
    } catch (error) {
      state.failedEntityCount += 1;

      state.errors.push({
        person_slug: person.slug,
        code: error?.code || null,
        message: String(
          error?.message ||
          "Unknown person direct video failure"
        ).slice(0, 500)
      });
      if (error instanceof SearchBudgetExhaustedError ||
        error?.code === "SEARCH_BUDGET_EXHAUSTED") {
        state.searchBudgetExhausted = true;
        await updateRunProgress(pool, run.id, state);
        break;
      }
    }

    await updateRunProgress(pool, run.id, state);
  }

  return finalizeRun(pool, run.id, state);
}

async function processNextPersonDirectVideoRun(
  pool,
  {
    workerId,
    apiKey,
    now = new Date(),
    onRunStarted = null,
    onEntityCompleted = null
  } = {}
) {
  const run = await claimNextPersonDirectVideoRun(
    pool,
    workerId
  );

  if (!run) {
    return null;
  }

  if (onRunStarted) {
    onRunStarted(run);
  }

  try {
    return await executePersonDirectVideoRun(pool, run, {
      apiKey,
      now,
      onEntityCompleted
    });
  } catch (error) {
    await failPersonDirectVideoRun(pool, run.id, error);
    throw error;
  }
}

module.exports = {
  DIRECT_MENTION_FIELDS,
  RESOLVER_VERSION,
  buildDirectHookSearchQuery,
  claimNextPersonDirectVideoRun,
  evaluateCandidate,
  executePersonDirectVideoRun,
  fetchActivePeople,
  normalizePersonDirectVideoRunPayload,
  processNextPersonDirectVideoRun,
  rankCandidates
};

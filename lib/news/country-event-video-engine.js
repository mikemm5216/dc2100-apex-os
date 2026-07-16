// =========================================================
// COUNTRY EVENT VIDEO ENGINE
//
// Claims queued country-event-video runs. For each country's
// CURRENT highest-traffic news event (country_news_signals,
// within a rolling window), issues a REAL YouTube search --
// never a scan of already-ingested vehicle signals -- fetches
// full video metadata, validates country + event relevance,
// and persists the single highest-velocity matching video.
//
// Search calls are strictly sequential (one country at a
// time, awaited); nothing here ever issues parallel YouTube
// requests. GET reads of the resulting pack never call this
// engine and never write to the database -- they only read
// whatever the most recent completed run persisted.
// =========================================================

const {
  getCountryAliases,
  sanitizeQueryTerm
} = require("./country-query-catalog");

const { CATEGORY_RULES } = require("./classification");

const {
  aliasMatchesNormalizedText,
  normalizePersonText
} = require("../person/normalization");

const {
  fetchVideos,
  searchVideos
} = require("../scanner/youtube");

const {
  classifyShortFormat,
  parseIso8601Duration
} = require("../scanner/metrics");

const WINDOW_HOURS_ALLOWED = [24, 72, 168];
const WINDOW_HOURS_FALLBACK = 168;

const FORMATS_ALLOWED = new Set(["SHORTS", "ALL"]);

const SEARCH_MAX_RESULTS = 20;
const DESCRIPTION_EXCERPT_LENGTH = 500;
const EVENT_KEYWORD_LIMIT = 3;

const RESOLVER_VERSION = "country-event-video-search-v1";

const MAX_ENTITIES_LIMITS = { min: 1, max: 50, fallback: 20 };

function clampInteger(value, { min, max, fallback }) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizeCountryEventVideoRunPayload(
  payload = {}
) {
  const requestedWindow = Number(payload.window_hours);

  const windowHours = WINDOW_HOURS_ALLOWED.includes(
    requestedWindow
  )
    ? requestedWindow
    : WINDOW_HOURS_FALLBACK;

  const format = FORMATS_ALLOWED.has(
    String(payload.format || "").toUpperCase()
  )
    ? String(payload.format).toUpperCase()
    : "SHORTS";

  return {
    windowHours,
    format,
    maxEntities: clampInteger(
      payload.max_entities,
      MAX_ENTITIES_LIMITS
    )
  };
}

// =========================================================
// RUN QUEUE
// =========================================================

async function claimNextCountryEventVideoRun(
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
        FROM country_event_video_signal_runs
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
        UPDATE country_event_video_signal_runs
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

// One representative country_news_signal per country within
// the window (highest traffic_score) -- the CURRENT event for
// that country. Independent of signals.resolved_country_id.
async function fetchRepresentativeCountryNewsSignals(
  pool,
  { windowHours, maxEntities }
) {
  const result = await pool.query(
    `
      SELECT DISTINCT ON (cns.country_id)
        cns.id,
        cns.country_id,
        cns.category,
        cns.keywords,
        cns.conflict_archetypes,
        cns.canonical_title,
        cns.title,
        cns.representative_url,
        cns.traffic_score
      FROM country_news_signals cns
      WHERE
        COALESCE(cns.published_at, cns.last_seen_at) >=
          NOW() - (($1::text || ' hours')::interval)
      ORDER BY
        cns.country_id ASC,
        cns.traffic_score DESC,
        cns.id DESC
    `,
    [windowHours]
  );

  return result.rows
    .sort((a, b) => Number(b.traffic_score) - Number(a.traffic_score))
    .slice(0, maxEntities);
}

async function fetchCountriesById(pool, countryIds) {
  if (countryIds.length === 0) {
    return new Map();
  }

  const result = await pool.query(
    `
      SELECT id, code, name
      FROM countries
      WHERE id IN (${
        countryIds.map((_, index) => `$${index + 1}`).join(", ")
      })
    `,
    countryIds
  );

  return new Map(
    result.rows.map(row => [String(row.id), row])
  );
}

// Category keyword fallback used only when a country_news_signal
// has no extracted keywords of its own -- the same deterministic
// CATEGORY_RULES table the news classifier already uses, never
// a free-text or AI-generated keyword.
function eventKeywordTerms(newsSignal) {
  const keywords = (
    Array.isArray(newsSignal.keywords)
      ? newsSignal.keywords
      : []
  ).filter(Boolean);

  if (keywords.length > 0) {
    return keywords;
  }

  const rule = CATEGORY_RULES.find(
    ([category]) => category === newsSignal.category
  );

  return rule ? rule[1] : [];
}

function buildEventSearchQuery(country, newsSignal) {
  const keywordTerms = eventKeywordTerms(newsSignal).slice(
    0,
    EVENT_KEYWORD_LIMIT
  );

  const parts = [country.name, ...keywordTerms].filter(
    Boolean
  );

  return sanitizeQueryTerm(parts.join(" "));
}

// =========================================================
// CANDIDATE VALIDATION
// =========================================================

function ageHoursOf(publishedAt, now) {
  const publishedTime = publishedAt
    ? new Date(publishedAt).getTime()
    : NaN;

  if (Number.isNaN(publishedTime)) {
    return null;
  }

  return (now.getTime() - publishedTime) / 3600000;
}

// Validates ONE search result against the country + event and
// the caller-supplied window. Country evidence alone is never
// enough -- an event keyword must ALSO match, and the match
// must come from the video's own title/description/tags, not
// just the fact that the country name appears somewhere.
function evaluateCandidate(
  video,
  { country, countryTerms, keywordTerms, windowHours, format, now }
) {
  const age = ageHoursOf(video.publishedAt, now);

  if (age === null || age < 0 || age > windowHours) {
    return null;
  }

  const durationSeconds = parseIso8601Duration(
    video.duration
  );

  const shortInfo = classifyShortFormat(durationSeconds);

  if (format === "SHORTS" && !shortInfo.isShort) {
    return null;
  }

  const combinedText = [
    video.title,
    video.description,
    ...(Array.isArray(video.tags) ? video.tags : [])
  ]
    .filter(Boolean)
    .join(" ");

  const normalizedCombined = normalizePersonText(
    combinedText
  );

  const matchedCountryTerm = countryTerms.find(term =>
    aliasMatchesNormalizedText(normalizedCombined, term)
  );

  if (!matchedCountryTerm) {
    return null;
  }

  const matchedEventTerm = keywordTerms.find(term =>
    aliasMatchesNormalizedText(normalizedCombined, term)
  );

  if (!matchedEventTerm) {
    // The country name alone is never sufficient.
    return null;
  }

  const views = Math.max(0, Number(video.views) || 0);
  const viewsPerHour = views / Math.max(age, 1 / 60);

  return {
    video,
    durationSeconds,
    shortInfo,
    matchedCountryTerm,
    matchedEventTerm,
    views,
    viewsPerHour,
    ageHours: age
  };
}

// views_per_hour DESC, views DESC, published_at DESC,
// external_video_id ASC.
function rankCandidates(candidates) {
  return [...candidates].sort((a, b) => {
    if (a.viewsPerHour !== b.viewsPerHour) {
      return b.viewsPerHour - a.viewsPerHour;
    }

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

async function upsertCountryEventVideoSignal(
  pool,
  {
    countryNewsSignalId,
    countryId,
    signalId,
    video,
    durationSeconds,
    matchedCountryTerm,
    matchedEventTerm,
    viewsPerHour,
    searchQuery,
    evidence
  }
) {
  const existing = await pool.query(
    `
      SELECT id
      FROM country_event_video_signals
      WHERE country_news_signal_id = $1
        AND external_video_id = $2
    `,
    [countryNewsSignalId, video.videoId]
  );

  const inserted = existing.rowCount === 0;

  const result = await pool.query(
    `
      INSERT INTO country_event_video_signals (
        country_news_signal_id,
        country_id,
        signal_id,
        external_video_id,
        video_title,
        video_url,
        thumbnail_url,
        video_views,
        views_per_hour,
        published_at,
        channel_id,
        channel_title,
        duration_seconds,
        description_excerpt,
        tags,
        search_query,
        matched_country_term,
        matched_event_term,
        evidence,
        resolver_version,
        computed_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15::jsonb, $16, $17, $18,
        $19::jsonb, $20, NOW(), NOW()
      )
      ON CONFLICT (country_news_signal_id, external_video_id)
      DO UPDATE SET
        signal_id = EXCLUDED.signal_id,
        video_title = EXCLUDED.video_title,
        video_url = EXCLUDED.video_url,
        thumbnail_url = EXCLUDED.thumbnail_url,
        video_views = EXCLUDED.video_views,
        views_per_hour = EXCLUDED.views_per_hour,
        published_at = EXCLUDED.published_at,
        channel_id = EXCLUDED.channel_id,
        channel_title = EXCLUDED.channel_title,
        duration_seconds = EXCLUDED.duration_seconds,
        description_excerpt = EXCLUDED.description_excerpt,
        tags = EXCLUDED.tags,
        search_query = EXCLUDED.search_query,
        matched_country_term = EXCLUDED.matched_country_term,
        matched_event_term = EXCLUDED.matched_event_term,
        evidence = EXCLUDED.evidence,
        resolver_version = EXCLUDED.resolver_version,
        computed_at = NOW(),
        updated_at = NOW()
      RETURNING id
    `,
    [
      countryNewsSignalId,
      countryId,
      signalId,
      video.videoId,
      video.title,
      `https://www.youtube.com/watch?v=${video.videoId}`,
      video.thumbnailUrl,
      Math.max(0, Number(video.views) || 0),
      viewsPerHour,
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
      matchedCountryTerm,
      matchedEventTerm,
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
    window_hours: state.options.windowHours,
    format: state.options.format,
    max_entities: state.options.maxEntities
  };
}

async function updateRunProgress(pool, runId, state) {
  await pool.query(
    `
      UPDATE country_event_video_signal_runs
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
  const status = completed ? "COMPLETED" : "FAILED";

  const errorMessage = completed
    ? null
    : (
        state.errors
          .slice(0, 3)
          .map(item => `${item.country_code}: ${item.message}`)
          .join(" | ") ||
        "No countries were processed successfully."
      );

  await pool.query(
    `
      UPDATE country_event_video_signal_runs
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

async function failCountryEventVideoRun(pool, runId, error) {
  await pool.query(
    `
      UPDATE country_event_video_signal_runs
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
        "Unknown country event video failure"
      ).slice(0, 2000),
      runId
    ]
  );
}

async function processCountryEntity(
  pool,
  { country, newsSignal },
  state,
  { apiKey, now }
) {
  const options = state.options;

  const countryTerms = [
    country.name,
    ...(getCountryAliases(country.code) || [])
  ].filter(Boolean);

  const keywordTerms = eventKeywordTerms(newsSignal);

  const query = buildEventSearchQuery(country, newsSignal);

  const result = {
    country_code: country.code,
    query,
    status: "NO_MATCH"
  };

  if (
    !query ||
    countryTerms.length === 0 ||
    keywordTerms.length === 0
  ) {
    state.noMatchEntityCount += 1;
    state.entityResults.push(result);
    return;
  }

  const cutoffIso = new Date(
    now.getTime() - options.windowHours * 3600000
  ).toISOString();

  state.searchQueryCount += 1;

  const videoIds = await searchVideos(query, {
    apiKey,
    maxResults: SEARCH_MAX_RESULTS,
    publishedAfter: cutoffIso,
    onRequest() {
      state.quotaUnits += 1;
    }
  });

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
        country,
        countryTerms,
        keywordTerms,
        windowHours: options.windowHours,
        format: options.format,
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

  const saved = await upsertCountryEventVideoSignal(pool, {
    countryNewsSignalId: newsSignal.id,
    countryId: country.id,
    signalId: existingSignalId,
    video: best.video,
    durationSeconds: best.durationSeconds,
    matchedCountryTerm: best.matchedCountryTerm,
    matchedEventTerm: best.matchedEventTerm,
    viewsPerHour: best.viewsPerHour,
    searchQuery: query,
    evidence: {
      matched_country_term: best.matchedCountryTerm,
      matched_event_term: best.matchedEventTerm,
      category: newsSignal.category,
      short_format: best.shortInfo.shortFormat,
      age_hours: best.ageHours
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

async function executeCountryEventVideoRun(
  pool,
  run,
  { apiKey, now = new Date(), onEntityCompleted = null } = {}
) {
  const options = normalizeCountryEventVideoRunPayload(
    run.request_payload
  );

  const state = createRunState(options);

  const representativeNewsSignals =
    await fetchRepresentativeCountryNewsSignals(pool, {
      windowHours: options.windowHours,
      maxEntities: options.maxEntities
    });

  const countryById = await fetchCountriesById(
    pool,
    representativeNewsSignals.map(row =>
      String(row.country_id)
    )
  );

  state.entitiesAttempted = representativeNewsSignals.length;

  await updateRunProgress(pool, run.id, state);

  for (const newsSignal of representativeNewsSignals) {
    const country = countryById.get(
      String(newsSignal.country_id)
    );

    if (!country) {
      continue;
    }

    try {
      await processCountryEntity(
        pool,
        { country, newsSignal },
        state,
        { apiKey, now }
      );

      state.completedEntityCount += 1;

      if (onEntityCompleted) {
        onEntityCompleted(country, state);
      }
    } catch (error) {
      state.failedEntityCount += 1;

      state.errors.push({
        country_code: country.code,
        code: error?.code || null,
        message: String(
          error?.message ||
          "Unknown country event video failure"
        ).slice(0, 500)
      });
    }

    await updateRunProgress(pool, run.id, state);
  }

  return finalizeRun(pool, run.id, state);
}

async function processNextCountryEventVideoRun(
  pool,
  {
    workerId,
    apiKey,
    now = new Date(),
    onRunStarted = null,
    onEntityCompleted = null
  } = {}
) {
  const run = await claimNextCountryEventVideoRun(
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
    return await executeCountryEventVideoRun(pool, run, {
      apiKey,
      now,
      onEntityCompleted
    });
  } catch (error) {
    await failCountryEventVideoRun(pool, run.id, error);
    throw error;
  }
}

module.exports = {
  RESOLVER_VERSION,
  buildEventSearchQuery,
  claimNextCountryEventVideoRun,
  eventKeywordTerms,
  evaluateCandidate,
  executeCountryEventVideoRun,
  fetchRepresentativeCountryNewsSignals,
  normalizeCountryEventVideoRunPayload,
  processNextCountryEventVideoRun,
  rankCandidates
};

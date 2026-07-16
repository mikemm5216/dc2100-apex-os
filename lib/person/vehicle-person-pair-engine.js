const {
  normalizePersonText,
  aliasMatchesNormalizedText
} = require("./normalization");
const { sanitizeQueryTerm } = require("./query-builder");
const { searchVideos, fetchVideos } = require("../scanner/youtube");
const {
  SearchBudgetExhaustedError,
  acquireSearchCredit,
  recordCacheHit,
  readSearchCache,
  writeSearchCache
} = require("../scanner/search-governor");
const {
  parseIso8601Duration,
  classifyShortFormat
} = require("../scanner/metrics");

const SPECIFICITY = { SAME_BRAND: 1, SAME_SERIES: 2, EXACT_MODEL: 3 };
const FOUNDER_ROLE = "FOUNDER_EXECUTIVE";
const FALLBACK_BRANDS = new Set(["tesla", "xiaomi"]);

class PairQuotaBlockedError extends Error {
  constructor(message = "YouTube search quota budget was exhausted.", progress = {}) {
    super(message);
    this.name = "PairQuotaBlockedError";
    this.code = "YOUTUBE_SEARCH_QUOTA_BLOCKED";
    this.progress = progress;
  }
}

function normalizeSearchQuery(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isYoutubeQuotaError(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
  return text.includes("quotaexceeded") ||
    text.includes("quota exceeded") ||
    text.includes("search queries per day");
}

function isFounderEligible(person) {
  if (person.life_status === "DECEASED" || person.role_category === "HISTORICAL_FIGURE") {
    return false;
  }
  return person.role_category !== FOUNDER_ROLE || person.life_status === "ALIVE";
}

function isFounderFallbackEligible({ anchor, person, directSupport, provenPairs = [] }) {
  return provenPairs.length === 0 &&
    FALLBACK_BRANDS.has(normalizePersonText(anchor.vehicle_brand)) &&
    person.role_category === FOUNDER_ROLE &&
    person.life_status === "ALIVE" &&
    Boolean(person.link_id) && Boolean(anchor.signal_id) && Boolean(directSupport);
}

function isCrossCountryPair(vehicleCountryId, personCountryId) {
  return String(vehicleCountryId) !== String(personCountryId);
}

function normalizeVehicleBrand(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function clamp(value, fallback, max = 50) {
  const number = Number(value);
  return Number.isInteger(number)
    ? Math.max(1, Math.min(max, number))
    : fallback;
}

function clampRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max
    ? number
    : fallback;
}

function normalizePairRunPayload(payload = {}) {
  const targetPairs = clamp(
    payload.target_pairs ?? payload.max_vehicles,
    10,
    50
  );
  const requestedMaxAnchors = Number(payload.max_brand_anchors);
  const maxBrandAnchors = Number.isInteger(requestedMaxAnchors)
    ? Math.max(targetPairs, Math.min(100, requestedMaxAnchors))
    : Math.max(targetPairs, 50);
  return {
    historyScope: "ALL_TIME",
    format:
      String(payload.format || "SHORTS").toUpperCase() === "ALL"
        ? "ALL"
        : "SHORTS",
    targetPairs,
    maxBrandAnchors,
    brandBatchSize: clampRange(payload.brand_batch_size, 25, 5, 25),
    maxPeoplePerVehicle: clamp(payload.max_people_per_vehicle, 10, 10),
    maxSearchQueries: clampRange(payload.max_search_queries, 90, 10, 95),
    resumeRunId: payload.resume_run_id
      ? String(payload.resume_run_id)
      : null,
    stationRunKey: payload.station_run_key ? String(payload.station_run_key) : null
  };
}

async function claimNextVehiclePersonPairRun(pool, workerId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`
      SELECT id, request_payload
      FROM vehicle_person_pair_runs
      WHERE status = 'QUEUED'
      ORDER BY created_at, id
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `);
    if (!result.rowCount) {
      await client.query("COMMIT");
      return null;
    }
    const run = result.rows[0];
    await client.query(`
      UPDATE vehicle_person_pair_runs
      SET status='RUNNING', locked_by=$1, locked_at=NOW(),
          started_at=NOW(), updated_at=NOW()
      WHERE id=$2
    `, [workerId, run.id]);
    await client.query("COMMIT");
    return run;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
}

async function fetchVehicleAnchors(pool, maxBrandAnchors, format) {
  const result = await pool.query(`
    WITH vehicle_video_ranked AS (
      SELECT sig.*,
        ROW_NUMBER() OVER (
          PARTITION BY sig.resolved_vehicle_id
          ORDER BY sig.views DESC, sig.published_at DESC, sig.id ASC
        ) AS rn
      FROM signals sig
      WHERE sig.entity_resolution_status='RESOLVED'
        AND sig.resolved_vehicle_id IS NOT NULL
        AND sig.views > 0
        AND ($2::text='ALL' OR sig.is_short=TRUE)
    ), vehicle_anchors AS (
      SELECT r.resolved_vehicle_id AS vehicle_id, r.id AS signal_id,
        r.external_id AS video_id, r.title, r.url, r.views, r.published_at,
        v.code AS vehicle_code, v.name AS vehicle_name,
        COALESCE(
          NULLIF(TRIM(v.manufacturer), ''),
          NULLIF(TRIM(r.vehicle_brand), ''),
          NULLIF(TRIM(link_brand.vehicle_brand), '')
        ) AS vehicle_brand,
        v.country_id AS vehicle_country_id
      FROM vehicle_video_ranked r
      JOIN vehicles v ON v.id=r.resolved_vehicle_id
      LEFT JOIN LATERAL (
        SELECT vpl.vehicle_brand
        FROM vehicle_person_links vpl
        WHERE vpl.vehicle_id=v.id
          AND NULLIF(TRIM(vpl.vehicle_brand), '') IS NOT NULL
        ORDER BY vpl.id ASC
        LIMIT 1
      ) link_brand ON TRUE
      WHERE r.rn=1
    ), branded AS (
      SELECT va.*,
        LOWER(REGEXP_REPLACE(TRIM(va.vehicle_brand), '[[:space:]]+', ' ', 'g'))
          AS normalized_vehicle_brand,
        COUNT(*) OVER () AS vehicle_anchor_count
      FROM vehicle_anchors va
      WHERE NULLIF(TRIM(va.vehicle_brand), '') IS NOT NULL
    ), brand_ranked AS (
      SELECT b.*,
        ROW_NUMBER() OVER (
          PARTITION BY b.normalized_vehicle_brand
          ORDER BY b.views DESC, b.published_at DESC,
            b.signal_id ASC, b.vehicle_id ASC
        ) AS brand_rn
      FROM branded b
    ), distinct_brands AS (
      SELECT br.*, COUNT(*) OVER () AS brands_available
      FROM brand_ranked br
      WHERE br.brand_rn=1
    )
    SELECT *
    FROM distinct_brands
    ORDER BY views DESC, published_at DESC, signal_id ASC, vehicle_id ASC
    LIMIT $1
  `, [maxBrandAnchors, format]);
  const anchors = result.rows.map(row => ({
    ...row,
    normalized_vehicle_brand:
      row.normalized_vehicle_brand || normalizeVehicleBrand(row.vehicle_brand)
  }));
  anchors.brandsAvailable = Number(result.rows[0]?.brands_available || 0);
  anchors.vehicleAnchorCount = Number(result.rows[0]?.vehicle_anchor_count || 0);
  return anchors;
}

function dedupeAnchorsByBrand(anchors) {
  const best = new Map();
  for (const anchor of anchors) {
    const brand = normalizeVehicleBrand(
      anchor.vehicle_brand || anchor.signal_vehicle_brand || anchor.link_vehicle_brand
    );
    if (!brand) continue;
    const candidate = { ...anchor, normalized_vehicle_brand: brand };
    const existing = best.get(brand);
    const better = !existing ||
      Number(candidate.views) > Number(existing.views) ||
      (Number(candidate.views) === Number(existing.views) &&
        (new Date(candidate.published_at) > new Date(existing.published_at) ||
          (new Date(candidate.published_at).getTime() === new Date(existing.published_at).getTime() &&
            (Number(candidate.signal_id) < Number(existing.signal_id) ||
              (Number(candidate.signal_id) === Number(existing.signal_id) &&
                Number(candidate.vehicle_id) < Number(existing.vehicle_id))))));
    if (better) best.set(brand, candidate);
  }
  return [...best.values()].sort((a, b) =>
    Number(b.views) - Number(a.views) ||
    new Date(b.published_at) - new Date(a.published_at) ||
    Number(a.signal_id) - Number(b.signal_id) ||
    Number(a.vehicle_id) - Number(b.vehicle_id)
  );
}

function pairSpecificity(link, vehicle) {
  const normalize = value => normalizePersonText(value || "");
  if (link.vehicle_id && String(link.vehicle_id) === String(vehicle.vehicle_id)) {
    return "EXACT_MODEL";
  }
  if (link.vehicle_model && normalize(vehicle.vehicle_name).includes(normalize(link.vehicle_model))) {
    return "EXACT_MODEL";
  }
  if (link.vehicle_series && normalize(vehicle.vehicle_name).includes(normalize(link.vehicle_series))) {
    return "SAME_SERIES";
  }
  return "SAME_BRAND";
}

async function fetchCandidatePeople(pool, vehicle, limit) {
  const result = await pool.query(`
    SELECT vpl.id AS link_id, vpl.vehicle_id, vpl.vehicle_brand,
      vpl.vehicle_series, vpl.vehicle_model, vpl.relation_type,
      vpl.link_confidence,
      p.id AS person_id, p.slug, p.canonical_name, p.aliases,
      p.country_id AS person_country_id, p.role_category,
      p.life_status, p.life_status_source,
      COALESCE((p.metadata->>'f1_driver')::boolean, FALSE) AS f1_driver
    FROM vehicle_person_links vpl
    JOIN people p ON p.id=vpl.person_id
    WHERE p.active=TRUE
      AND p.country_id IS NOT NULL
      AND (vpl.vehicle_id=$1 OR vpl.vehicle_brand ILIKE $2)
      AND p.role_category <> 'HISTORICAL_FIGURE'
      AND p.life_status <> 'DECEASED'
      AND (p.role_category <> 'FOUNDER_EXECUTIVE' OR p.life_status='ALIVE')
    ORDER BY p.id ASC, vpl.id ASC
  `, [vehicle.vehicle_id, vehicle.vehicle_brand]);

  const bestByPerson = new Map();
  for (const row of result.rows) {
    row.pair_specificity = pairSpecificity(row, vehicle);
    const existing = bestByPerson.get(String(row.person_id));
    if (!existing ||
      SPECIFICITY[row.pair_specificity] > SPECIFICITY[existing.pair_specificity] ||
      (SPECIFICITY[row.pair_specificity] === SPECIFICITY[existing.pair_specificity] &&
        Number(row.link_confidence || 0) > Number(existing.link_confidence || 0))) {
      bestByPerson.set(String(row.person_id), row);
    }
  }
  const candidates = [...bestByPerson.values()].sort((a, b) =>
    SPECIFICITY[b.pair_specificity] - SPECIFICITY[a.pair_specificity] ||
    Number(b.link_confidence || 0) - Number(a.link_confidence || 0) ||
    Number(a.person_id) - Number(b.person_id)
  );
  const selected = candidates.slice(0, limit);

  // The only curated exception is the explicit Tesla/Xiaomi fallback.
  // Preserve its ALIVE founder candidate without introducing broad role quotas.
  if (FALLBACK_BRANDS.has(normalizePersonText(vehicle.vehicle_brand))) {
    const founder = candidates.find(row => row.role_category === FOUNDER_ROLE);
    if (founder && !selected.some(row => String(row.person_id) === String(founder.person_id))) {
      selected[Math.max(0, selected.length - 1)] = founder;
    }
  }
  return selected;
}

function matchTerm(video, terms) {
  const fields = [
    ["TITLE", video.title],
    ["TAGS", (video.tags || []).join(" ")],
    ["DESCRIPTION", video.description]
  ];
  for (const [field, text] of fields) {
    const normalized = normalizePersonText(text || "");
    const term = terms.find(candidate =>
      candidate && aliasMatchesNormalizedText(normalized, candidate)
    );
    if (term) return { term, field };
  }
  return null;
}

function evaluateJointVideo(video, { personTerms, vehicleTerms, format }) {
  const person = matchTerm(video, personTerms);
  const vehicle = matchTerm(video, vehicleTerms.map(item => item.term));
  if (!person || !vehicle) return null;

  const durationSeconds = parseIso8601Duration(video.duration);
  const shortInfo = classifyShortFormat(durationSeconds);
  if (format === "SHORTS" && !shortInfo.isShort) return null;

  const vehicleRule = vehicleTerms.find(item =>
    normalizePersonText(item.term) === normalizePersonText(vehicle.term)
  );
  return {
    video,
    durationSeconds,
    shortFormat: shortInfo.shortFormat,
    matchedPersonAlias: person.term,
    personMatchField: person.field,
    matchedVehicleTerm: vehicle.term,
    vehicleMatchField: vehicle.field,
    pairSpecificity: vehicleRule?.specificity || "SAME_BRAND",
    views: Number(video.views) || 0
  };
}

function rankPairs(a, b) {
  return b.views - a.views ||
    SPECIFICITY[b.pairSpecificity] - SPECIFICITY[a.pairSpecificity] ||
    Number(b.anchor.views) - Number(a.anchor.views) ||
    new Date(b.video.publishedAt) - new Date(a.video.publishedAt) ||
    Number(a.anchor.vehicle_id) - Number(b.anchor.vehicle_id) ||
    Number(a.link.person_id) - Number(b.link.person_id);
}

function selectBestPair(pairs) {
  return [...pairs].sort(rankPairs)[0] || null;
}

function pairStatusRank(pair) {
  return pair.pairStatus === "PROVEN_PAIR" ? 2 : 1;
}

function compareUsablePairs(a, b, { global = false } = {}) {
  const publishedA = a.video?.publishedAt
    ? new Date(a.video.publishedAt).getTime()
    : 0;
  const publishedB = b.video?.publishedAt
    ? new Date(b.video.publishedAt).getTime()
    : 0;
  const common = pairStatusRank(b) - pairStatusRank(a) ||
    Number(b.views ?? -1) - Number(a.views ?? -1) ||
    SPECIFICITY[b.pairSpecificity] - SPECIFICITY[a.pairSpecificity] ||
    Number(b.anchor.views) - Number(a.anchor.views) ||
    publishedB - publishedA;
  if (common !== 0) return common;
  if (global) {
    const brandOrder = a.anchor.normalized_vehicle_brand.localeCompare(
      b.anchor.normalized_vehicle_brand
    );
    if (brandOrder !== 0) return brandOrder;
    const vehicleOrder = Number(a.anchor.vehicle_id) - Number(b.anchor.vehicle_id);
    if (vehicleOrder !== 0) return vehicleOrder;
  }
  return Number(a.link.person_id) - Number(b.link.person_id);
}

function selectBestPairPerBrand(pairs) {
  const best = new Map();
  for (const pair of pairs) {
    const brand = pair.anchor.normalized_vehicle_brand;
    const existing = best.get(brand);
    if (!existing || compareUsablePairs(pair, existing) < 0) {
      best.set(brand, pair);
    }
  }
  return [...best.values()];
}

function selectDistinctPairOutcome(pairs, targetPairs) {
  const selected = [];
  const usedBrands = new Set();
  const usedVehicles = new Set();
  const usedPeople = new Set();
  let personConflictsResolved = 0;

  for (const pair of [...pairs].sort((a, b) =>
    compareUsablePairs(a, b, { global: true })
  )) {
    const brand = normalizeVehicleBrand(
      pair.anchor.normalized_vehicle_brand || pair.anchor.vehicle_brand
    );
    const vehicleId = String(pair.anchor.vehicle_id);
    const personId = String(pair.link.person_id);
    const brandConflict = usedBrands.has(brand);
    const vehicleConflict = usedVehicles.has(vehicleId);
    const personConflict = usedPeople.has(personId);

    if (personConflict && !brandConflict && !vehicleConflict) {
      personConflictsResolved += 1;
    }
    if (brandConflict || vehicleConflict || personConflict) continue;

    selected.push(pair);
    usedBrands.add(brand);
    usedVehicles.add(vehicleId);
    usedPeople.add(personId);
    if (selected.length >= targetPairs) break;
  }

  return { selected, personConflictsResolved };
}

function selectTopDistinctBrandAndPersonPairs(pairs, targetPairs) {
  return selectDistinctPairOutcome(pairs, targetPairs).selected;
}

function buildPairSearchQueries(link, anchor) {
  const aliases = [link.canonical_name, ...(Array.isArray(link.aliases) ? link.aliases : [])]
    .filter(Boolean)
    .filter((value, index, all) => all.findIndex(item =>
      normalizePersonText(item) === normalizePersonText(value)
    ) === index);
  const strongestAlias = aliases.find(alias =>
    normalizePersonText(alias) !== normalizePersonText(link.canonical_name)
  ) || aliases[0];
  const alternateAlias = aliases.find(alias =>
    normalizePersonText(alias) !== normalizePersonText(strongestAlias)
  ) || aliases[0];
  const strongestVehicle = link.vehicle_model || link.vehicle_series ||
    link.vehicle_brand || anchor.vehicle_brand || anchor.vehicle_name;
  const makeQuery = parts => parts.map(sanitizeQueryTerm).filter(Boolean).join(" ");
  const primary = [
    makeQuery([strongestAlias, strongestVehicle]),
    makeQuery([alternateAlias, link.vehicle_brand || anchor.vehicle_brand])
  ];
  const conditional = makeQuery([
    link.canonical_name || aliases[0],
    link.vehicle_series || link.vehicle_brand || anchor.vehicle_brand
  ]);
  const seen = new Set();
  const dedupe = values => values.filter(query => {
    const key = normalizeSearchQuery(query);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { primary: dedupe(primary), conditional: dedupe([conditional])[0] || null };
}

async function executePairSearchQuery(pool, query, format, apiKey, state, deps = {}) {
  state.searchQueriesPlanned += 1;
  const cached = await readSearchCache(pool, query, format);
  if (cached !== null) {
    state.searchQueriesCacheHit += 1;
    await recordCacheHit(pool);
    return cached;
  }
  if (state.searchQueriesApiCalled >= state.maxSearchQueries) {
    state.quotaBudgetExhausted = true;
    throw new PairQuotaBlockedError();
  }
  state.searchQueriesApiCalled += 1;
  state.searchQueries = state.searchQueriesApiCalled;
  try {
    await acquireSearchCredit(pool, "PAIR", {
      stationRunKey: state.stationRunKey,
      stationCategory: state.stationRunKey ? "pair" : null
    });
    const found = await (deps.searchVideos || searchVideos)(query, {
      apiKey,
      maxResults: 10,
      onRequest() { state.quotaUnits += 1; }
    });
    await writeSearchCache(pool, query, format, found);
    return found;
  } catch (error) {
    if (error instanceof SearchBudgetExhaustedError ||
      error?.code === "SEARCH_BUDGET_EXHAUSTED") {
      state.searchQueriesApiCalled -= 1;
      state.searchQueries = state.searchQueriesApiCalled;
      state.quotaBudgetExhausted = true;
      throw new PairQuotaBlockedError(error.message);
    }
    if (isYoutubeQuotaError(error)) {
      state.quotaBudgetExhausted = true;
      state.quotaErrors += 1;
      throw new PairQuotaBlockedError(error.message);
    }
    throw error;
  }
}

async function searchPair(pool, link, anchor, format, apiKey, state, deps = {}) {
  const aliases = [link.canonical_name, ...(Array.isArray(link.aliases) ? link.aliases : [])]
    .filter(Boolean);
  const vehicleTerms = [
    { term: link.vehicle_model, specificity: "EXACT_MODEL" },
    { term: link.vehicle_series, specificity: "SAME_SERIES" },
    { term: link.vehicle_brand || anchor.vehicle_brand, specificity: "SAME_BRAND" }
  ].filter(item => item.term);
  const planned = buildPairSearchQueries(link, anchor);
  const queryByVideoId = new Map();
  const inspectQueries = async (queries, startingStage = 0) => {
    const videoIds = [];
    for (let index = 0; index < queries.length; index += 1) {
      const query = queries[index];
      let found;
      try {
        found = await executePairSearchQuery(
          pool, query, format, apiKey, state, deps
        );
      } catch (error) {
        if (error instanceof PairQuotaBlockedError) {
          error.progress = {
            ...error.progress,
            next_query_stage: startingStage + index,
            normalized_query: normalizeSearchQuery(query)
          };
        }
        throw error;
      }
      videoIds.push(...found);
      for (const videoId of found) {
        if (!queryByVideoId.has(videoId)) queryByVideoId.set(videoId, query);
      }
    }
    const uniqueIds = [...new Set(videoIds)];
    state.videosDiscovered += uniqueIds.length;
    if (!uniqueIds.length) return [];
    const videos = await (deps.fetchVideos || fetchVideos)(uniqueIds, {
      apiKey,
      onRequest() {
        state.quotaUnits += 1;
        state.videosListCalls += 1;
      }
    });
    state.videosEvaluated += videos.length;
    return videos.map(video => {
      const match = evaluateJointVideo(video, { personTerms: aliases, vehicleTerms, format });
      return match ? { ...match, searchQuery: queryByVideoId.get(video.videoId) } : null;
    }).filter(Boolean);
  };

  let matches = await inspectQueries(planned.primary, 0);
  if (!matches.length && planned.conditional &&
    (!state.needMorePairs || state.needMorePairs()) &&
    state.searchQueriesApiCalled < state.maxSearchQueries) {
    matches = await inspectQueries([planned.conditional], 2);
  }
  return matches.sort((a, b) => b.views - a.views ||
    SPECIFICITY[b.pairSpecificity] - SPECIFICITY[a.pairSpecificity] ||
    new Date(b.video.publishedAt) - new Date(a.video.publishedAt))[0] || null;
}

async function fetchFounderDirectSupport(pool, link, format) {
  if (link.role_category !== FOUNDER_ROLE || link.life_status !== "ALIVE") return null;
  const result = await pool.query(`
    SELECT id, external_video_id, video_title, video_url, video_views,
      duration_seconds, matched_alias, direct_mention_field
    FROM person_direct_video_signals
    WHERE person_id=$1
      AND ($2::text='ALL' OR duration_seconds <= 180)
    ORDER BY video_views DESC, published_at DESC NULLS LAST, id ASC
    LIMIT 1
  `, [link.person_id, format]);
  return result.rows[0] || null;
}

async function persistProvenPair(pool, runId, anchor, link, match, selected) {
  const crossCountry = isCrossCountryPair(anchor.vehicle_country_id, link.person_country_id);
  const result = await pool.query(`
    INSERT INTO vehicle_person_pair_signals(
      run_id,vehicle_id,person_id,vehicle_person_link_id,person_country_id,
      person_role_category,person_life_status,pair_status,pair_specificity,
      cross_country_pair,founder_fallback,vehicle_anchor_signal_id,
      vehicle_anchor_video_id,vehicle_anchor_title,vehicle_anchor_url,
      vehicle_anchor_views,joint_video_id,joint_video_title,joint_video_url,
      joint_video_views,joint_video_published_at,joint_video_duration_seconds,
      joint_video_format,search_query,matched_person_alias,person_match_field,
      matched_vehicle_term,vehicle_match_field,evidence,selected
    ) VALUES(
      $1,$2,$3,$4,$5,$6,$7,'PROVEN_PAIR',$8,$9,FALSE,$10,$11,$12,$13,$14,
      $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,$28
    ) RETURNING id
  `, [
    runId, anchor.vehicle_id, link.person_id, link.link_id,
    link.person_country_id, link.role_category, link.life_status,
    match.pairSpecificity, crossCountry, anchor.signal_id, anchor.video_id,
    anchor.title, anchor.url, anchor.views, match.video.videoId,
    match.video.title, `https://www.youtube.com/watch?v=${match.video.videoId}`,
    match.views, match.video.publishedAt, match.durationSeconds,
    match.shortFormat, match.searchQuery, match.matchedPersonAlias,
    match.personMatchField, match.matchedVehicleTerm, match.vehicleMatchField,
    JSON.stringify({
      vehicle_brand: anchor.vehicle_brand,
      normalized_vehicle_brand: anchor.normalized_vehicle_brand,
      person_match_field: match.personMatchField,
      vehicle_match_field: match.vehicleMatchField,
      channel_title_used: false,
      f1_driver: link.f1_driver === true
    }),
    selected
  ]);
  return result.rows[0];
}

async function persistFounderFallback(pool, runId, anchor, link, support, selected) {
  const crossCountry = isCrossCountryPair(anchor.vehicle_country_id, link.person_country_id);
  const result = await pool.query(`
    INSERT INTO vehicle_person_pair_signals(
      run_id,vehicle_id,person_id,vehicle_person_link_id,person_country_id,
      person_role_category,person_life_status,pair_status,pair_specificity,
      cross_country_pair,founder_fallback,founder_fallback_reason,
      vehicle_anchor_signal_id,vehicle_anchor_video_id,vehicle_anchor_title,
      vehicle_anchor_url,vehicle_anchor_views,person_direct_video_signal_id,
      person_direct_video_id,person_direct_video_title,person_direct_video_url,
      person_direct_video_views,evidence,selected
    ) VALUES(
      $1,$2,$3,$4,$5,$6,$7,'CURATED_FOUNDER_FALLBACK',$8,$9,TRUE,
      'ALIVE founder + catalog link + vehicle anchor + direct person hook; Tesla/Xiaomi only',
      $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21
    ) RETURNING id
  `, [
    runId, anchor.vehicle_id, link.person_id, link.link_id,
    link.person_country_id, link.role_category, link.life_status,
    link.pair_specificity, crossCountry, anchor.signal_id, anchor.video_id,
    anchor.title, anchor.url, anchor.views, support.id,
    support.external_video_id, support.video_title, support.video_url,
    support.video_views, JSON.stringify({
      fallback_brand: anchor.vehicle_brand,
      vehicle_brand: anchor.vehicle_brand,
      normalized_vehicle_brand: anchor.normalized_vehicle_brand,
      person_direct_mention_field: support.direct_mention_field,
      channel_title_used: false,
      f1_driver: link.f1_driver === true
    }),
    selected
  ]);
  return result.rows[0];
}

async function persistUsablePair(pool, runId, pair, selected) {
  if (pair.pairStatus === "PROVEN_PAIR") {
    return persistProvenPair(
      pool,
      runId,
      pair.anchor,
      pair.link,
      pair,
      selected
    );
  }
  return persistFounderFallback(
    pool,
    runId,
    pair.anchor,
    pair.link,
    pair.directSupport,
    selected
  );
}

async function loadResumeContext(pool, resumeRunId) {
  if (!resumeRunId) return { usablePairs: [], completedBrands: new Set(), sourceSummary: null };
  const source = await pool.query(`
    SELECT summary FROM vehicle_person_pair_runs WHERE id=$1
  `, [resumeRunId]);
  const sourceSummary = source.rows[0]?.summary || {};
  const completedBrands = new Set((sourceSummary.brand_results || [])
    .filter(item => !item.error)
    .map(item => normalizeVehicleBrand(item.normalized_vehicle_brand || item.vehicle_brand))
    .filter(Boolean));
  const result = await pool.query(`
    SELECT s.*, p.slug,p.canonical_name,p.aliases,p.country_id AS person_country_id,
      p.role_category,p.life_status,
      COALESCE((p.metadata->>'f1_driver')::boolean,FALSE) AS f1_driver,
      vpl.vehicle_brand,vpl.vehicle_series,vpl.vehicle_model,vpl.link_confidence,
      v.code AS vehicle_code,v.name AS vehicle_name,v.country_id AS vehicle_country_id
    FROM vehicle_person_pair_signals s
    JOIN people p ON p.id=s.person_id
    JOIN vehicle_person_links vpl ON vpl.id=s.vehicle_person_link_id
    JOIN vehicles v ON v.id=s.vehicle_id
    WHERE s.run_id=$1
  `, [resumeRunId]);
  const usablePairs = result.rows.map(row => {
    const evidence = row.evidence || {};
    const anchor = {
      vehicle_id: row.vehicle_id,
      vehicle_code: row.vehicle_code,
      vehicle_name: row.vehicle_name,
      vehicle_brand: evidence.vehicle_brand || row.vehicle_brand,
      normalized_vehicle_brand: evidence.normalized_vehicle_brand ||
        normalizeVehicleBrand(row.vehicle_brand),
      vehicle_country_id: row.vehicle_country_id,
      signal_id: row.vehicle_anchor_signal_id,
      video_id: row.vehicle_anchor_video_id,
      title: row.vehicle_anchor_title,
      url: row.vehicle_anchor_url,
      views: row.vehicle_anchor_views,
      published_at: row.created_at
    };
    const link = {
      link_id: row.vehicle_person_link_id,
      vehicle_id: row.vehicle_id,
      vehicle_brand: row.vehicle_brand,
      vehicle_series: row.vehicle_series,
      vehicle_model: row.vehicle_model,
      link_confidence: row.link_confidence,
      person_id: row.person_id,
      slug: row.slug,
      canonical_name: row.canonical_name,
      aliases: row.aliases,
      person_country_id: row.person_country_id,
      role_category: row.role_category,
      life_status: row.life_status,
      f1_driver: row.f1_driver,
      pair_specificity: row.pair_specificity
    };
    if (row.pair_status === "PROVEN_PAIR") {
      return {
        pairStatus: row.pair_status,
        pairSpecificity: row.pair_specificity,
        views: Number(row.joint_video_views || 0),
        video: {
          videoId: row.joint_video_id,
          title: row.joint_video_title,
          publishedAt: row.joint_video_published_at
        },
        durationSeconds: row.joint_video_duration_seconds,
        shortFormat: row.joint_video_format,
        searchQuery: row.search_query,
        matchedPersonAlias: row.matched_person_alias,
        personMatchField: row.person_match_field,
        matchedVehicleTerm: row.matched_vehicle_term,
        vehicleMatchField: row.vehicle_match_field,
        anchor,
        link
      };
    }
    return {
      pairStatus: row.pair_status,
      pairSpecificity: row.pair_specificity,
      views: null,
      video: null,
      anchor,
      link,
      directSupport: {
        id: row.person_direct_video_signal_id,
        external_video_id: row.person_direct_video_id,
        video_title: row.person_direct_video_title,
        video_url: row.person_direct_video_url,
        video_views: row.person_direct_video_views
      }
    };
  });
  return { usablePairs, completedBrands, sourceSummary };
}

async function scanBrandAnchorBatches({
  anchors,
  batchSize,
  targetPairs,
  scanAnchor,
  initialPairs = [],
  completedBrands = new Set()
}) {
  const usablePairs = [...initialPairs];
  let brandsScanned = 0;
  let batchesCompleted = 0;
  let quotaBlocked = false;
  let pendingAnchor = null;
  for (let offset = 0; offset < anchors.length; offset += batchSize) {
    const batch = anchors.slice(offset, offset + batchSize);
    for (const anchor of batch) {
      if (completedBrands.has(anchor.normalized_vehicle_brand)) continue;
      brandsScanned += 1;
      let candidates;
      try {
        candidates = await scanAnchor(anchor);
      } catch (error) {
        if (!(error instanceof PairQuotaBlockedError)) throw error;
        if (Array.isArray(error.partialPairs)) {
          usablePairs.push(...error.partialPairs);
        }
        quotaBlocked = true;
        pendingAnchor = {
          normalized_vehicle_brand: anchor.normalized_vehicle_brand,
          vehicle_id: String(anchor.vehicle_id),
          ...error.progress
        };
        break;
      }
      if (Array.isArray(candidates)) {
        usablePairs.push(...candidates);
      } else if (candidates) {
        usablePairs.push(candidates);
      }
    }
    if (quotaBlocked) break;
    batchesCompleted += 1;
    if (
      selectTopDistinctBrandAndPersonPairs(usablePairs, targetPairs).length >=
      targetPairs
    ) break;
  }
  return { usablePairs, brandsScanned, batchesCompleted, quotaBlocked, pendingAnchor };
}

async function executeVehiclePersonPairRun(pool, run, { apiKey } = {}) {
  const options = normalizePairRunPayload(run.request_payload);
  const state = {
    entitiesAttempted: 0,
    candidatePeopleAttempted: 0,
    searchQueries: 0,
    searchQueriesPlanned: 0,
    searchQueriesCacheHit: 0,
    searchQueriesApiCalled: 0,
    maxSearchQueries: options.maxSearchQueries,
    stationRunKey: options.stationRunKey,
    videosListCalls: 0,
    quotaBudgetExhausted: false,
    quotaErrors: 0,
    videosDiscovered: 0,
    videosEvaluated: 0,
    provenPairsFound: 0,
    founderFallbackPairsFound: 0,
    f1CandidatesAttempted: 0,
    f1ProvenPairsFound: 0,
    noMatchPairs: 0,
    quotaUnits: 0,
    errors: [],
    brandResults: [],
    distinctCandidatePersonIds: new Set()
  };
  const resumeContext = await loadResumeContext(pool, options.resumeRunId);
  state.brandResults.push(...(resumeContext.sourceSummary?.brand_results || []));
  const provisionalPairs = [...resumeContext.usablePairs];
  state.needMorePairs = () =>
    selectTopDistinctBrandAndPersonPairs(provisionalPairs, options.targetPairs).length <
    options.targetPairs;
  const anchors = await fetchVehicleAnchors(
    pool,
    options.maxBrandAnchors,
    options.format
  );
  const scanOutcome = await scanBrandAnchorBatches({
    anchors,
    batchSize: options.brandBatchSize,
    targetPairs: options.targetPairs,
    initialPairs: resumeContext.usablePairs,
    completedBrands: resumeContext.completedBrands,
    scanAnchor: async anchor => {
      try {
        const people = await fetchCandidatePeople(
          pool,
          anchor,
          options.maxPeoplePerVehicle
        );
        state.candidatePeopleAttempted += people.length;
        for (const person of people) {
          state.distinctCandidatePersonIds.add(String(person.person_id));
          if (person.f1_driver === true) state.f1CandidatesAttempted += 1;
        }
        const proven = [];
        for (let personIndex = 0; personIndex < people.length; personIndex += 1) {
          const link = people[personIndex];
          let match;
          try {
            match = await searchPair(
              pool, link, anchor, options.format, apiKey, state
            );
          } catch (error) {
            if (error instanceof PairQuotaBlockedError) {
              error.progress = {
                ...error.progress,
                person_id: String(link.person_id),
                person_index: personIndex,
                search_queries_api_called: state.searchQueriesApiCalled
              };
              error.partialPairs = [...proven];
            }
            throw error;
          }
          if (match) {
            proven.push({
              ...match,
              pairStatus: "PROVEN_PAIR",
              link,
              anchor
            });
            state.provenPairsFound += 1;
            if (link.f1_driver === true) state.f1ProvenPairsFound += 1;
          } else {
            state.noMatchPairs += 1;
          }
        }

        const usable = [...proven];
        if (!proven.length && FALLBACK_BRANDS.has(anchor.normalized_vehicle_brand)) {
          const livingFounders = people.filter(person =>
            person.role_category === FOUNDER_ROLE && person.life_status === "ALIVE"
          );
          for (const founder of livingFounders) {
            const support = await fetchFounderDirectSupport(pool, founder, options.format);
            if (!isFounderFallbackEligible({
              anchor,
              person: founder,
              directSupport: support,
              provenPairs: proven
            })) continue;
            usable.push({
              pairStatus: "CURATED_FOUNDER_FALLBACK",
              pairSpecificity: founder.pair_specificity,
              views: null,
              video: null,
              link: founder,
              anchor,
              directSupport: support
            });
            state.founderFallbackPairsFound += 1;
          }
        }

        const bestForBrand = selectBestPairPerBrand(usable)[0] || null;
        state.brandResults.push({
          vehicle_brand: anchor.vehicle_brand,
          normalized_vehicle_brand: anchor.normalized_vehicle_brand,
          vehicle_code: anchor.vehicle_code,
          vehicle_id: String(anchor.vehicle_id),
          status: bestForBrand?.pairStatus || "NO_MATCH",
          no_match_reason: bestForBrand
            ? null
            : (people.length ? "NO_JOINT_VIDEO_MATCH" : "NO_ELIGIBLE_CATALOG_PERSON")
        });
        provisionalPairs.push(...usable);
        return usable;
      } catch (error) {
        if (error instanceof PairQuotaBlockedError) throw error;
        state.errors.push({
          vehicle_brand: anchor.vehicle_brand,
          vehicle_code: anchor.vehicle_code,
          message: String(error.message).slice(0, 500)
        });
        return null;
      }
    }
  });
  const candidatePairs = scanOutcome.usablePairs;
  const brandBatchesCompleted = scanOutcome.batchesCompleted;
  state.entitiesAttempted = scanOutcome.brandsScanned;

  const selection = selectDistinctPairOutcome(candidatePairs, options.targetPairs);
  const selectedPairs = selection.selected;
  const selectedKeys = new Map(selectedPairs.map((pair, index) => [
    `${pair.anchor.vehicle_id}:${pair.link.person_id}`,
    index + 1
  ]));
  const results = [];
  for (const pair of [...candidatePairs].sort((a, b) =>
    compareUsablePairs(a, b, { global: true })
  )) {
    try {
      const key = `${pair.anchor.vehicle_id}:${pair.link.person_id}`;
      const selectedRank = selectedKeys.get(key) || null;
      const saved = await persistUsablePair(
        pool,
        run.id,
        pair,
        selectedRank !== null
      );
      if (selectedRank === null) continue;
      results.push({
        rank: selectedRank,
        vehicle_brand: pair.anchor.vehicle_brand,
        normalized_vehicle_brand: pair.anchor.normalized_vehicle_brand,
        vehicle_code: pair.anchor.vehicle_code,
        vehicle_id: String(pair.anchor.vehicle_id),
        person_id: String(pair.link.person_id),
        person_slug: pair.link.slug,
        f1_driver: pair.link.f1_driver === true,
        pair_signal_id: String(saved.id),
        pair_status: pair.pairStatus,
        joint_video_views: pair.views === null ? null : String(pair.views),
        selected: true
      });
    } catch (error) {
      state.errors.push({
        vehicle_brand: pair.anchor.vehicle_brand,
        vehicle_code: pair.anchor.vehicle_code,
        message: String(error.message).slice(0, 500)
      });
    }
  }

  results.sort((a, b) => a.rank - b.rank);

  const status = scanOutcome.quotaBlocked
    ? "PARTIAL"
    : (state.errors.length > 0 ? "FAILED" : "COMPLETED");
  const distinctSelectedBrandCount = new Set(
    results.map(item => item.normalized_vehicle_brand)
  ).size;
  const distinctSelectedVehicleCount = new Set(
    results.map(item => item.vehicle_id)
  ).size;
  const distinctSelectedPersonCount = new Set(
    results.map(item => item.person_id)
  ).size;
  const targetReached = results.length === options.targetPairs &&
    distinctSelectedBrandCount === options.targetPairs &&
    distinctSelectedVehicleCount === options.targetPairs &&
    distinctSelectedPersonCount === options.targetPairs;
  const summary = {
    target_pairs: options.targetPairs,
    max_brand_anchors: options.maxBrandAnchors,
    brand_batch_size: options.brandBatchSize,
    brands_available: anchors.brandsAvailable,
    brands_scanned: state.entitiesAttempted,
    brand_batches_completed: brandBatchesCompleted,
    vehicles_deduplicated_by_brand: Math.max(
      0,
      anchors.vehicleAnchorCount - anchors.brandsAvailable
    ),
    usable_brand_pairs: selectBestPairPerBrand(candidatePairs).length,
    candidate_pair_count: candidatePairs.length,
    candidate_person_count: state.candidatePeopleAttempted,
    distinct_candidate_person_count: state.distinctCandidatePersonIds.size,
    selected_pair_count: results.length,
    distinct_selected_brand_count: distinctSelectedBrandCount,
    distinct_selected_vehicle_count: distinctSelectedVehicleCount,
    distinct_selected_person_count: distinctSelectedPersonCount,
    duplicate_selected_brand_count:
      results.length - distinctSelectedBrandCount,
    duplicate_selected_person_count:
      results.length - distinctSelectedPersonCount,
    person_conflicts_resolved: selection.personConflictsResolved,
    f1_candidates_attempted: state.f1CandidatesAttempted,
    f1_proven_pairs_found: state.f1ProvenPairsFound,
    f1_selected_pairs: results.filter(item => item.f1_driver).length,
    proven_pairs_found: state.provenPairsFound,
    founder_fallback_pairs_found: state.founderFallbackPairsFound,
    insufficient_pair_count: Math.max(0, options.targetPairs - results.length),
    target_reached: targetReached,
    result_code: scanOutcome.quotaBlocked
      ? "YOUTUBE_SEARCH_QUOTA_BLOCKED"
      : (targetReached
        ? "TARGET_REACHED"
        : "INSUFFICIENT_DISTINCT_BRAND_PERSON_PAIRS"),
    resumed_from: options.resumeRunId,
    progress_resumed: Boolean(options.resumeRunId),
    candidate_people_attempted: state.candidatePeopleAttempted,
    search_queries: state.searchQueries,
    search_queries_planned: state.searchQueriesPlanned,
    search_queries_cache_hit: state.searchQueriesCacheHit,
    search_queries_api_called: state.searchQueriesApiCalled,
    max_search_queries: state.maxSearchQueries,
    videos_list_calls: state.videosListCalls,
    quota_budget_exhausted: state.quotaBudgetExhausted,
    quota_errors: state.quotaErrors,
    videos_discovered: state.videosDiscovered,
    videos_evaluated: state.videosEvaluated,
    no_match_pairs: state.noMatchPairs,
    quota_units: state.quotaUnits,
    errors: state.errors,
    results,
    brand_results: state.brandResults
  };
  const progress = {
    resumed_from: options.resumeRunId,
    completed_normalized_brands: [...new Set([
      ...resumeContext.completedBrands,
      ...state.brandResults.map(item => item.normalized_vehicle_brand)
    ])],
    pending: scanOutcome.pendingAnchor,
    search_queries_api_called: state.searchQueriesApiCalled,
    search_queries_cache_hit: state.searchQueriesCacheHit
  };
  await pool.query(`
    UPDATE vehicle_person_pair_runs
    SET status=$1, entities_attempted=$2, candidate_people_attempted=$3,
      search_queries=$4, videos_discovered=$5, videos_evaluated=$6,
      proven_pairs=$7, founder_fallback_pairs=$8, no_match_pairs=$9,
      errors=$10::jsonb, summary=$11::jsonb, error_message=$12,
      progress=$13::jsonb,
      completed_at=NOW(), updated_at=NOW()
    WHERE id=$14
  `, [
    status, state.entitiesAttempted, state.candidatePeopleAttempted,
    state.searchQueries, state.videosDiscovered, state.videosEvaluated,
    state.provenPairsFound, state.founderFallbackPairsFound, state.noMatchPairs,
    JSON.stringify(state.errors), JSON.stringify(summary),
    status === "FAILED" ? "One or more pair candidates failed." :
      (status === "PARTIAL" ? "YouTube search quota blocked; run is resumable." : null),
    JSON.stringify(progress),
    run.id
  ]);
  if (status === "COMPLETED" && targetReached) {
    await pool.query(`
      UPDATE vehicle_person_pair_runs
      SET superseded_by_run_id=$1, superseded_at=NOW(), updated_at=NOW()
      WHERE id<>$1 AND status='COMPLETED' AND superseded_at IS NULL
        AND COALESCE((summary->>'target_reached')::boolean,FALSE)
    `, [run.id]);
  }
  return {
    runId: String(run.id),
    status,
    ...state,
    brandBatchesCompleted,
    results,
    summary
  };
}

async function processNextVehiclePersonPairRun(pool, options = {}) {
  const run = await claimNextVehiclePersonPairRun(pool, options.workerId);
  if (!run) return null;
  try {
    return await executeVehiclePersonPairRun(pool, run, options);
  } catch (error) {
    await pool.query(`
      UPDATE vehicle_person_pair_runs
      SET status='FAILED', error_message=$1, completed_at=NOW(), updated_at=NOW()
      WHERE id=$2
    `, [String(error.message), run.id]);
    throw error;
  }
}

module.exports = {
  SPECIFICITY,
  FALLBACK_BRANDS,
  PairQuotaBlockedError,
  normalizeSearchQuery,
  isYoutubeQuotaError,
  buildPairSearchQueries,
  executePairSearchQuery,
  searchPair,
  normalizePairRunPayload,
  evaluateJointVideo,
  rankPairs,
  selectBestPair,
  pairSpecificity,
  isFounderEligible,
  isFounderFallbackEligible,
  isCrossCountryPair,
  normalizeVehicleBrand,
  dedupeAnchorsByBrand,
  compareUsablePairs,
  selectBestPairPerBrand,
  selectDistinctPairOutcome,
  selectTopDistinctBrandAndPersonPairs,
  scanBrandAnchorBatches,
  claimNextVehiclePersonPairRun,
  executeVehiclePersonPairRun,
  processNextVehiclePersonPairRun,
  fetchVehicleAnchors,
  fetchCandidatePeople,
  fetchFounderDirectSupport
};

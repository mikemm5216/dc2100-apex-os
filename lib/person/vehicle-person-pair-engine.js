const {
  normalizePersonText,
  aliasMatchesNormalizedText
} = require("./normalization");
const { sanitizeQueryTerm } = require("./query-builder");
const { searchVideos, fetchVideos } = require("../scanner/youtube");
const {
  parseIso8601Duration,
  classifyShortFormat
} = require("../scanner/metrics");

const SPECIFICITY = { SAME_BRAND: 1, SAME_SERIES: 2, EXACT_MODEL: 3 };
const FOUNDER_ROLE = "FOUNDER_EXECUTIVE";
const FALLBACK_BRANDS = new Set(["tesla", "xiaomi"]);

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

function clamp(value, fallback, max = 50) {
  const number = Number(value);
  return Number.isInteger(number)
    ? Math.max(1, Math.min(max, number))
    : fallback;
}

function normalizePairRunPayload(payload = {}) {
  return {
    historyScope: "ALL_TIME",
    format:
      String(payload.format || "SHORTS").toUpperCase() === "ALL"
        ? "ALL"
        : "SHORTS",
    maxVehicles: clamp(payload.max_vehicles, 10),
    maxPeoplePerVehicle: clamp(payload.max_people_per_vehicle, 10, 10)
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

async function fetchVehicleAnchors(pool, maxVehicles, format) {
  const result = await pool.query(`
    WITH ranked AS (
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
    )
    SELECT r.resolved_vehicle_id AS vehicle_id, r.id AS signal_id,
      r.external_id AS video_id, r.title, r.url, r.views, r.published_at,
      v.code AS vehicle_code, v.name AS vehicle_name,
      v.manufacturer AS vehicle_brand, v.country_id AS vehicle_country_id
    FROM ranked r
    JOIN vehicles v ON v.id=r.resolved_vehicle_id
    WHERE r.rn=1
    ORDER BY r.views DESC, r.published_at DESC, r.id ASC
    LIMIT $1
  `, [maxVehicles, format]);
  return result.rows;
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
      p.id AS person_id, p.slug, p.canonical_name, p.aliases,
      p.country_id AS person_country_id, p.role_category,
      p.life_status, p.life_status_source
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
    if (!existing || SPECIFICITY[row.pair_specificity] > SPECIFICITY[existing.pair_specificity]) {
      bestByPerson.set(String(row.person_id), row);
    }
  }
  const candidates = [...bestByPerson.values()].sort((a, b) =>
    SPECIFICITY[b.pair_specificity] - SPECIFICITY[a.pair_specificity] ||
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

async function searchPair(link, anchor, format, apiKey, state) {
  const aliases = [link.canonical_name, ...(Array.isArray(link.aliases) ? link.aliases : [])]
    .filter(Boolean);
  const strongestAlias = aliases.find(alias =>
    normalizePersonText(alias) !== normalizePersonText(link.canonical_name)
  ) || aliases[0];
  const vehicleTerms = [
    { term: link.vehicle_model, specificity: "EXACT_MODEL" },
    { term: link.vehicle_series, specificity: "SAME_SERIES" },
    { term: link.vehicle_brand || anchor.vehicle_brand, specificity: "SAME_BRAND" }
  ].filter(item => item.term);
  const queries = [
    [aliases[0], link.vehicle_model || anchor.vehicle_name],
    [strongestAlias, link.vehicle_model || anchor.vehicle_name],
    [aliases[0], link.vehicle_series],
    [aliases[0], link.vehicle_brand || anchor.vehicle_brand]
  ].map(parts => parts.map(sanitizeQueryTerm).filter(Boolean).join(" ")).filter(Boolean);

  const videoIds = [];
  const queryByVideoId = new Map();
  for (const query of [...new Set(queries)]) {
    state.searchQueries += 1;
    const found = await searchVideos(query, {
      apiKey,
      maxResults: 10,
      onRequest() { state.quotaUnits += 1; }
    });
    videoIds.push(...found);
    for (const videoId of found) {
      if (!queryByVideoId.has(videoId)) queryByVideoId.set(videoId, query);
    }
  }
  const uniqueIds = [...new Set(videoIds)];
  state.videosDiscovered += uniqueIds.length;
  if (!uniqueIds.length) return null;

  const videos = await fetchVideos(uniqueIds, {
    apiKey,
    onRequest() { state.quotaUnits += 1; }
  });
  state.videosEvaluated += videos.length;
  const matches = videos
    .map(video => {
      const match = evaluateJointVideo(video, {
        personTerms: aliases,
        vehicleTerms,
        format
      });
      return match
        ? { ...match, searchQuery: queryByVideoId.get(video.videoId) }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.views - a.views ||
      SPECIFICITY[b.pairSpecificity] - SPECIFICITY[a.pairSpecificity] ||
      new Date(b.video.publishedAt) - new Date(a.video.publishedAt));
  return matches[0] || null;
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

async function persistProvenPair(pool, runId, anchor, link, match) {
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
      $15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27::jsonb,TRUE
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
      person_match_field: match.personMatchField,
      vehicle_match_field: match.vehicleMatchField,
      channel_title_used: false
    })
  ]);
  return result.rows[0];
}

async function persistFounderFallback(pool, runId, anchor, link, support) {
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
      $10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,TRUE
    ) RETURNING id
  `, [
    runId, anchor.vehicle_id, link.person_id, link.link_id,
    link.person_country_id, link.role_category, link.life_status,
    link.pair_specificity, crossCountry, anchor.signal_id, anchor.video_id,
    anchor.title, anchor.url, anchor.views, support.id,
    support.external_video_id, support.video_title, support.video_url,
    support.video_views, JSON.stringify({
      fallback_brand: anchor.vehicle_brand,
      person_direct_mention_field: support.direct_mention_field,
      channel_title_used: false
    })
  ]);
  return result.rows[0];
}

async function executeVehiclePersonPairRun(pool, run, { apiKey } = {}) {
  const options = normalizePairRunPayload(run.request_payload);
  const state = {
    entitiesAttempted: 0,
    candidatePeopleAttempted: 0,
    searchQueries: 0,
    videosDiscovered: 0,
    videosEvaluated: 0,
    provenPairs: 0,
    founderFallbackPairs: 0,
    noMatchPairs: 0,
    quotaUnits: 0,
    errors: [],
    results: []
  };
  const anchors = await fetchVehicleAnchors(pool, options.maxVehicles, options.format);
  state.entitiesAttempted = anchors.length;

  for (const anchor of anchors) {
    try {
      const people = await fetchCandidatePeople(pool, anchor, options.maxPeoplePerVehicle);
      state.candidatePeopleAttempted += people.length;
      const proven = [];
      for (const link of people) {
        const match = await searchPair(link, anchor, options.format, apiKey, state);
        if (match) proven.push({ ...match, link, anchor });
        else state.noMatchPairs += 1;
      }
      const bestProven = selectBestPair(proven);

      if (bestProven) {
        const saved = await persistProvenPair(pool, run.id, anchor, bestProven.link, bestProven);
        state.provenPairs += 1;
        state.results.push({
          vehicle_code: anchor.vehicle_code,
          person_slug: bestProven.link.slug,
          pair_signal_id: String(saved.id),
          status: "PROVEN_PAIR"
        });
        continue;
      }

      if (FALLBACK_BRANDS.has(normalizePersonText(anchor.vehicle_brand))) {
        const livingFounders = people.filter(person =>
          person.role_category === FOUNDER_ROLE && person.life_status === "ALIVE"
        );
        for (const founder of livingFounders) {
          const support = await fetchFounderDirectSupport(pool, founder, options.format);
          if (!isFounderFallbackEligible({ anchor, person: founder, directSupport: support, provenPairs: proven })) continue;
          const saved = await persistFounderFallback(pool, run.id, anchor, founder, support);
          state.founderFallbackPairs += 1;
          state.results.push({
            vehicle_code: anchor.vehicle_code,
            person_slug: founder.slug,
            pair_signal_id: String(saved.id),
            status: "CURATED_FOUNDER_FALLBACK"
          });
          break;
        }
      }
      if (!state.results.some(row => row.vehicle_code === anchor.vehicle_code)) {
        state.results.push({ vehicle_code: anchor.vehicle_code, status: "NO_MATCH" });
      }
    } catch (error) {
      state.errors.push({
        vehicle_code: anchor.vehicle_code,
        message: String(error.message).slice(0, 500)
      });
    }
  }

  const status = state.errors.length > 0 ? "FAILED" : "COMPLETED";
  const summary = { ...state, options };
  await pool.query(`
    UPDATE vehicle_person_pair_runs
    SET status=$1, entities_attempted=$2, candidate_people_attempted=$3,
      search_queries=$4, videos_discovered=$5, videos_evaluated=$6,
      proven_pairs=$7, founder_fallback_pairs=$8, no_match_pairs=$9,
      errors=$10::jsonb, summary=$11::jsonb, error_message=$12,
      completed_at=NOW(), updated_at=NOW()
    WHERE id=$13
  `, [
    status, state.entitiesAttempted, state.candidatePeopleAttempted,
    state.searchQueries, state.videosDiscovered, state.videosEvaluated,
    state.provenPairs, state.founderFallbackPairs, state.noMatchPairs,
    JSON.stringify(state.errors), JSON.stringify(summary),
    status === "FAILED" ? "One or more pair candidates failed." : null,
    run.id
  ]);
  return { runId: String(run.id), status, ...state };
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
  normalizePairRunPayload,
  evaluateJointVideo,
  rankPairs,
  selectBestPair,
  pairSpecificity,
  isFounderEligible,
  isFounderFallbackEligible,
  isCrossCountryPair,
  claimNextVehiclePersonPairRun,
  executeVehiclePersonPairRun,
  processNextVehiclePersonPairRun,
  fetchVehicleAnchors,
  fetchCandidatePeople,
  fetchFounderDirectSupport
};

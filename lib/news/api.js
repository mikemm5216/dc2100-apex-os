// =========================================================
// COUNTRY NEWS API — Task 3.3D
//
// Route handlers for the Country News Traffic Radar. All
// user input is validated against allowlists and bound as
// SQL parameters; nothing is interpolated into SQL text.
// =========================================================

const {
  NEWS_RUN_LIMITS,
  getCountryAliases,
  normalizeNewsRunPayload
} = require("./country-query-catalog");

const {
  NEWS_CATEGORIES,
  CONFLICT_ARCHETYPES,
  CATEGORY_RULES
} = require("./classification");

const { VEHICLE_WINDOW_DAYS } = require("./engine");

const {
  aliasMatchesNormalizedText,
  normalizePersonText
} = require("../person/normalization");

const WINDOW_HOURS = new Set([24, 72, 168]);

const TRAFFIC_TIER_FILTERS = new Set([
  "ALL",
  "BREAKOUT",
  "ACTIVE",
  "WATCH",
  "LOW_SIGNAL"
]);

const TRANSFORMATION_TIER_FILTERS = new Set([
  "ALL",
  "HIGH",
  "MEDIUM",
  "LOW"
]);

const CATEGORY_FILTERS = new Set([
  "ALL",
  ...NEWS_CATEGORIES
]);

const ARCHETYPE_FILTERS = new Set([
  "ALL",
  ...CONFLICT_ARCHETYPES
]);

const NEWS_SORTS = {
  traffic_score: `
    cns.traffic_score DESC,
    cns.publisher_count DESC,
    cns.mention_count DESC,
    cns.published_at DESC NULLS LAST,
    cns.id DESC
  `,

  recency: `
    cns.published_at DESC NULLS LAST,
    cns.traffic_score DESC,
    cns.id DESC
  `,

  publisher_count: `
    cns.publisher_count DESC,
    cns.traffic_score DESC,
    cns.id DESC
  `,

  mention_count: `
    cns.mention_count DESC,
    cns.traffic_score DESC,
    cns.id DESC
  `,

  transformation_potential: `
    cns.transformation_potential DESC,
    cns.traffic_score DESC,
    cns.id DESC
  `
};

function response(statusCode, payload) {
  return { statusCode, payload };
}

function validationError(message, details = {}) {
  return {
    error: {
      statusCode: 400,
      payload: {
        error: "VALIDATION_ERROR",
        message,
        ...details
      }
    }
  };
}

// =========================================================
// POST /country-news/run
// =========================================================

function validateNewsRunPayload(body) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    return validationError(
      "Request body must be a JSON object."
    );
  }

  if (body.max_countries !== undefined) {
    if (
      !Number.isInteger(body.max_countries) ||
      body.max_countries <
        NEWS_RUN_LIMITS.MAX_COUNTRIES.min ||
      body.max_countries >
        NEWS_RUN_LIMITS.MAX_COUNTRIES.max
    ) {
      return validationError(
        "max_countries must be an integer from 1 to 10."
      );
    }
  }

  if (body.max_queries_per_country !== undefined) {
    if (
      !Number.isInteger(
        body.max_queries_per_country
      ) ||
      body.max_queries_per_country <
        NEWS_RUN_LIMITS.MAX_QUERIES_PER_COUNTRY.min ||
      body.max_queries_per_country >
        NEWS_RUN_LIMITS.MAX_QUERIES_PER_COUNTRY.max
    ) {
      return validationError(
        "max_queries_per_country must be an integer from 1 to 5."
      );
    }
  }

  if (body.max_items_per_query !== undefined) {
    if (
      !Number.isInteger(body.max_items_per_query) ||
      body.max_items_per_query <
        NEWS_RUN_LIMITS.MAX_ITEMS_PER_QUERY.min ||
      body.max_items_per_query >
        NEWS_RUN_LIMITS.MAX_ITEMS_PER_QUERY.max
    ) {
      return validationError(
        "max_items_per_query must be an integer from 5 to 50."
      );
    }
  }

  if (
    body.max_age_hours !== undefined &&
    !NEWS_RUN_LIMITS.MAX_AGE_HOURS_ALLOWED.includes(
      body.max_age_hours
    )
  ) {
    return validationError(
      "max_age_hours must be 24, 72, or 168."
    );
  }

  if (
    body.country_codes !== undefined &&
    body.country_codes !== null
  ) {
    if (
      !Array.isArray(body.country_codes) ||
      body.country_codes.length === 0
    ) {
      return validationError(
        "country_codes must be null or a non-empty array."
      );
    }

    if (
      body.country_codes.length >
      NEWS_RUN_LIMITS.MAX_COUNTRY_CODES
    ) {
      return validationError(
        "country_codes can contain at most 10 codes."
      );
    }

    const invalid = body.country_codes.filter(
      value =>
        !/^[A-Za-z]{2}$/.test(String(value).trim())
    );

    if (invalid.length > 0) {
      return validationError(
        "country_codes must contain ISO 3166-1 alpha-2 codes only.",
        { invalid_country_codes: invalid }
      );
    }
  }

  const normalized = normalizeNewsRunPayload(body);

  return {
    value: {
      max_countries: normalized.maxCountries,
      max_queries_per_country:
        normalized.maxQueriesPerCountry,
      max_items_per_query:
        normalized.maxItemsPerQuery,
      max_age_hours: normalized.maxAgeHours,
      country_codes: normalized.countryCodes
    }
  };
}

async function createCountryNewsRun(pool, body) {
  const validation = validateNewsRunPayload(body);

  if (validation.error) {
    return validation.error;
  }

  const requestPayload = validation.value;

  const activeResult = await pool.query(
    `
      SELECT
        id,
        status,
        created_at,
        started_at
      FROM country_news_runs
      WHERE status IN ('QUEUED', 'RUNNING')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `
  );

  if (activeResult.rowCount > 0) {
    return response(409, {
      error: "COUNTRY_NEWS_RUN_ACTIVE",
      message:
        "A country news run is already queued or running.",
      active_run: activeResult.rows[0]
    });
  }

  // Requested country codes must exist in the countries
  // table AND appear in recent resolved Vehicle Shorts.
  if (requestPayload.country_codes) {
    const eligibleResult = await pool.query(
      `
        SELECT DISTINCT c.code
        FROM signals sig
        JOIN countries c
          ON c.id = sig.resolved_country_id
        WHERE sig.is_short = TRUE
          AND sig.resolved_country_id IS NOT NULL
          AND sig.published_at >=
            NOW() - make_interval(days => $1::int)
          AND c.code = ANY($2::text[])
      `,
      [
        VEHICLE_WINDOW_DAYS,
        requestPayload.country_codes
      ]
    );

    const eligible = new Set(
      eligibleResult.rows.map(row => row.code)
    );

    const ineligible =
      requestPayload.country_codes.filter(
        code => !eligible.has(code)
      );

    if (ineligible.length > 0) {
      return response(400, {
        error: "INVALID_COUNTRY_SELECTION",
        message:
          "One or more countries have no recent resolved vehicle signals.",
        invalid_country_codes: ineligible
      });
    }
  }

  const insertResult = await pool.query(
    `
      INSERT INTO country_news_runs (
        status,
        request_payload,
        country_count
      )
      VALUES (
        'QUEUED',
        $1::jsonb,
        $2
      )
      RETURNING
        id,
        status,
        request_payload,
        country_count,
        created_at
    `,
    [
      JSON.stringify(requestPayload),
      requestPayload.country_codes
        ? requestPayload.country_codes.length
        : 0
    ]
  );

  return response(202, {
    data: insertResult.rows[0],
    message: "Country news run queued successfully."
  });
}

// =========================================================
// GET /country-news/runs/:id
// =========================================================

async function getCountryNewsRun(pool, runId) {
  const result = await pool.query(
    `
      SELECT
        id,
        status,
        request_payload,
        summary,

        country_count,
        completed_country_count,
        failed_country_count,

        query_count,
        succeeded_query_count,

        item_count,
        mention_inserted_count,
        mention_updated_count,
        cluster_inserted_count,
        cluster_updated_count,

        error_message,

        locked_by,
        locked_at,

        started_at,
        completed_at,

        created_at,
        updated_at

      FROM country_news_runs

      WHERE id = $1
    `,
    [runId]
  );

  if (result.rowCount === 0) {
    return response(404, {
      error: "COUNTRY_NEWS_RUN_NOT_FOUND",
      message:
        `Country news run ${runId} was not found.`
    });
  }

  return response(200, {
    data: result.rows[0]
  });
}

// =========================================================
// GET /country-news
// =========================================================

function parseIntegerParameter(
  value,
  { fieldName, minimum, maximum, fallback }
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
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

function parseCountryNewsQuery(searchParams) {
  const requestedWindow = Number(
    searchParams.get("window_hours") || 72
  );

  if (!WINDOW_HOURS.has(requestedWindow)) {
    return validationError(
      "window_hours must be 24, 72, or 168."
    );
  }

  const rawCountryCode = (
    searchParams.get("country_code") || ""
  ).trim();

  if (
    rawCountryCode !== "" &&
    !/^[A-Za-z]{2}$/.test(rawCountryCode)
  ) {
    return validationError(
      "country_code must be a 2-letter ISO 3166-1 alpha-2 code."
    );
  }

  const category = (
    searchParams.get("category") || "ALL"
  ).toUpperCase();

  if (!CATEGORY_FILTERS.has(category)) {
    return validationError(
      "category is not a recognized news category."
    );
  }

  const trafficTier = (
    searchParams.get("traffic_tier") || "ALL"
  ).toUpperCase();

  if (!TRAFFIC_TIER_FILTERS.has(trafficTier)) {
    return validationError(
      "traffic_tier must be ALL, BREAKOUT, ACTIVE, WATCH, or LOW_SIGNAL."
    );
  }

  const transformationTier = (
    searchParams.get("transformation_tier") || "ALL"
  ).toUpperCase();

  if (
    !TRANSFORMATION_TIER_FILTERS.has(
      transformationTier
    )
  ) {
    return validationError(
      "transformation_tier must be ALL, HIGH, MEDIUM, or LOW."
    );
  }

  const conflictArchetype = (
    searchParams.get("conflict_archetype") || "ALL"
  ).toUpperCase();

  if (!ARCHETYPE_FILTERS.has(conflictArchetype)) {
    return validationError(
      "conflict_archetype is not a recognized conflict archetype."
    );
  }

  const sort =
    searchParams.get("sort") || "traffic_score";

  if (!NEWS_SORTS[sort]) {
    return validationError(
      "sort must be traffic_score, recency, publisher_count, mention_count, or transformation_potential."
    );
  }

  const limitResult = parseIntegerParameter(
    searchParams.get("limit"),
    {
      fieldName: "limit",
      minimum: 1,
      maximum: 100,
      fallback: 100
    }
  );

  if (limitResult.error) {
    return validationError(limitResult.error);
  }

  const offsetResult = parseIntegerParameter(
    searchParams.get("offset"),
    {
      fieldName: "offset",
      minimum: 0,
      maximum: 10000,
      fallback: 0
    }
  );

  if (offsetResult.error) {
    return validationError(offsetResult.error);
  }

  const search = (searchParams.get("q") || "")
    .trim()
    .slice(0, 200);

  return {
    value: {
      windowHours: requestedWindow,
      countryCode: rawCountryCode.toUpperCase(),
      category,
      trafficTier,
      transformationTier,
      conflictArchetype,
      sort,
      limit: limitResult.value,
      offset: offsetResult.value,
      search
    }
  };
}

function buildNewsConditions(options) {
  const values = [options.windowHours];

  const conditions = [
    `
      COALESCE(
        cns.published_at,
        cns.last_seen_at
      ) >=
        NOW() - make_interval(hours => $1::int)
    `
  ];

  if (options.countryCode) {
    values.push(options.countryCode);
    conditions.push(`c.code = $${values.length}`);
  }

  if (options.category !== "ALL") {
    values.push(options.category);
    conditions.push(
      `cns.category = $${values.length}`
    );
  }

  if (options.trafficTier !== "ALL") {
    values.push(options.trafficTier);
    conditions.push(
      `cns.traffic_tier = $${values.length}`
    );
  }

  if (options.transformationTier !== "ALL") {
    values.push(options.transformationTier);
    conditions.push(
      `cns.transformation_tier = $${values.length}`
    );
  }

  if (options.conflictArchetype !== "ALL") {
    values.push(
      JSON.stringify([options.conflictArchetype])
    );
    conditions.push(
      `cns.conflict_archetypes @> $${values.length}::jsonb`
    );
  }

  if (options.search) {
    values.push(`%${options.search}%`);

    conditions.push(
      `
        (
          cns.title ILIKE $${values.length}
          OR
          cns.representative_source ILIKE
            $${values.length}
          OR
          cns.keywords::text ILIKE $${values.length}
        )
      `
    );
  }

  return { values, conditions };
}

const VEHICLE_ANCHOR_CTE = `
  vehicle_anchor AS (
    SELECT
      sig.resolved_country_id AS country_id,

      COUNT(*)::int AS vehicle_signal_count,

      COUNT(*) FILTER (
        WHERE sig.qualified
      )::int AS qualified_vehicle_signal_count,

      COALESCE(SUM(sig.views), 0)::bigint
        AS vehicle_views_total,

      COALESCE(MAX(sig.views), 0)::bigint
        AS vehicle_views_max

    FROM signals sig

    WHERE sig.is_short = TRUE
      AND sig.resolved_country_id IS NOT NULL
      AND sig.published_at >=
        NOW() - make_interval(
          days => ${VEHICLE_WINDOW_DAYS}
        )

    GROUP BY sig.resolved_country_id
  )
`;

async function listCountryNews(pool, searchParams) {
  const parsed = parseCountryNewsQuery(searchParams);

  if (parsed.error) {
    return parsed.error;
  }

  const options = parsed.value;

  const { values, conditions } =
    buildNewsConditions(options);

  values.push(options.limit);
  const limitIndex = values.length;

  values.push(options.offset);
  const offsetIndex = values.length;

  const listResult = await pool.query(
    `
      WITH ${VEHICLE_ANCHOR_CTE}
      SELECT
        cns.id,
        cns.country_id,
        c.code AS country_code,
        c.name AS country_name,

        cns.title,
        cns.representative_url,
        cns.representative_source,
        cns.representative_domain,

        cns.category,
        cns.category_confidence,

        cns.country_match_method,
        cns.country_confidence,

        cns.traffic_tier,
        cns.traffic_score,
        cns.mention_count,
        cns.publisher_count,
        cns.query_count,
        cns.feed_rank_score,
        cns.age_hours,

        cns.transformation_tier,
        cns.transformation_potential,

        cns.conflict_archetypes,
        cns.keywords,

        cns.published_at,
        cns.first_seen_at,
        cns.last_seen_at,

        cns.provider,
        cns.resolver_version,

        COALESCE(va.vehicle_signal_count, 0)
          AS vehicle_signal_count,
        COALESCE(
          va.qualified_vehicle_signal_count,
          0
        ) AS qualified_vehicle_signal_count,
        COALESCE(va.vehicle_views_total, 0)
          AS vehicle_views_total,
        COALESCE(va.vehicle_views_max, 0)
          AS vehicle_views_max,

        COUNT(*) OVER() AS total_count

      FROM country_news_signals cns

      JOIN countries c
        ON c.id = cns.country_id

      LEFT JOIN vehicle_anchor va
        ON va.country_id = cns.country_id

      WHERE ${conditions.join("\nAND ")}

      ORDER BY ${NEWS_SORTS[options.sort]}

      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `,
    values
  );

  const totalCount =
    listResult.rows.length > 0
      ? Number(listResult.rows[0].total_count)
      : 0;

  const data = listResult.rows.map(row => {
    const { total_count, ...record } = row;
    return record;
  });

  // Summary aggregates cover the WHOLE filtered window,
  // never just the visible page.
  const summaryResult = await pool.query(
    `
      WITH ${VEHICLE_ANCHOR_CTE},
      filtered AS (
        SELECT
          cns.id,
          cns.country_id,
          cns.traffic_tier,
          cns.transformation_tier
        FROM country_news_signals cns
        JOIN countries c
          ON c.id = cns.country_id
        WHERE ${conditions.join("\nAND ")}
      )
      SELECT
        COUNT(*)::int AS total_count,

        COUNT(*) FILTER (
          WHERE traffic_tier = 'BREAKOUT'
        )::int AS breakout_count,

        COUNT(*) FILTER (
          WHERE traffic_tier = 'ACTIVE'
        )::int AS active_count,

        COUNT(*) FILTER (
          WHERE traffic_tier = 'WATCH'
        )::int AS watch_count,

        COUNT(*) FILTER (
          WHERE traffic_tier = 'LOW_SIGNAL'
        )::int AS low_signal_count,

        COUNT(*) FILTER (
          WHERE transformation_tier = 'HIGH'
        )::int AS high_transformation_count,

        COUNT(*) FILTER (
          WHERE transformation_tier = 'MEDIUM'
        )::int AS medium_transformation_count,

        COUNT(*) FILTER (
          WHERE transformation_tier = 'LOW'
        )::int AS low_transformation_count,

        COUNT(DISTINCT country_id)::int
          AS active_country_count,

        (
          SELECT
            COALESCE(
              SUM(va.vehicle_signal_count),
              0
            )::int
          FROM vehicle_anchor va
          WHERE va.country_id IN (
            SELECT DISTINCT country_id
            FROM filtered
          )
        ) AS vehicle_anchor_count,

        (
          SELECT
            COALESCE(
              SUM(va.vehicle_views_total),
              0
            )::bigint
          FROM vehicle_anchor va
          WHERE va.country_id IN (
            SELECT DISTINCT country_id
            FROM filtered
          )
        ) AS vehicle_views_total

      FROM filtered
    `,
    values.slice(0, values.length - 2)
  );

  return response(200, {
    data,
    count: data.length,
    total_count: totalCount,
    summary: summaryResult.rows[0] || {},
    filters: {
      window_hours: options.windowHours,
      country_code: options.countryCode,
      category: options.category,
      traffic_tier: options.trafficTier,
      transformation_tier:
        options.transformationTier,
      conflict_archetype:
        options.conflictArchetype,
      sort: options.sort,
      q: options.search,
      limit: options.limit,
      offset: options.offset
    }
  });
}

// =========================================================
// GET /country-news/:id
// =========================================================

async function getCountryNewsDetail(pool, newsId) {
  const signalResult = await pool.query(
    `
      WITH ${VEHICLE_ANCHOR_CTE}
      SELECT
        cns.id,
        cns.country_id,
        c.code AS country_code,
        c.name AS country_name,

        cns.story_hash,
        cns.canonical_title,
        cns.title,
        cns.representative_url,
        cns.representative_source,
        cns.representative_domain,

        cns.category,
        cns.category_confidence,
        cns.category_evidence,

        cns.country_match_method,
        cns.country_confidence,
        cns.country_evidence,

        cns.traffic_tier,
        cns.traffic_score,
        cns.mention_count,
        cns.publisher_count,
        cns.query_count,
        cns.feed_rank_score,
        cns.age_hours,

        cns.transformation_tier,
        cns.transformation_potential,

        cns.conflict_archetypes,
        cns.keywords,

        cns.published_at,
        cns.first_seen_at,
        cns.last_seen_at,

        cns.provider,
        cns.resolver_version,
        cns.raw_metadata,

        cns.created_at,
        cns.updated_at,

        COALESCE(va.vehicle_signal_count, 0)
          AS vehicle_signal_count,
        COALESCE(
          va.qualified_vehicle_signal_count,
          0
        ) AS qualified_vehicle_signal_count,
        COALESCE(va.vehicle_views_total, 0)
          AS vehicle_views_total,
        COALESCE(va.vehicle_views_max, 0)
          AS vehicle_views_max

      FROM country_news_signals cns

      JOIN countries c
        ON c.id = cns.country_id

      LEFT JOIN vehicle_anchor va
        ON va.country_id = cns.country_id

      WHERE cns.id = $1
    `,
    [newsId]
  );

  if (signalResult.rowCount === 0) {
    return response(404, {
      error: "COUNTRY_NEWS_NOT_FOUND",
      message:
        `Country news signal ${newsId} was not found.`
    });
  }

  const mentionsResult = await pool.query(
    `
      SELECT
        id,
        external_key,
        query_key,
        query_text,
        feed_rank,

        title,
        normalized_title,
        url,
        guid,

        source_name,
        source_url,
        publisher_domain,

        published_at,
        snippet,

        raw_metadata,
        first_seen_at,
        last_seen_at

      FROM country_news_mentions

      WHERE news_signal_id = $1

      ORDER BY
        published_at DESC NULLS LAST,
        feed_rank ASC NULLS LAST,
        id ASC
    `,
    [newsId]
  );

  return response(200, {
    data: {
      ...signalResult.rows[0],
      mentions: mentionsResult.rows
    }
  });
}

// =========================================================
// COUNTRY DUAL-VIDEO SIGNAL PACK
//
// A signal item is always ONE specific video, but a country
// can legitimately have TWO complementary single-video
// signals at once -- they are never a choice between one or
// the other:
//
//   country_vehicle_identity_video -- the automotive brand's
//   country of origin (`signals.resolved_country_id`, already
//   resolved by the vehicle/country entity resolver). This is
//   industrial/cultural identity, NOT a news event.
//
//   country_current_event_video -- a video matched to the
//   country's current highest-traffic news event
//   (`country_news_signals.country_id`, a completely
//   different resolution path). Never the vehicle-origin
//   country.
//
// Neither role ever uses SUM(views); each is its own single
// highest-viewed / highest-velocity video.
// =========================================================

const DUAL_VIDEO_FORMAT_FILTERS = new Set([
  "SHORTS",
  "ALL"
]);

const COUNTRY_PACK_STATUSES = new Set([
  "ALL",
  "COMPLETE",
  "VEHICLE_ONLY",
  "EVENT_ONLY",
  "NO_MATCH"
]);

function parseCountryDualVideoQuery(searchParams) {
  const requestedWindow = Number(
    searchParams.get("window_hours") || 168
  );

  if (!WINDOW_HOURS.has(requestedWindow)) {
    return validationError(
      "window_hours must be 24, 72, or 168."
    );
  }

  const format = (
    searchParams.get("format") || "SHORTS"
  ).toUpperCase();

  if (!DUAL_VIDEO_FORMAT_FILTERS.has(format)) {
    return validationError(
      "format must be SHORTS or ALL."
    );
  }

  const status = (
    searchParams.get("status") || "COMPLETE"
  ).toUpperCase();

  if (!COUNTRY_PACK_STATUSES.has(status)) {
    return validationError(
      "status must be ALL, COMPLETE, VEHICLE_ONLY, EVENT_ONLY, or NO_MATCH."
    );
  }

  const limitResult = parseIntegerParameter(
    searchParams.get("limit"),
    {
      fieldName: "limit",
      minimum: 1,
      maximum: 100,
      fallback: 10
    }
  );

  if (limitResult.error) {
    return validationError(limitResult.error);
  }

  const offsetResult = parseIntegerParameter(
    searchParams.get("offset"),
    {
      fieldName: "offset",
      minimum: 0,
      maximum: 10000,
      fallback: 0
    }
  );

  if (offsetResult.error) {
    return validationError(offsetResult.error);
  }

  return {
    value: {
      windowHours: requestedWindow,
      format,
      status,
      limit: limitResult.value,
      offset: offsetResult.value
    }
  };
}

// Every country's single highest-viewed vehicle-identity
// video, keyed by country_id. Reads straight from `signals`;
// nothing is copied or persisted -- this role needs no new
// table.
async function fetchCountryVehicleIdentityVideos(
  pool,
  { format }
) {
  const conditions = [
    `sig.entity_resolution_status = 'RESOLVED'`,
    `sig.resolved_country_id IS NOT NULL`,
    `sig.resolved_vehicle_id IS NOT NULL`,
    `sig.views > 0`
  ];

  if (format === "SHORTS") {
    conditions.push(`sig.is_short = TRUE`);
  }

  const result = await pool.query(
    `
      WITH filtered_signals AS (
        SELECT
          sig.id,
          sig.external_id,
          sig.resolved_country_id,
          sig.resolved_vehicle_id,
          sig.views,
          sig.published_at,
          sig.title,
          sig.url,
          sig.thumbnail_url,
          sig.channel_title,
          sig.entity_evidence,
          sig.entity_match_method
        FROM signals sig
        WHERE ${conditions.join("\nAND ")}
      ),
      top_per_country AS (
        SELECT DISTINCT ON (resolved_country_id)
          resolved_country_id AS country_id,
          id AS signal_id,
          external_id AS external_video_id,
          title AS video_title,
          url AS video_url,
          thumbnail_url,
          views AS video_views,
          published_at,
          channel_title,
          resolved_vehicle_id AS vehicle_id,
          entity_evidence,
          entity_match_method
        FROM filtered_signals
        ORDER BY
          resolved_country_id ASC,
          views DESC,
          published_at DESC,
          id ASC
      )
      SELECT
        tp.*,
        veh.code AS vehicle_code,
        veh.name AS vehicle_name,
        veh.manufacturer
      FROM top_per_country tp
      JOIN vehicles veh
        ON veh.id = tp.vehicle_id
    `
  );

  const byCountryId = new Map();

  for (const row of result.rows) {
    byCountryId.set(String(row.country_id), row);
  }

  return byCountryId;
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

// One representative country_news_signal per country within
// the window (highest traffic_score) -- the CURRENT event for
// that country. This id is completely independent of
// signals.resolved_country_id.
async function fetchRepresentativeCountryNewsSignals(
  pool,
  { windowHours }
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

  return result.rows;
}

// Finds the single best video for ONE country's current event:
// a coarse SQL pre-filter on country-name terms (cheap, keeps
// the candidate set small), then precise word-boundary alias
// matching in JS for both the country term and an event
// keyword -- the same matching primitive the person resolver
// uses, reused here for country names instead of person names.
async function matchCountryEventVideo(
  pool,
  newsSignal,
  { countryCode, countryName, format }
) {
  const countryTerms = [
    countryName,
    ...(getCountryAliases(countryCode) || [])
  ].filter(Boolean);

  const keywordTerms = eventKeywordTerms(newsSignal);

  if (countryTerms.length === 0 || keywordTerms.length === 0) {
    return null;
  }

  const conditions = [`sig.views > 0`];
  const values = [];

  if (format === "SHORTS") {
    conditions.push(`sig.is_short = TRUE`);
  }

  const countryLikeClauses = countryTerms.map(term => {
    values.push(`%${term}%`);
    return `sig.title ILIKE $${values.length}`;
  });

  conditions.push(`(${countryLikeClauses.join(" OR ")})`);

  const candidatesResult = await pool.query(
    `
      SELECT
        sig.id,
        sig.external_id,
        sig.title,
        sig.url,
        sig.thumbnail_url,
        sig.views,
        sig.views_per_hour,
        sig.views_per_day,
        sig.published_at,
        sig.channel_title
      FROM signals sig
      WHERE ${conditions.join("\nAND ")}
      ORDER BY
        sig.views_per_hour DESC NULLS LAST,
        sig.views DESC,
        sig.published_at DESC,
        sig.id ASC
      LIMIT 200
    `,
    values
  );

  for (const row of candidatesResult.rows) {
    const normalizedTitle = normalizePersonText(row.title);

    const matchedCountryTerm = countryTerms.find(term =>
      aliasMatchesNormalizedText(normalizedTitle, term)
    );

    if (!matchedCountryTerm) {
      continue;
    }

    const matchedEventTerm = keywordTerms.find(term =>
      aliasMatchesNormalizedText(normalizedTitle, term)
    );

    if (!matchedEventTerm) {
      continue;
    }

    return {
      row,
      matchedCountryTerm,
      matchedEventTerm
    };
  }

  return null;
}

async function upsertCountryEventVideoSignal(
  pool,
  {
    countryNewsSignalId,
    countryId,
    signalId,
    matchedCountryTerm,
    matchedEventTerm,
    viewsPerHour,
    evidence
  }
) {
  await pool.query(
    `
      INSERT INTO country_event_video_signals (
        country_news_signal_id,
        country_id,
        signal_id,
        matched_country_term,
        matched_event_term,
        views_per_hour_at_match,
        relevance_evidence,
        computed_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), NOW())
      ON CONFLICT (country_news_signal_id, signal_id)
      DO UPDATE SET
        matched_country_term = EXCLUDED.matched_country_term,
        matched_event_term = EXCLUDED.matched_event_term,
        views_per_hour_at_match =
          EXCLUDED.views_per_hour_at_match,
        relevance_evidence = EXCLUDED.relevance_evidence,
        computed_at = NOW(),
        updated_at = NOW()
    `,
    [
      countryNewsSignalId,
      countryId,
      signalId,
      matchedCountryTerm,
      matchedEventTerm,
      viewsPerHour,
      JSON.stringify(evidence)
    ]
  );
}

function buildCountryEventVideoPayload(
  newsSignal,
  match
) {
  if (!match) {
    return null;
  }

  const { row, matchedCountryTerm, matchedEventTerm } = match;

  return {
    country_news_signal_id: String(newsSignal.id),
    news_title: newsSignal.title,
    news_source_url: newsSignal.representative_url,
    event_keywords: Array.isArray(newsSignal.keywords)
      ? newsSignal.keywords
      : [],
    conflict_archetypes: Array.isArray(
      newsSignal.conflict_archetypes
    )
      ? newsSignal.conflict_archetypes
      : [],

    signal_id: String(row.id),
    external_video_id: row.external_id,
    video_title: row.title,
    video_url: row.url,
    thumbnail_url: row.thumbnail_url,
    video_views: row.views,
    views_per_hour: row.views_per_hour,
    views_per_day: row.views_per_day,
    published_at: row.published_at,
    channel_title: row.channel_title,

    relevance_evidence: {
      matched_country_term: matchedCountryTerm,
      matched_event_term: matchedEventTerm,
      category: newsSignal.category
    }
  };
}

function buildCountryVehicleIdentityPayload(row) {
  if (!row) {
    return null;
  }

  return {
    signal_id: String(row.signal_id),
    external_video_id: row.external_video_id,
    video_title: row.video_title,
    video_url: row.video_url,
    thumbnail_url: row.thumbnail_url,
    video_views: row.video_views,
    published_at: row.published_at,
    channel_title: row.channel_title,

    vehicle_id: String(row.vehicle_id),
    vehicle_code: row.vehicle_code,
    vehicle_name: row.vehicle_name,
    manufacturer: row.manufacturer,

    entity_evidence: row.entity_evidence,
    entity_match_method: row.entity_match_method
  };
}

function countryPackStatus({
  vehicleIdentityVideo,
  currentEventVideo
}) {
  if (vehicleIdentityVideo && currentEventVideo) {
    return "COMPLETE";
  }

  if (vehicleIdentityVideo) {
    return "VEHICLE_ONLY";
  }

  if (currentEventVideo) {
    return "EVENT_ONLY";
  }

  return "NO_MATCH";
}

async function buildCountryDualVideoPacks(
  pool,
  { windowHours, format }
) {
  const [
    identityByCountryId,
    representativeNewsSignals
  ] = await Promise.all([
    fetchCountryVehicleIdentityVideos(pool, { format }),
    fetchRepresentativeCountryNewsSignals(pool, {
      windowHours
    })
  ]);

  const countryIds = new Set([
    ...identityByCountryId.keys(),
    ...representativeNewsSignals.map(row =>
      String(row.country_id)
    )
  ]);

  if (countryIds.size === 0) {
    return [];
  }

  const countryIdList = [...countryIds];

  const countriesResult = await pool.query(
    `
      SELECT id, code, name
      FROM countries
      WHERE id IN (${
        countryIdList
          .map((_, index) => `$${index + 1}`)
          .join(", ")
      })
    `,
    countryIdList
  );

  const countryById = new Map(
    countriesResult.rows.map(row => [
      String(row.id),
      row
    ])
  );

  const newsByCountryId = new Map(
    representativeNewsSignals.map(row => [
      String(row.country_id),
      row
    ])
  );

  const packs = [];

  for (const countryId of countryIds) {
    const country = countryById.get(countryId);

    if (!country) {
      continue;
    }

    const vehicleIdentityRow =
      identityByCountryId.get(countryId) || null;

    const newsSignal =
      newsByCountryId.get(countryId) || null;

    let currentEventVideo = null;

    if (newsSignal) {
      const match = await matchCountryEventVideo(
        pool,
        newsSignal,
        {
          countryCode: country.code,
          countryName: country.name,
          format
        }
      );

      if (match) {
        await upsertCountryEventVideoSignal(pool, {
          countryNewsSignalId: newsSignal.id,
          countryId: country.id,
          signalId: match.row.id,
          matchedCountryTerm: match.matchedCountryTerm,
          matchedEventTerm: match.matchedEventTerm,
          viewsPerHour: match.row.views_per_hour,
          evidence: {
            matched_country_term:
              match.matchedCountryTerm,
            matched_event_term: match.matchedEventTerm,
            category: newsSignal.category
          }
        });
      }

      currentEventVideo = buildCountryEventVideoPayload(
        newsSignal,
        match
      );
    }

    const vehicleIdentityVideo =
      buildCountryVehicleIdentityPayload(
        vehicleIdentityRow
      );

    const status = countryPackStatus({
      vehicleIdentityVideo,
      currentEventVideo
    });

    const sharedSignal = Boolean(
      vehicleIdentityVideo &&
        currentEventVideo &&
        vehicleIdentityVideo.signal_id ===
          currentEventVideo.signal_id
    );

    packs.push({
      country_id: countryId,
      country_code: country.code,
      country_name: country.name,
      status,
      shared_signal: sharedSignal,
      country_vehicle_identity_video: vehicleIdentityVideo,
      country_current_event_video: currentEventVideo
    });
  }

  return packs;
}

// Default sort: COMPLETE packs first, then by the current
// event's velocity (the more time-sensitive signal), falling
// back to the vehicle-identity video's views. Neither role
// ever ranks by an aggregate.
function sortCountryDualVideoPacks(packs) {
  return [...packs].sort((a, b) => {
    const statusRank = status =>
      status === "COMPLETE" ? 0 : 1;

    if (statusRank(a.status) !== statusRank(b.status)) {
      return statusRank(a.status) - statusRank(b.status);
    }

    const aEventVph = Number(
      a.country_current_event_video?.views_per_hour ?? -1
    );
    const bEventVph = Number(
      b.country_current_event_video?.views_per_hour ?? -1
    );

    if (aEventVph !== bEventVph) {
      return bEventVph - aEventVph;
    }

    const aIdentityViews = Number(
      a.country_vehicle_identity_video?.video_views ?? -1
    );
    const bIdentityViews = Number(
      b.country_vehicle_identity_video?.video_views ?? -1
    );

    if (aIdentityViews !== bIdentityViews) {
      return bIdentityViews - aIdentityViews;
    }

    return a.country_code.localeCompare(b.country_code);
  });
}

async function listCountryDualVideoSignals(
  pool,
  searchParams
) {
  const parsed = parseCountryDualVideoQuery(searchParams);

  if (parsed.error) {
    return parsed.error;
  }

  const options = parsed.value;

  const allPacks = await buildCountryDualVideoPacks(pool, {
    windowHours: options.windowHours,
    format: options.format
  });

  const filteredPacks =
    options.status === "ALL"
      ? allPacks
      : allPacks.filter(
          pack => pack.status === options.status
        );

  const sortedPacks =
    sortCountryDualVideoPacks(filteredPacks);

  const pagedPacks = sortedPacks.slice(
    options.offset,
    options.offset + options.limit
  );

  return response(200, {
    data: pagedPacks,
    count: pagedPacks.length,
    total_count: sortedPacks.length,
    filters: {
      window_hours: options.windowHours,
      format: options.format,
      status: options.status,
      limit: options.limit,
      offset: options.offset
    }
  });
}

async function getCountryDualVideoSignal(
  pool,
  countryId,
  searchParams
) {
  const parsed = parseCountryDualVideoQuery(searchParams);

  if (parsed.error) {
    return parsed.error;
  }

  const options = parsed.value;

  const countryResult = await pool.query(
    `SELECT id, code, name FROM countries WHERE id = $1`,
    [countryId]
  );

  if (countryResult.rowCount === 0) {
    return response(404, {
      error: "COUNTRY_NOT_FOUND",
      message: `Country ${countryId} was not found.`
    });
  }

  const allPacks = await buildCountryDualVideoPacks(pool, {
    windowHours: options.windowHours,
    format: options.format
  });

  const pack = allPacks.find(
    item => item.country_id === String(countryId)
  ) || {
    country_id: String(countryId),
    country_code: countryResult.rows[0].code,
    country_name: countryResult.rows[0].name,
    status: "NO_MATCH",
    shared_signal: false,
    country_vehicle_identity_video: null,
    country_current_event_video: null
  };

  return response(200, { data: pack });
}

module.exports = {
  NEWS_SORTS,
  createCountryNewsRun,
  getCountryDualVideoSignal,
  getCountryNewsDetail,
  getCountryNewsRun,
  listCountryDualVideoSignals,
  listCountryNews,
  parseCountryDualVideoQuery,
  parseCountryNewsQuery,
  validateNewsRunPayload
};

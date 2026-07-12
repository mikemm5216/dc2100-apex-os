// =========================================================
// COUNTRY NEWS API — Task 3.3D
//
// Route handlers for the Country News Traffic Radar. All
// user input is validated against allowlists and bound as
// SQL parameters; nothing is interpolated into SQL text.
// =========================================================

const {
  NEWS_RUN_LIMITS,
  normalizeNewsRunPayload
} = require("./country-query-catalog");

const {
  NEWS_CATEGORIES,
  CONFLICT_ARCHETYPES
} = require("./classification");

const { VEHICLE_WINDOW_DAYS } = require("./engine");

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

module.exports = {
  NEWS_SORTS,
  createCountryNewsRun,
  getCountryNewsDetail,
  getCountryNewsRun,
  listCountryNews,
  parseCountryNewsQuery,
  validateNewsRunPayload
};

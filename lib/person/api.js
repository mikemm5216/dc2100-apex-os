// =========================================================
// PERSON RADAR API — Task 3.3E
//
// Route handlers for the Vehicle-Linked Person Traffic
// Radar. All user input is validated against allowlists
// and bound as SQL parameters; nothing is interpolated
// into SQL text.
// =========================================================

const {
  PERSON_ROLES,
  RELATION_TYPES
} = require("./person-catalog");

const {
  PERSON_ATTENTION_ARCHETYPES
} = require("./metrics");

const {
  PERSON_RUN_LIMITS,
  normalizePersonRunPayload
} = require("./query-builder");

const {
  RELATIONSHIP_SCOPES,
  RESONANCE_TIERS
} = require("./resonance");

const {
  aliasMatchesNormalizedText,
  normalizePersonText
} = require("./normalization");

const {
  normalizePersonDirectVideoRunPayload
} = require("./person-direct-video-engine");

const WINDOW_HOURS = new Set([24, 72, 168, 720]);

const RELATIONSHIP_SCOPE_FILTERS = new Set(
  RELATIONSHIP_SCOPES
);

const RESONANCE_TIER_FILTERS = new Set([
  "ALL",
  ...Object.values(RESONANCE_TIERS)
]);

// Scope-keyed SQL fragments. Keys are validated against
// the RELATIONSHIP_SCOPES allowlist before lookup, so no
// user input ever reaches the SQL text.
const SCOPE_SCORE_SQL = {
  ONE_YEAR:
    "(pts.historical_resonance_scores ->> 'ONE_YEAR')::numeric",
  TEN_YEARS:
    "(pts.historical_resonance_scores ->> 'TEN_YEARS')::numeric",
  ALL_TIME:
    "(pts.historical_resonance_scores ->> 'ALL_TIME')::numeric"
};

const SCOPE_TIER_SQL = {
  ONE_YEAR:
    "pts.historical_resonance_tiers ->> 'ONE_YEAR'",
  TEN_YEARS:
    "pts.historical_resonance_tiers ->> 'TEN_YEARS'",
  ALL_TIME:
    "pts.historical_resonance_tiers ->> 'ALL_TIME'"
};

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

const ROLE_FILTERS = new Set([
  "ALL",
  ...PERSON_ROLES
]);

const RELATION_FILTERS = new Set([
  "ALL",
  ...RELATION_TYPES
]);

const ARCHETYPE_FILTERS = new Set([
  "ALL",
  ...PERSON_ATTENTION_ARCHETYPES
]);

const PERSON_SORTS = {
  traffic_score: `
    pts.traffic_score DESC,
    pts.vehicle_views_total DESC,
    pts.publisher_count DESC,
    pts.last_seen_at DESC,
    pts.id DESC
  `,

  vehicle_views: `
    pts.vehicle_views_total DESC,
    pts.traffic_score DESC,
    pts.id DESC
  `,

  news_coverage: `
    pts.news_coverage_score DESC,
    pts.traffic_score DESC,
    pts.id DESC
  `,

  recency: `
    pts.last_seen_at DESC,
    pts.traffic_score DESC,
    pts.id DESC
  `,

  publisher_count: `
    pts.publisher_count DESC,
    pts.traffic_score DESC,
    pts.id DESC
  `,

  transformation_potential: `
    pts.transformation_potential DESC,
    pts.traffic_score DESC,
    pts.id DESC
  `
};

// historical_resonance sorts by the SELECTED relationship
// scope, so its ORDER BY is built per request from the
// validated scope — never from raw input.
const PERSON_SORT_KEYS = new Set([
  ...Object.keys(PERSON_SORTS),
  "historical_resonance"
]);

function buildPersonOrderBy(options) {
  if (options.sort === "historical_resonance") {
    return `
      ${SCOPE_SCORE_SQL[options.relationshipScope]}
        DESC NULLS LAST,
      pts.traffic_score DESC,
      pts.vehicle_views_total DESC,
      pts.id DESC
    `;
  }

  return PERSON_SORTS[options.sort];
}

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
// POST /person-radar/run
// =========================================================

function validatePersonRunPayload(body) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    return validationError(
      "Request body must be a JSON object."
    );
  }

  if (body.max_people !== undefined) {
    if (
      !Number.isInteger(body.max_people) ||
      body.max_people <
        PERSON_RUN_LIMITS.MAX_PEOPLE.min ||
      body.max_people >
        PERSON_RUN_LIMITS.MAX_PEOPLE.max
    ) {
      return validationError(
        "max_people must be an integer from 1 to 30."
      );
    }
  }

  if (
    body.vehicle_window_days !== undefined &&
    !PERSON_RUN_LIMITS.VEHICLE_WINDOW_DAYS_ALLOWED.includes(
      body.vehicle_window_days
    )
  ) {
    return validationError(
      "vehicle_window_days must be 3, 7, 14, or 30."
    );
  }

  if (body.max_queries_per_person !== undefined) {
    if (
      !Number.isInteger(
        body.max_queries_per_person
      ) ||
      body.max_queries_per_person <
        PERSON_RUN_LIMITS.MAX_QUERIES_PER_PERSON
          .min ||
      body.max_queries_per_person >
        PERSON_RUN_LIMITS.MAX_QUERIES_PER_PERSON.max
    ) {
      return validationError(
        "max_queries_per_person must be an integer from 1 to 4."
      );
    }
  }

  if (body.max_items_per_query !== undefined) {
    if (
      !Number.isInteger(body.max_items_per_query) ||
      body.max_items_per_query <
        PERSON_RUN_LIMITS.MAX_ITEMS_PER_QUERY.min ||
      body.max_items_per_query >
        PERSON_RUN_LIMITS.MAX_ITEMS_PER_QUERY.max
    ) {
      return validationError(
        "max_items_per_query must be an integer from 5 to 50."
      );
    }
  }

  if (
    body.max_age_hours !== undefined &&
    !PERSON_RUN_LIMITS.MAX_AGE_HOURS_ALLOWED.includes(
      body.max_age_hours
    )
  ) {
    return validationError(
      "max_age_hours must be 24, 72, or 168."
    );
  }

  for (const [field, pattern] of [
    ["person_ids", /^[0-9]+$/],
    ["person_slugs", /^[a-z0-9-]+$/]
  ]) {
    const value = body[field];

    if (value === undefined || value === null) {
      continue;
    }

    if (
      !Array.isArray(value) ||
      value.length === 0
    ) {
      return validationError(
        `${field} must be null or a non-empty array.`
      );
    }

    if (
      value.length >
      PERSON_RUN_LIMITS.MAX_PERSON_SELECTORS
    ) {
      return validationError(
        `${field} can contain at most 30 entries.`
      );
    }

    const invalid = value.filter(
      item => !pattern.test(String(item).trim())
    );

    if (invalid.length > 0) {
      return validationError(
        `${field} contains invalid entries.`,
        { invalid_entries: invalid }
      );
    }
  }

  const normalized = normalizePersonRunPayload(body);

  return {
    value: {
      max_people: normalized.maxPeople,
      vehicle_window_days:
        normalized.vehicleWindowDays,
      max_queries_per_person:
        normalized.maxQueriesPerPerson,
      max_items_per_query:
        normalized.maxItemsPerQuery,
      max_age_hours: normalized.maxAgeHours,
      person_ids: normalized.personIds,
      person_slugs: normalized.personSlugs
    }
  };
}

async function createPersonRadarRun(pool, body) {
  const validation = validatePersonRunPayload(body);

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
      FROM person_radar_runs
      WHERE status IN ('QUEUED', 'RUNNING')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `
  );

  if (activeResult.rowCount > 0) {
    return response(409, {
      error: "PERSON_RADAR_RUN_ACTIVE",
      message:
        "A person radar run is already queued or running.",
      active_run: activeResult.rows[0]
    });
  }

  const insertResult = await pool.query(
    `
      INSERT INTO person_radar_runs (
        status,
        request_payload
      )
      VALUES (
        'QUEUED',
        $1::jsonb
      )
      RETURNING
        id,
        status,
        request_payload,
        person_count,
        created_at
    `,
    [JSON.stringify(requestPayload)]
  );

  return response(202, {
    data: insertResult.rows[0],
    message: "Person radar run queued successfully."
  });
}

// =========================================================
// GET /person-radar/runs/:id
// =========================================================

async function getPersonRadarRun(pool, runId) {
  const result = await pool.query(
    `
      SELECT
        id,
        status,
        request_payload,
        summary,

        person_count,
        completed_person_count,
        failed_person_count,

        query_count,
        succeeded_query_count,
        item_count,

        mention_inserted_count,
        mention_updated_count,
        signal_inserted_count,
        signal_updated_count,

        error_message,

        locked_by,
        locked_at,
        started_at,
        completed_at,

        created_at,
        updated_at

      FROM person_radar_runs

      WHERE id = $1
    `,
    [runId]
  );

  if (result.rowCount === 0) {
    return response(404, {
      error: "PERSON_RADAR_RUN_NOT_FOUND",
      message:
        `Person radar run ${runId} was not found.`
    });
  }

  return response(200, {
    data: result.rows[0]
  });
}

// =========================================================
// GET /person-radar
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

function parsePersonRadarQuery(searchParams) {
  const requestedWindow = Number(
    searchParams.get("window_hours") || 168
  );

  if (!WINDOW_HOURS.has(requestedWindow)) {
    return validationError(
      "window_hours must be 24, 72, 168, or 720."
    );
  }

  const roleCategory = (
    searchParams.get("role_category") || "ALL"
  ).toUpperCase();

  if (!ROLE_FILTERS.has(roleCategory)) {
    return validationError(
      "role_category is not a recognized person role."
    );
  }

  const relationType = (
    searchParams.get("relation_type") || "ALL"
  ).toUpperCase();

  if (!RELATION_FILTERS.has(relationType)) {
    return validationError(
      "relation_type is not a recognized relation type."
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

  const attentionArchetype = (
    searchParams.get("attention_archetype") || "ALL"
  ).toUpperCase();

  if (!ARCHETYPE_FILTERS.has(attentionArchetype)) {
    return validationError(
      "attention_archetype is not a recognized attention archetype."
    );
  }

  const relationshipScope = (
    searchParams.get("relationship_scope") ||
    "ALL_TIME"
  ).toUpperCase();

  if (
    !RELATIONSHIP_SCOPE_FILTERS.has(relationshipScope)
  ) {
    return validationError(
      "relationship_scope must be ONE_YEAR, TEN_YEARS, or ALL_TIME."
    );
  }

  const historicalResonanceTier = (
    searchParams.get("historical_resonance_tier") ||
    "ALL"
  ).toUpperCase();

  if (
    !RESONANCE_TIER_FILTERS.has(
      historicalResonanceTier
    )
  ) {
    return validationError(
      "historical_resonance_tier must be ALL, ICONIC, ESTABLISHED, RECOGNIZABLE, or NICHE."
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

  const vehicleBrand = (
    searchParams.get("vehicle_brand") || ""
  )
    .trim()
    .slice(0, 100);

  const vehicleModel = (
    searchParams.get("vehicle_model") || ""
  )
    .trim()
    .slice(0, 100);

  const sort =
    searchParams.get("sort") || "traffic_score";

  if (!PERSON_SORT_KEYS.has(sort)) {
    return validationError(
      "sort must be traffic_score, vehicle_views, news_coverage, recency, publisher_count, transformation_potential, or historical_resonance."
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
      roleCategory,
      relationType,
      vehicleBrand,
      vehicleModel,
      countryCode: rawCountryCode.toUpperCase(),
      trafficTier,
      transformationTier,
      attentionArchetype,
      relationshipScope,
      historicalResonanceTier,
      sort,
      limit: limitResult.value,
      offset: offsetResult.value,
      search
    }
  };
}

function buildPersonConditions(options) {
  const values = [options.windowHours];

  const conditions = [
    `
      pts.last_seen_at >=
        NOW() - make_interval(hours => $1::int)
    `
  ];

  if (options.roleCategory !== "ALL") {
    values.push(options.roleCategory);
    conditions.push(
      `p.role_category = $${values.length}`
    );
  }

  if (options.relationType !== "ALL") {
    values.push(options.relationType);
    conditions.push(
      `
        EXISTS (
          SELECT 1
          FROM vehicle_person_links vpl
          WHERE vpl.person_id = pts.person_id
            AND vpl.relation_type = $${values.length}
        )
      `
    );
  }

  if (options.vehicleBrand) {
    values.push(options.vehicleBrand);
    conditions.push(
      `
        EXISTS (
          SELECT 1
          FROM vehicle_person_links vpl
          WHERE vpl.person_id = pts.person_id
            AND vpl.vehicle_brand ILIKE
              $${values.length}
        )
      `
    );
  }

  if (options.vehicleModel) {
    values.push(options.vehicleModel);
    conditions.push(
      `
        EXISTS (
          SELECT 1
          FROM vehicle_person_links vpl
          WHERE vpl.person_id = pts.person_id
            AND vpl.vehicle_model ILIKE
              $${values.length}
        )
      `
    );
  }

  if (options.countryCode) {
    values.push(options.countryCode);
    conditions.push(`c.code = $${values.length}`);
  }

  if (options.trafficTier !== "ALL") {
    values.push(options.trafficTier);
    conditions.push(
      `pts.traffic_tier = $${values.length}`
    );
  }

  if (options.transformationTier !== "ALL") {
    values.push(options.transformationTier);
    conditions.push(
      `pts.transformation_tier = $${values.length}`
    );
  }

  if (options.attentionArchetype !== "ALL") {
    values.push(
      JSON.stringify([options.attentionArchetype])
    );
    conditions.push(
      `pts.attention_archetypes @> $${values.length}::jsonb`
    );
  }

  if (options.historicalResonanceTier !== "ALL") {
    values.push(options.historicalResonanceTier);
    conditions.push(
      `${
        SCOPE_TIER_SQL[options.relationshipScope]
      } = $${values.length}`
    );
  }

  if (options.search) {
    values.push(`%${options.search}%`);

    conditions.push(
      `
        (
          p.canonical_name ILIKE $${values.length}
          OR
          pts.representative_headline ILIKE
            $${values.length}
          OR
          pts.representative_source ILIKE
            $${values.length}
          OR
          EXISTS (
            SELECT 1
            FROM vehicle_person_links vpl
            WHERE vpl.person_id = pts.person_id
              AND (
                vpl.vehicle_brand ILIKE
                  $${values.length}
                OR
                vpl.vehicle_model ILIKE
                  $${values.length}
              )
          )
        )
      `
    );
  }

  return { values, conditions };
}

// Earliest PROVABLE observation date per person: the
// signal's own first_seen_at and the oldest persisted
// mention (its first_seen_at, or published_at when the
// publisher timestamp is older). Never a hardcoded
// project date, never a historical-traffic claim.
const PERSON_OBSERVATION_CTE = `
  person_observation AS (
    SELECT
      person_id,
      MIN(
        LEAST(
          first_seen_at,
          COALESCE(published_at, first_seen_at)
        )
      ) AS earliest_observed_at
    FROM person_traffic_mentions
    GROUP BY person_id
  )
`;

const PERSON_LINKS_CTE = `
  person_links AS (
    SELECT
      vpl.person_id,

      ARRAY_REMOVE(
        ARRAY_AGG(DISTINCT vpl.vehicle_brand),
        NULL
      ) AS linked_brands,

      ARRAY_REMOVE(
        ARRAY_AGG(DISTINCT vpl.vehicle_series),
        NULL
      ) AS linked_series,

      ARRAY_REMOVE(
        ARRAY_AGG(DISTINCT vpl.vehicle_model),
        NULL
      ) AS linked_models,

      ARRAY_AGG(DISTINCT vpl.relation_type)
        AS relation_types,

      MAX(vpl.link_confidence) AS link_confidence

    FROM vehicle_person_links vpl

    GROUP BY vpl.person_id
  )
`;

async function listPersonRadar(pool, searchParams) {
  const parsed = parsePersonRadarQuery(searchParams);

  if (parsed.error) {
    return parsed.error;
  }

  const options = parsed.value;

  const { values, conditions } =
    buildPersonConditions(options);

  values.push(options.limit);
  const limitIndex = values.length;

  values.push(options.offset);
  const offsetIndex = values.length;

  const listResult = await pool.query(
    `
      WITH ${PERSON_LINKS_CTE},
      ${PERSON_OBSERVATION_CTE}
      SELECT
        pts.id,
        pts.person_id,
        p.slug AS person_slug,
        p.canonical_name,
        p.role_category,
        c.code AS person_country_code,
        c.name AS person_country_name,

        COALESCE(
          pl.linked_brands,
          ARRAY[]::text[]
        ) AS linked_brands,
        COALESCE(
          pl.linked_series,
          ARRAY[]::text[]
        ) AS linked_series,
        COALESCE(
          pl.linked_models,
          ARRAY[]::text[]
        ) AS linked_models,
        COALESCE(
          pl.relation_types,
          ARRAY[]::text[]
        ) AS relation_types,
        pl.link_confidence,

        pts.traffic_tier,
        pts.traffic_score,

        pts.vehicle_attention_score,
        pts.news_coverage_score,

        pts.vehicle_signal_count,
        pts.qualified_vehicle_signal_count,
        pts.direct_vehicle_mention_count,
        pts.vehicle_views_total,
        pts.vehicle_views_max,

        pts.news_mention_count,
        pts.publisher_count,
        pts.query_count,
        pts.feed_rank_score,
        pts.age_hours,

        pts.attention_archetypes,
        pts.transformation_tier,
        pts.transformation_potential,

        pts.representative_headline,
        pts.representative_url,
        pts.representative_source,
        pts.representative_domain,

        ${
          SCOPE_SCORE_SQL[options.relationshipScope]
        } AS historical_resonance_score,
        ${
          SCOPE_TIER_SQL[options.relationshipScope]
        } AS historical_resonance_tier,
        pts.historical_resonance_scores,
        pts.historical_resonance_tiers,
        pts.primary_resonance_link_id,
        pts.resonance_version,
        pts.resonance_evidence,

        LEAST(
          pts.first_seen_at,
          po.earliest_observed_at
        ) AS traffic_observed_since,
        FALSE AS historical_traffic_claimed,

        pts.first_seen_at,
        pts.last_seen_at,

        pts.provider,
        pts.resolver_version,

        COUNT(*) OVER() AS total_count

      FROM person_traffic_signals pts

      JOIN people p
        ON p.id = pts.person_id

      LEFT JOIN countries c
        ON c.id = p.country_id

      LEFT JOIN person_links pl
        ON pl.person_id = pts.person_id

      LEFT JOIN person_observation po
        ON po.person_id = pts.person_id

      WHERE ${conditions.join("\nAND ")}

      ORDER BY ${buildPersonOrderBy(options)}

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

    return {
      ...record,
      relationship_scope: options.relationshipScope
    };
  });

  // Summary aggregates cover the WHOLE filtered window,
  // never just the visible page.
  const summaryResult = await pool.query(
    `
      WITH ${PERSON_LINKS_CTE},
      filtered AS (
        SELECT
          pts.id,
          pts.person_id,
          pts.traffic_tier,
          pts.transformation_tier,
          pts.vehicle_views_total,
          pts.vehicle_signal_count,
          pts.direct_vehicle_mention_count,
          pts.publisher_count,
          ${
            SCOPE_SCORE_SQL[options.relationshipScope]
          } AS selected_resonance_score,
          ${
            SCOPE_TIER_SQL[options.relationshipScope]
          } AS selected_resonance_tier
        FROM person_traffic_signals pts
        JOIN people p
          ON p.id = pts.person_id
        LEFT JOIN countries c
          ON c.id = p.country_id
        LEFT JOIN person_links pl
          ON pl.person_id = pts.person_id
        WHERE ${conditions.join("\nAND ")}
      )
      SELECT
        COUNT(*)::int AS visible_people,

        COUNT(*) FILTER (
          WHERE traffic_tier = 'BREAKOUT'
        )::int AS breakout,

        COUNT(*) FILTER (
          WHERE traffic_tier = 'ACTIVE'
        )::int AS active,

        COUNT(*) FILTER (
          WHERE traffic_tier = 'WATCH'
        )::int AS watch,

        COUNT(*) FILTER (
          WHERE traffic_tier = 'LOW_SIGNAL'
        )::int AS low_signal,

        COUNT(*) FILTER (
          WHERE transformation_tier = 'HIGH'
        )::int AS high_potential,

        COUNT(*) FILTER (
          WHERE transformation_tier = 'MEDIUM'
        )::int AS medium_potential,

        COUNT(*) FILTER (
          WHERE transformation_tier = 'LOW'
        )::int AS low_potential,

        COALESCE(
          SUM(vehicle_views_total),
          0
        )::bigint AS total_vehicle_views,

        COALESCE(
          SUM(vehicle_signal_count),
          0
        )::int AS total_vehicle_signals,

        COUNT(*) FILTER (
          WHERE direct_vehicle_mention_count > 0
        )::int AS direct_mention_people,

        COALESCE(
          SUM(publisher_count),
          0
        )::int AS news_publishers,

        COUNT(*) FILTER (
          WHERE selected_resonance_tier = 'ICONIC'
        )::int AS iconic,

        COUNT(*) FILTER (
          WHERE selected_resonance_tier =
            'ESTABLISHED'
        )::int AS established,

        COUNT(*) FILTER (
          WHERE selected_resonance_tier =
            'RECOGNIZABLE'
        )::int AS recognizable,

        COUNT(*) FILTER (
          WHERE selected_resonance_tier = 'NICHE'
        )::int AS niche,

        COUNT(*) FILTER (
          WHERE selected_resonance_score IS NULL
        )::int AS unscored,

        ROUND(
          AVG(selected_resonance_score),
          2
        ) AS average_historical_resonance,

        (
          SELECT COUNT(DISTINCT vpl.vehicle_brand)
          FROM vehicle_person_links vpl
          WHERE vpl.person_id IN (
            SELECT person_id FROM filtered
          )
            AND vpl.vehicle_brand IS NOT NULL
        )::int AS active_brands,

        (
          SELECT COUNT(DISTINCT vpl.vehicle_model)
          FROM vehicle_person_links vpl
          WHERE vpl.person_id IN (
            SELECT person_id FROM filtered
          )
            AND vpl.vehicle_model IS NOT NULL
        )::int AS active_models

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
      role_category: options.roleCategory,
      relation_type: options.relationType,
      vehicle_brand: options.vehicleBrand,
      vehicle_model: options.vehicleModel,
      country_code: options.countryCode,
      traffic_tier: options.trafficTier,
      transformation_tier:
        options.transformationTier,
      attention_archetype:
        options.attentionArchetype,
      relationship_scope:
        options.relationshipScope,
      historical_resonance_tier:
        options.historicalResonanceTier,
      sort: options.sort,
      q: options.search,
      limit: options.limit,
      offset: options.offset
    }
  });
}

// =========================================================
// GET /person-radar/:id
// =========================================================

async function getPersonRadarDetail(pool, signalId) {
  const signalResult = await pool.query(
    `
      SELECT
        pts.id,
        pts.person_id,
        p.slug AS person_slug,
        p.canonical_name,
        p.role_category,
        p.aliases AS person_aliases,
        p.metadata AS person_metadata,
        p.catalog_version,
        p.active AS person_active,
        c.code AS person_country_code,
        c.name AS person_country_name,

        pts.traffic_tier,
        pts.traffic_score,

        pts.vehicle_attention_score,
        pts.news_coverage_score,

        pts.vehicle_signal_count,
        pts.qualified_vehicle_signal_count,
        pts.direct_vehicle_mention_count,
        pts.vehicle_views_total,
        pts.vehicle_views_max,

        pts.news_mention_count,
        pts.publisher_count,
        pts.query_count,
        pts.feed_rank_score,
        pts.age_hours,

        pts.attention_archetypes,
        pts.transformation_tier,
        pts.transformation_potential,

        pts.representative_headline,
        pts.representative_url,
        pts.representative_source,
        pts.representative_domain,

        pts.historical_resonance_scores,
        pts.historical_resonance_tiers,
        pts.historical_resonance_score,
        pts.historical_resonance_tier,
        pts.primary_resonance_link_id,
        pts.resonance_version,
        pts.resonance_evidence,

        LEAST(
          pts.first_seen_at,
          (
            SELECT MIN(
              LEAST(
                ptm.first_seen_at,
                COALESCE(
                  ptm.published_at,
                  ptm.first_seen_at
                )
              )
            )
            FROM person_traffic_mentions ptm
            WHERE ptm.person_id = pts.person_id
          )
        ) AS traffic_observed_since,
        FALSE AS historical_traffic_claimed,

        pts.first_seen_at,
        pts.last_seen_at,

        pts.provider,
        pts.resolver_version,
        pts.raw_metadata,

        pts.created_at,
        pts.updated_at

      FROM person_traffic_signals pts

      JOIN people p
        ON p.id = pts.person_id

      LEFT JOIN countries c
        ON c.id = p.country_id

      WHERE pts.id = $1
    `,
    [signalId]
  );

  if (signalResult.rowCount === 0) {
    return response(404, {
      error: "PERSON_RADAR_NOT_FOUND",
      message:
        `Person traffic signal ${signalId} was not found.`
    });
  }

  const signal = signalResult.rows[0];

  const linksResult = await pool.query(
    `
      SELECT
        id,
        vehicle_id,
        vehicle_brand,
        vehicle_series,
        vehicle_model,
        relation_type,
        link_confidence,
        link_method,
        link_evidence,
        locked,

        evidence_horizon,
        iconic_association,
        legacy_association,
        recognition_weight,
        association_start_year,
        association_end_year,
        historical_resonance_score,
        historical_resonance_tier,
        resonance_evidence,
        resonance_version,
        resonance_locked,

        created_at,
        updated_at
      FROM vehicle_person_links
      WHERE person_id = $1
      ORDER BY
        link_confidence DESC NULLS LAST,
        id ASC
    `,
    [signal.person_id]
  );

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

        person_match_method,
        person_confidence,

        raw_metadata,
        first_seen_at,
        last_seen_at

      FROM person_traffic_mentions

      WHERE person_traffic_signal_id = $1

      ORDER BY
        published_at DESC NULLS LAST,
        feed_rank ASC NULLS LAST,
        id ASC
    `,
    [signalId]
  );

  return response(200, {
    data: {
      ...signal,
      // Detail always carries the full scope maps; the
      // top-level score/tier are the ALL_TIME defaults.
      relationship_scope: "ALL_TIME",
      vehicle_links: linksResult.rows,
      mentions: mentionsResult.rows
    }
  });
}

// =========================================================
// PERSON DUAL-VIDEO SIGNAL PACK
//
// A signal item is always ONE specific video, but a person
// can legitimately have TWO complementary single-video
// signals at once -- never a choice between one or the other:
//
//   person_association_video -- the highest-viewed video of a
//   vehicle this person is linked to (EXACT / MODEL / SERIES /
//   BRAND association). The video does not need to mention the
//   person by name; it proves WHY the person is relevant to
//   the vehicle and supplies vehicle footage/culture material.
//
//   person_direct_hook_video -- the highest-viewed video where
//   the person's canonical name or alias is directly present
//   in the title or channel title.
//
// Neither role ever uses SUM(views); each is its own single
// highest-viewed video. historical_resonance_score (already
// computed elsewhere) is carried as background context only
// and never substitutes for either video's actual views.
// =========================================================

const PERSON_DUAL_VIDEO_FORMAT_FILTERS = new Set([
  "SHORTS",
  "ALL"
]);

const PERSON_PACK_STATUSES = new Set([
  "ALL",
  "COMPLETE",
  "DIRECT_ONLY",
  "ASSOCIATION_ONLY",
  "NO_MATCH"
]);

// Cumulative history scope, mirroring resonance.js's
// ONE_YEAR ⊂ TEN_YEARS ⊂ ALL_TIME scopes -- but this filters
// candidate VIDEOS by published_at, never a resonance score.
const PERSON_DUAL_VIDEO_SCOPE_INTERVALS = {
  ONE_YEAR: "1 year",
  TEN_YEARS: "10 years"
  // ALL_TIME has no lower bound.
};

// Most-specific-first: a person can have several vehicle
// links; when more than one link matches the same signal,
// only the most specific level is kept for that signal.
const ASSOCIATION_LEVEL_RANK = {
  EXACT: 4,
  MODEL_ASSOCIATION: 3,
  SERIES_ASSOCIATION: 2,
  BRAND_ASSOCIATION: 1
};

function parsePersonDualVideoQuery(searchParams) {
  const historyScope = (
    searchParams.get("history_scope") || "ALL_TIME"
  ).toUpperCase();

  if (!RELATIONSHIP_SCOPE_FILTERS.has(historyScope)) {
    return validationError(
      "history_scope must be ONE_YEAR, TEN_YEARS, or ALL_TIME."
    );
  }

  const format = (
    searchParams.get("format") || "SHORTS"
  ).toUpperCase();

  if (!PERSON_DUAL_VIDEO_FORMAT_FILTERS.has(format)) {
    return validationError(
      "format must be SHORTS or ALL."
    );
  }

  const status = (
    searchParams.get("status") || "COMPLETE"
  ).toUpperCase();

  if (!PERSON_PACK_STATUSES.has(status)) {
    return validationError(
      "status must be ALL, COMPLETE, DIRECT_ONLY, ASSOCIATION_ONLY, or NO_MATCH."
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
      historyScope,
      format,
      status,
      limit: limitResult.value,
      offset: offsetResult.value
    }
  };
}

function personDualVideoConditions({
  historyScope,
  format
}) {
  const conditions = [`sig.views > 0`];

  if (format === "SHORTS") {
    conditions.push(`sig.is_short = TRUE`);
  }

  if (PERSON_DUAL_VIDEO_SCOPE_INTERVALS[historyScope]) {
    conditions.push(
      `sig.published_at >= NOW() - INTERVAL '${
        PERSON_DUAL_VIDEO_SCOPE_INTERVALS[historyScope]
      }'`
    );
  }

  return conditions;
}

// Every eligible (person, signal) association candidate,
// tagged with its match level. A plain JOIN (never LATERAL,
// never SUM) against vehicle_person_links -- reusing the
// existing relationship table exactly as it stands.
async function fetchPersonAssociationCandidates(
  pool,
  { historyScope, format }
) {
  const conditions = personDualVideoConditions({
    historyScope,
    format
  });

  const result = await pool.query(
    `
      SELECT
        vpl.person_id,
        vpl.id AS link_id,
        vpl.relation_type,
        vpl.link_confidence,
        vpl.link_evidence,
        vpl.vehicle_id AS link_vehicle_id,
        vpl.vehicle_brand AS link_vehicle_brand,
        vpl.vehicle_series AS link_vehicle_series,
        vpl.vehicle_model AS link_vehicle_model,

        sig.id AS signal_id,
        sig.external_id AS external_video_id,
        sig.title AS video_title,
        sig.url AS video_url,
        sig.thumbnail_url,
        sig.views AS video_views,
        sig.published_at,
        sig.channel_title,

        CASE
          WHEN vpl.vehicle_id IS NOT NULL
            AND sig.resolved_vehicle_id = vpl.vehicle_id
            THEN 'EXACT'
          WHEN vpl.vehicle_model IS NOT NULL
            AND sig.vehicle_model ILIKE vpl.vehicle_model
            AND sig.vehicle_brand ILIKE vpl.vehicle_brand
            THEN 'MODEL_ASSOCIATION'
          WHEN vpl.vehicle_series IS NOT NULL
            AND sig.vehicle_series ILIKE vpl.vehicle_series
            AND sig.vehicle_brand ILIKE vpl.vehicle_brand
            THEN 'SERIES_ASSOCIATION'
          WHEN vpl.vehicle_brand IS NOT NULL
            AND sig.vehicle_brand ILIKE vpl.vehicle_brand
            THEN 'BRAND_ASSOCIATION'
          ELSE NULL
        END AS association_level

      FROM vehicle_person_links vpl

      JOIN signals sig
        ON (
          (
            vpl.vehicle_id IS NOT NULL
            AND sig.resolved_vehicle_id = vpl.vehicle_id
          )
          OR (
            vpl.vehicle_model IS NOT NULL
            AND sig.vehicle_model ILIKE vpl.vehicle_model
            AND sig.vehicle_brand ILIKE vpl.vehicle_brand
          )
          OR (
            vpl.vehicle_series IS NOT NULL
            AND sig.vehicle_series ILIKE vpl.vehicle_series
            AND sig.vehicle_brand ILIKE vpl.vehicle_brand
          )
          OR (
            vpl.vehicle_brand IS NOT NULL
            AND sig.vehicle_brand ILIKE vpl.vehicle_brand
          )
        )

      WHERE
        sig.entity_resolution_status IN (
          'RESOLVED',
          'BRAND_ONLY'
        )
        AND ${conditions.join("\nAND ")}
    `
  );

  return result.rows.filter(row => row.association_level);
}

// Keeps only the most specific association_level per
// (person_id, signal_id) pair, then the single highest-viewed
// candidate per person (never a SUM).
function pickTopAssociationPerPerson(candidates) {
  const bestPerPersonSignal = new Map();

  for (const row of candidates) {
    const key = `${row.person_id}:${row.signal_id}`;
    const existing = bestPerPersonSignal.get(key);

    if (
      !existing ||
      ASSOCIATION_LEVEL_RANK[row.association_level] >
        ASSOCIATION_LEVEL_RANK[existing.association_level]
    ) {
      bestPerPersonSignal.set(key, row);
    }
  }

  const bestPerPerson = new Map();

  for (const row of bestPerPersonSignal.values()) {
    const key = String(row.person_id);
    const existing = bestPerPerson.get(key);

    if (!existing) {
      bestPerPerson.set(key, row);
      continue;
    }

    const rowViews = Number(row.video_views);
    const existingViews = Number(existing.video_views);

    if (rowViews > existingViews) {
      bestPerPerson.set(key, row);
      continue;
    }

    if (rowViews === existingViews) {
      const rowPublished = row.published_at
        ? new Date(row.published_at).getTime()
        : 0;
      const existingPublished = existing.published_at
        ? new Date(existing.published_at).getTime()
        : 0;

      if (rowPublished > existingPublished) {
        bestPerPerson.set(key, row);
      }
    }
  }

  return bestPerPerson;
}

// Reads the most recently computed person_direct_hook_video
// per person -- whatever the last completed POST
// /person-dual-video-signals/run persisted. Pure SELECT: no
// YouTube calls, no writes, no scan of the first N ingested
// signals.
async function fetchLatestPersonDirectVideos(
  pool,
  { historyScope, format }
) {
  const conditions = [];
  const values = [];

  const scopeInterval =
    PERSON_DUAL_VIDEO_SCOPE_INTERVALS[historyScope];

  if (scopeInterval) {
    conditions.push(
      `
        (
          pdvs.published_at IS NULL OR
          pdvs.published_at >=
            NOW() - INTERVAL '${scopeInterval}'
        )
      `
    );
  }

  if (format === "SHORTS") {
    conditions.push(
      `
        pdvs.duration_seconds IS NOT NULL AND
        pdvs.duration_seconds > 0 AND
        pdvs.duration_seconds <= 180
      `
    );
  }

  const whereClause =
    conditions.length > 0
      ? `WHERE ${conditions.join("\nAND ")}`
      : "";

  const result = await pool.query(
    `
      SELECT DISTINCT ON (pdvs.person_id)
        pdvs.person_id,
        pdvs.signal_id,
        pdvs.external_video_id,
        pdvs.video_title,
        pdvs.video_url,
        pdvs.thumbnail_url,
        pdvs.video_views,
        pdvs.published_at,
        pdvs.channel_id,
        pdvs.channel_title,
        pdvs.duration_seconds,
        pdvs.description_excerpt,
        pdvs.tags,
        pdvs.search_query,
        pdvs.matched_alias,
        pdvs.direct_mention_field,
        pdvs.evidence,
        pdvs.computed_at
      FROM person_direct_video_signals pdvs
      ${whereClause}
      ORDER BY
        pdvs.person_id ASC,
        pdvs.computed_at DESC,
        pdvs.id DESC
    `,
    values
  );

  const byPersonId = new Map();

  for (const row of result.rows) {
    byPersonId.set(String(row.person_id), row);
  }

  return byPersonId;
}

function buildAssociationVideoPayload(row, { person, directMentionTerms }) {
  if (!row) {
    return null;
  }

  const normalizedTitle = normalizePersonText(
    row.video_title
  );
  const normalizedChannel = normalizePersonText(
    row.channel_title
  );

  const directMention = directMentionTerms.some(
    term =>
      aliasMatchesNormalizedText(normalizedTitle, term) ||
      aliasMatchesNormalizedText(normalizedChannel, term)
  );

  return {
    signal_id: String(row.signal_id),
    external_video_id: row.external_video_id,
    video_title: row.video_title,
    video_url: row.video_url,
    thumbnail_url: row.thumbnail_url,
    video_views: row.video_views,
    published_at: row.published_at,
    channel_title: row.channel_title,

    vehicle_id: row.link_vehicle_id
      ? String(row.link_vehicle_id)
      : null,
    vehicle_brand: row.link_vehicle_brand,
    vehicle_series: row.link_vehicle_series,
    vehicle_model: row.link_vehicle_model,

    vehicle_person_link_id: String(row.link_id),
    relation_type: row.relation_type,
    association_level: row.association_level,
    link_confidence: row.link_confidence,
    association_evidence: row.link_evidence,

    direct_mention: directMention,
    association_only: true
  };
}

function buildDirectHookVideoPayload(row) {
  if (!row) {
    return null;
  }

  return {
    signal_id: row.signal_id ? String(row.signal_id) : null,
    external_video_id: row.external_video_id,
    video_title: row.video_title,
    video_url: row.video_url,
    thumbnail_url: row.thumbnail_url,
    video_views: row.video_views,
    published_at: row.published_at,
    channel_id: row.channel_id,
    channel_title: row.channel_title,
    duration_seconds: row.duration_seconds,
    description_excerpt: row.description_excerpt,
    tags: Array.isArray(row.tags) ? row.tags : [],
    search_query: row.search_query,

    matched_alias: row.matched_alias,
    direct_mention_field: row.direct_mention_field,
    direct_mention: true,

    evidence: row.evidence || {}
  };
}

function personPackStatus({
  associationVideo,
  directHookVideo
}) {
  if (associationVideo && directHookVideo) {
    return "COMPLETE";
  }

  if (directHookVideo) {
    return "DIRECT_ONLY";
  }

  if (associationVideo) {
    return "ASSOCIATION_ONLY";
  }

  return "NO_MATCH";
}

async function buildPersonDualVideoPacks(
  pool,
  { historyScope, format }
) {
  const peopleResult = await pool.query(
    `
      SELECT id, slug, canonical_name, aliases, role_category
      FROM people
      WHERE active = TRUE
    `
  );

  const people = peopleResult.rows;

  if (people.length === 0) {
    return [];
  }

  const [
    associationCandidates,
    directHookByPersonId
  ] = await Promise.all([
    fetchPersonAssociationCandidates(pool, {
      historyScope,
      format
    }),
    fetchLatestPersonDirectVideos(pool, {
      historyScope,
      format
    })
  ]);

  const topAssociationByPerson =
    pickTopAssociationPerPerson(associationCandidates);

  const packs = [];

  for (const person of people) {
    const personId = String(person.id);

    const aliasTerms = [
      person.canonical_name,
      ...(Array.isArray(person.aliases)
        ? person.aliases
        : [])
    ].filter(Boolean);

    const associationRow =
      topAssociationByPerson.get(personId) || null;

    const associationVideo = buildAssociationVideoPayload(
      associationRow,
      { person, directMentionTerms: aliasTerms }
    );

    const directHookRow =
      directHookByPersonId.get(personId) || null;

    const directHookVideo =
      buildDirectHookVideoPayload(directHookRow);

    const status = personPackStatus({
      associationVideo,
      directHookVideo
    });

    const sharedSignal = Boolean(
      associationVideo &&
        directHookVideo &&
        associationVideo.signal_id ===
          directHookVideo.signal_id
    );

    packs.push({
      person_id: personId,
      person_slug: person.slug,
      canonical_name: person.canonical_name,
      role_category: person.role_category,
      status,
      shared_signal: sharedSignal,
      person_association_video: associationVideo,
      person_direct_hook_video: directHookVideo
    });
  }

  return packs;
}

// Default sort: COMPLETE packs first, then by the direct
// hook video's views (the more visible signal), falling back
// to the association video's views. Neither role ever ranks
// by historical_resonance_score or an aggregate.
function sortPersonDualVideoPacks(packs) {
  return [...packs].sort((a, b) => {
    const statusRank = status =>
      status === "COMPLETE" ? 0 : 1;

    if (statusRank(a.status) !== statusRank(b.status)) {
      return statusRank(a.status) - statusRank(b.status);
    }

    const aDirectViews = Number(
      a.person_direct_hook_video?.video_views ?? -1
    );
    const bDirectViews = Number(
      b.person_direct_hook_video?.video_views ?? -1
    );

    if (aDirectViews !== bDirectViews) {
      return bDirectViews - aDirectViews;
    }

    const aAssocViews = Number(
      a.person_association_video?.video_views ?? -1
    );
    const bAssocViews = Number(
      b.person_association_video?.video_views ?? -1
    );

    if (aAssocViews !== bAssocViews) {
      return bAssocViews - aAssocViews;
    }

    return a.canonical_name.localeCompare(b.canonical_name);
  });
}

async function listPersonDualVideoSignals(
  pool,
  searchParams
) {
  const parsed = parsePersonDualVideoQuery(searchParams);

  if (parsed.error) {
    return parsed.error;
  }

  const options = parsed.value;

  const allPacks = await buildPersonDualVideoPacks(pool, {
    historyScope: options.historyScope,
    format: options.format
  });

  const filteredPacks =
    options.status === "ALL"
      ? allPacks
      : allPacks.filter(
          pack => pack.status === options.status
        );

  const sortedPacks = sortPersonDualVideoPacks(filteredPacks);

  const pagedPacks = sortedPacks.slice(
    options.offset,
    options.offset + options.limit
  );

  return response(200, {
    data: pagedPacks,
    count: pagedPacks.length,
    total_count: sortedPacks.length,
    filters: {
      history_scope: options.historyScope,
      format: options.format,
      status: options.status,
      limit: options.limit,
      offset: options.offset
    }
  });
}

async function getPersonDualVideoSignal(
  pool,
  personId,
  searchParams
) {
  const parsed = parsePersonDualVideoQuery(searchParams);

  if (parsed.error) {
    return parsed.error;
  }

  const options = parsed.value;

  const personResult = await pool.query(
    `
      SELECT id, slug, canonical_name, role_category
      FROM people
      WHERE id = $1
    `,
    [personId]
  );

  if (personResult.rowCount === 0) {
    return response(404, {
      error: "PERSON_NOT_FOUND",
      message: `Person ${personId} was not found.`
    });
  }

  const allPacks = await buildPersonDualVideoPacks(pool, {
    historyScope: options.historyScope,
    format: options.format
  });

  const pack = allPacks.find(
    item => item.person_id === String(personId)
  ) || {
    person_id: String(personId),
    person_slug: personResult.rows[0].slug,
    canonical_name: personResult.rows[0].canonical_name,
    role_category: personResult.rows[0].role_category,
    status: "NO_MATCH",
    shared_signal: false,
    person_association_video: null,
    person_direct_hook_video: null
  };

  return response(200, { data: pack });
}

// =========================================================
// POST /person-dual-video-signals/run
//
// The ONLY entry point that performs YouTube search and
// writes person_direct_video_signals. GET never does either.
// =========================================================

function validatePersonDirectVideoRunPayload(body) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    return validationError(
      "Request body must be a JSON object."
    );
  }

  if (
    body.history_scope !== undefined &&
    !RELATIONSHIP_SCOPE_FILTERS.has(
      String(body.history_scope || "").toUpperCase()
    )
  ) {
    return validationError(
      "history_scope must be ONE_YEAR, TEN_YEARS, or ALL_TIME."
    );
  }

  if (
    body.format !== undefined &&
    !PERSON_DUAL_VIDEO_FORMAT_FILTERS.has(
      String(body.format || "").toUpperCase()
    )
  ) {
    return validationError(
      "format must be SHORTS or ALL."
    );
  }

  if (
    body.max_entities !== undefined &&
    (
      !Number.isInteger(body.max_entities) ||
      body.max_entities < 1 ||
      body.max_entities > 50
    )
  ) {
    return validationError(
      "max_entities must be an integer from 1 to 50."
    );
  }

  if (body.station_run_key !== undefined &&
    !/^[A-Za-z0-9:_-]{1,100}$/.test(String(body.station_run_key))) {
    return validationError("station_run_key contains invalid characters.");
  }

  const normalized = normalizePersonDirectVideoRunPayload(
    body
  );

  return {
    value: {
      history_scope: normalized.historyScope,
      format: normalized.format,
      max_entities: normalized.maxEntities,
      station_run_key: normalized.stationRunKey
    }
  };
}

async function createPersonDirectVideoRun(pool, body) {
  if (String(body?.content_mode || "STATION_GUEST").toUpperCase() === "LOCKED_CANON") {
    return response(409, { error: "LOCKED_CANON_SEARCH_DISABLED" });
  }
  const validation =
    validatePersonDirectVideoRunPayload(body);

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
      FROM person_direct_video_signal_runs
      WHERE status IN ('QUEUED', 'RUNNING')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `
  );

  if (activeResult.rowCount > 0) {
    return response(409, {
      error: "PERSON_DIRECT_VIDEO_RUN_ACTIVE",
      message:
        "A person direct video run is already queued or running.",
      active_run: activeResult.rows[0]
    });
  }

  const insertResult = await pool.query(
    `
      INSERT INTO person_direct_video_signal_runs (
        status,
        request_payload
      )
      VALUES (
        'QUEUED',
        $1::jsonb
      )
      RETURNING
        id,
        status,
        request_payload,
        created_at
    `,
    [JSON.stringify(requestPayload)]
  );

  return response(202, {
    data: insertResult.rows[0],
    message: "Person direct video run queued successfully."
  });
}

// =========================================================
// GET /person-dual-video-signals/runs/:id
// =========================================================

async function getPersonDirectVideoRun(pool, runId) {
  const result = await pool.query(
    `
      SELECT
        id,
        status,
        request_payload,
        summary,

        entities_attempted,
        search_query_count,
        videos_discovered_count,
        videos_evaluated_count,
        videos_matched_count,
        signals_inserted_count,
        signals_updated_count,
        no_match_entity_count,
        quota_units_estimated,

        error_message,

        locked_by,
        locked_at,

        started_at,
        completed_at,

        created_at,
        updated_at

      FROM person_direct_video_signal_runs

      WHERE id = $1
    `,
    [runId]
  );

  if (result.rowCount === 0) {
    return response(404, {
      error: "PERSON_DIRECT_VIDEO_RUN_NOT_FOUND",
      message:
        `Person direct video run ${runId} was not found.`
    });
  }

  return response(200, {
    data: result.rows[0]
  });
}

module.exports = {
  PERSON_SORTS,
  PERSON_SORT_KEYS,
  createPersonDirectVideoRun,
  createPersonRadarRun,
  getPersonDirectVideoRun,
  getPersonDualVideoSignal,
  getPersonRadarDetail,
  getPersonRadarRun,
  listPersonDualVideoSignals,
  listPersonRadar,
  parsePersonDualVideoQuery,
  parsePersonRadarQuery,
  validatePersonDirectVideoRunPayload,
  validatePersonRunPayload
};

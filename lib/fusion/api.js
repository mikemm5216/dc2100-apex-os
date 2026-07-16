// =========================================================
// VEHICLE-CENTERED SIGNAL FUSION API — Task 3.3F
//
// Route handlers for Fusion runs and candidates. All user
// input is validated against allowlists and bound as SQL
// parameters; nothing is interpolated into SQL text.
//
// A vehicle may have multiple candidates (different news/
// person evidence combinations), so there is no single
// vehicle-keyed detail endpoint — only candidate-keyed and
// run-keyed endpoints, with vehicle_id supported as a list
// filter.
// =========================================================

const {
  FUSION_RUN_LIMITS,
  normalizeFusionRunPayload
} = require("./engine");

const PERSON_LINK_TIER_FILTERS = new Set([
  "ALL",
  "EXACT_VEHICLE",
  "SAME_SERIES",
  "SAME_BRAND",
  "NO_PERSON_SIGNAL"
]);

const COMPLETENESS_FILTERS = new Set([
  "ALL",
  "TRUE",
  "FALSE"
]);

const FUSION_SORTS = {
  fusion_score: `
    vfc.fusion_score DESC,
    vfc.vehicle_traffic_score DESC,
    vfc.id DESC
  `,

  vehicle_views: `
    vfc.vehicle_views_total DESC,
    vfc.fusion_score DESC,
    vfc.id DESC
  `,

  transformation_potential: `
    vfc.transformation_potential_score DESC,
    vfc.fusion_score DESC,
    vfc.id DESC
  `,

  recency: `
    vfc.created_at DESC,
    vfc.fusion_score DESC,
    vfc.id DESC
  `
};

const FUSION_SORT_KEYS = new Set(
  Object.keys(FUSION_SORTS)
);

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

// =========================================================
// POST /fusion/run
// =========================================================

function validateFusionRunPayload(body) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    return validationError(
      "Request body must be a JSON object."
    );
  }

  if (body.max_vehicles !== undefined) {
    if (
      !Number.isInteger(body.max_vehicles) ||
      body.max_vehicles <
        FUSION_RUN_LIMITS.MAX_VEHICLES.min ||
      body.max_vehicles >
        FUSION_RUN_LIMITS.MAX_VEHICLES.max
    ) {
      return validationError(
        "max_vehicles must be an integer from 1 to 100."
      );
    }
  }

  if (
    body.vehicle_window_days !== undefined &&
    !FUSION_RUN_LIMITS.VEHICLE_WINDOW_DAYS_ALLOWED.includes(
      body.vehicle_window_days
    )
  ) {
    return validationError(
      "vehicle_window_days must be 3, 7, 14, or 30."
    );
  }

  if (
    body.news_window_hours !== undefined &&
    !FUSION_RUN_LIMITS.NEWS_WINDOW_HOURS_ALLOWED.includes(
      body.news_window_hours
    )
  ) {
    return validationError(
      "news_window_hours must be 24, 72, or 168."
    );
  }

  if (body.max_news_per_vehicle !== undefined) {
    if (
      !Number.isInteger(body.max_news_per_vehicle) ||
      body.max_news_per_vehicle <
        FUSION_RUN_LIMITS.MAX_NEWS_PER_VEHICLE.min ||
      body.max_news_per_vehicle >
        FUSION_RUN_LIMITS.MAX_NEWS_PER_VEHICLE.max
    ) {
      return validationError(
        "max_news_per_vehicle must be an integer from 1 to 5."
      );
    }
  }

  if (body.max_people_per_vehicle !== undefined) {
    if (
      !Number.isInteger(
        body.max_people_per_vehicle
      ) ||
      body.max_people_per_vehicle <
        FUSION_RUN_LIMITS.MAX_PEOPLE_PER_VEHICLE.min ||
      body.max_people_per_vehicle >
        FUSION_RUN_LIMITS.MAX_PEOPLE_PER_VEHICLE.max
    ) {
      return validationError(
        "max_people_per_vehicle must be an integer from 1 to 5."
      );
    }
  }

  if (
    body.vehicle_ids !== undefined &&
    body.vehicle_ids !== null
  ) {
    if (
      !Array.isArray(body.vehicle_ids) ||
      body.vehicle_ids.length === 0
    ) {
      return validationError(
        "vehicle_ids must be null or a non-empty array."
      );
    }

    if (
      body.vehicle_ids.length >
      FUSION_RUN_LIMITS.MAX_VEHICLE_SELECTORS
    ) {
      return validationError(
        "vehicle_ids can contain at most 100 entries."
      );
    }

    const invalid = body.vehicle_ids.filter(
      item => !/^[0-9]+$/.test(String(item).trim())
    );

    if (invalid.length > 0) {
      return validationError(
        "vehicle_ids contains invalid entries.",
        { invalid_entries: invalid }
      );
    }
  }

  if (
    body.pair_run_id !== undefined &&
    !/^[1-9][0-9]*$/.test(String(body.pair_run_id))
  ) {
    return validationError(
      "pair_run_id must be a positive integer identifier."
    );
  }

  const normalized = normalizeFusionRunPayload(body);

  return {
    value: {
      max_vehicles: normalized.maxVehicles,
      vehicle_window_days: normalized.vehicleWindowDays,
      news_window_hours: normalized.newsWindowHours,
      max_news_per_vehicle: normalized.maxNewsPerVehicle,
      max_people_per_vehicle:
        normalized.maxPeoplePerVehicle,
      vehicle_ids: normalized.vehicleIds,
      pair_run_id: normalized.pairRunId
    }
  };
}

async function createFusionRun(pool, body) {
  const validation = validateFusionRunPayload(body);

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
      FROM fusion_runs
      WHERE status IN ('QUEUED', 'RUNNING')
      ORDER BY created_at ASC, id ASC
      LIMIT 1
    `
  );

  if (activeResult.rowCount > 0) {
    return response(409, {
      error: "FUSION_RUN_ACTIVE",
      message:
        "A fusion run is already queued or running.",
      active_run: activeResult.rows[0]
    });
  }

  const insertResult = await pool.query(
    `
      INSERT INTO fusion_runs (
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
        vehicle_count,
        created_at
    `,
    [JSON.stringify(requestPayload)]
  );

  return response(202, {
    data: insertResult.rows[0],
    message: "Fusion run queued successfully."
  });
}

// =========================================================
// GET /fusion/runs/:id
// =========================================================

async function getFusionRun(pool, runId) {
  const result = await pool.query(
    `
      SELECT
        id,
        status,
        request_payload,
        summary,

        vehicle_count,
        completed_vehicle_count,
        skipped_vehicle_count,
        candidate_count,
        candidate_inserted_count,
        candidate_updated_count,

        error_message,

        superseded_by_run_id,
        superseded_at,

        locked_by,
        locked_at,
        started_at,
        completed_at,

        created_at,
        updated_at

      FROM fusion_runs

      WHERE id = $1
    `,
    [runId]
  );

  if (result.rowCount === 0) {
    return response(404, {
      error: "FUSION_RUN_NOT_FOUND",
      message: `Fusion run ${runId} was not found.`
    });
  }

  return response(200, {
    data: result.rows[0]
  });
}

// =========================================================
// GET /fusion/runs
// =========================================================

async function listFusionRuns(pool, searchParams) {
  const limitResult = parseIntegerParameter(
    searchParams.get("limit"),
    {
      fieldName: "limit",
      minimum: 1,
      maximum: 100,
      fallback: 20
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

  const result = await pool.query(
    `
      SELECT
        id,
        status,
        request_payload,
        summary,

        vehicle_count,
        completed_vehicle_count,
        skipped_vehicle_count,
        candidate_count,
        candidate_inserted_count,
        candidate_updated_count,

        error_message,

        superseded_by_run_id,
        superseded_at,

        locked_by,
        locked_at,
        started_at,
        completed_at,

        created_at,
        updated_at,

        COUNT(*) OVER() AS total_count

      FROM fusion_runs

      ORDER BY created_at DESC, id DESC

      LIMIT $1
      OFFSET $2
    `,
    [limitResult.value, offsetResult.value]
  );

  const totalCount =
    result.rows.length > 0
      ? Number(result.rows[0].total_count)
      : 0;

  const data = result.rows.map(row => {
    const { total_count, ...record } = row;
    return record;
  });

  return response(200, {
    data,
    count: data.length,
    total_count: totalCount
  });
}

// =========================================================
// GET /fusion/candidates
// =========================================================

async function resolveDefaultRunId(pool) {
  const result = await pool.query(
    `
      SELECT id
      FROM fusion_runs
      WHERE status = 'COMPLETED'
      ORDER BY completed_at DESC, id DESC
      LIMIT 1
    `
  );

  return result.rowCount > 0 ? result.rows[0].id : null;
}

async function parseFusionCandidatesQuery(
  pool,
  searchParams
) {
  let runId = null;

  const rawRunId = searchParams.get("run_id");

  if (rawRunId) {
    if (!/^[0-9]+$/.test(rawRunId)) {
      return validationError(
        "run_id must be a positive integer."
      );
    }

    runId = rawRunId;
  } else {
    runId = await resolveDefaultRunId(pool);
  }

  const rawVehicleId = searchParams.get("vehicle_id");

  if (rawVehicleId && !/^[0-9]+$/.test(rawVehicleId)) {
    return validationError(
      "vehicle_id must be a positive integer."
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

  const personLinkTier = (
    searchParams.get("person_link_tier") || "ALL"
  ).toUpperCase();

  if (!PERSON_LINK_TIER_FILTERS.has(personLinkTier)) {
    return validationError(
      "person_link_tier must be ALL, EXACT_VEHICLE, SAME_SERIES, SAME_BRAND, or NO_PERSON_SIGNAL."
    );
  }

  const isComplete = (
    searchParams.get("is_complete") || "ALL"
  ).toUpperCase();

  if (!COMPLETENESS_FILTERS.has(isComplete)) {
    return validationError(
      "is_complete must be ALL, TRUE, or FALSE."
    );
  }

  const sort =
    searchParams.get("sort") || "fusion_score";

  if (!FUSION_SORT_KEYS.has(sort)) {
    return validationError(
      "sort must be fusion_score, vehicle_views, transformation_potential, or recency."
    );
  }

  const search = (searchParams.get("q") || "")
    .trim()
    .slice(0, 200);

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

  return {
    value: {
      runId,
      vehicleId: rawVehicleId || null,
      countryCode: rawCountryCode.toUpperCase(),
      personLinkTier,
      isComplete,
      sort,
      search,
      limit: limitResult.value,
      offset: offsetResult.value
    }
  };
}

function buildFusionConditions(options) {
  const values = [options.runId];

  const conditions = ["vfc.run_id = $1"];

  if (options.vehicleId) {
    values.push(options.vehicleId);
    conditions.push(
      `vfc.vehicle_id = $${values.length}`
    );
  }

  if (options.countryCode) {
    values.push(options.countryCode);
    conditions.push(`c.code = $${values.length}`);
  }

  if (options.personLinkTier === "NO_PERSON_SIGNAL") {
    conditions.push("vfc.person_id IS NULL");
  } else if (options.personLinkTier !== "ALL") {
    values.push(options.personLinkTier);
    conditions.push(
      `vfc.person_link_tier = $${values.length}`
    );
  }

  if (options.isComplete !== "ALL") {
    values.push(options.isComplete === "TRUE");
    conditions.push(
      `vfc.is_complete = $${values.length}`
    );
  }

  if (options.search) {
    values.push(`%${options.search}%`);
    conditions.push(
      `
        (
          v.code ILIKE $${values.length}
          OR v.name ILIKE $${values.length}
        )
      `
    );
  }

  return { values, conditions };
}

const CANDIDATE_SELECT_FIELDS = `
  vfc.id,
  vfc.run_id,
  vfc.vehicle_id,
  v.code AS vehicle_code,
  v.name AS vehicle_name,
  vfc.country_id,
  c.code AS country_code,
  c.name AS country_name,

  vfc.country_news_signal_id,
  cns.title AS country_news_title,
  cns.representative_url AS country_news_url,

  vfc.person_id,
  p.slug AS person_slug,
  p.canonical_name AS person_canonical_name,
  vfc.vehicle_person_link_id,
  vfc.person_link_tier,

  vfc.qualified_vehicle_signal_count,
  vfc.vehicle_views_total,
  vfc.vehicle_views_max,
  vfc.vehicle_viral_tier,
  vfc.vehicle_traffic_score,

  vfc.country_news_category,
  vfc.country_news_conflict_archetypes,
  vfc.country_news_traffic_proxy_score,

  vfc.person_current_traffic_score,

  vfc.person_historical_resonance_score,
  vfc.person_historical_resonance_tier,
  vfc.relationship_scope,
  vfc.vehicle_person_link_confidence_score,

  vfc.transformation_potential_score,

  vfc.fusion_score,
  vfc.fusion_version,
  vfc.missing_signals,
  vfc.is_complete,

  vfc.created_at,
  vfc.updated_at
`;

const CANDIDATE_FROM_CLAUSE = `
  FROM vehicle_fusion_candidates vfc
  JOIN vehicles v ON v.id = vfc.vehicle_id
  LEFT JOIN countries c ON c.id = vfc.country_id
  LEFT JOIN country_news_signals cns
    ON cns.id = vfc.country_news_signal_id
  LEFT JOIN people p ON p.id = vfc.person_id
`;

async function listFusionCandidates(pool, searchParams) {
  const parsed = await parseFusionCandidatesQuery(
    pool,
    searchParams
  );

  if (parsed.error) {
    return parsed.error;
  }

  const options = parsed.value;

  if (!options.runId) {
    return response(200, {
      data: [],
      count: 0,
      total_count: 0,
      summary: {},
      filters: {
        run_id: null,
        vehicle_id: options.vehicleId,
        country_code: options.countryCode,
        person_link_tier: options.personLinkTier,
        is_complete: options.isComplete,
        sort: options.sort,
        q: options.search,
        limit: options.limit,
        offset: options.offset
      }
    });
  }

  const { values, conditions } =
    buildFusionConditions(options);

  values.push(options.limit);
  const limitIndex = values.length;

  values.push(options.offset);
  const offsetIndex = values.length;

  const listResult = await pool.query(
    `
      SELECT
        ${CANDIDATE_SELECT_FIELDS},
        COUNT(*) OVER() AS total_count
      ${CANDIDATE_FROM_CLAUSE}
      WHERE ${conditions.join("\nAND ")}
      ORDER BY ${FUSION_SORTS[options.sort]}
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

  const summaryResult = await pool.query(
    `
      SELECT
        COUNT(*)::int AS candidate_count,
        COUNT(DISTINCT vfc.vehicle_id)::int
          AS distinct_vehicle_count,
        COUNT(*) FILTER (
          WHERE vfc.is_complete
        )::int AS complete_count,
        COUNT(*) FILTER (
          WHERE NOT vfc.is_complete
        )::int AS incomplete_count,
        COUNT(*) FILTER (
          WHERE vfc.person_link_tier = 'EXACT_VEHICLE'
        )::int AS exact_vehicle_count,
        COUNT(*) FILTER (
          WHERE vfc.person_link_tier = 'SAME_SERIES'
        )::int AS same_series_count,
        COUNT(*) FILTER (
          WHERE vfc.person_link_tier = 'SAME_BRAND'
        )::int AS same_brand_count,
        COUNT(*) FILTER (
          WHERE vfc.person_id IS NULL
        )::int AS no_person_signal_count,
        ROUND(AVG(vfc.fusion_score), 2)
          AS average_fusion_score
      ${CANDIDATE_FROM_CLAUSE}
      WHERE ${conditions.join("\nAND ")}
    `,
    values.slice(0, values.length - 2)
  );

  return response(200, {
    data,
    count: data.length,
    total_count: totalCount,
    summary: summaryResult.rows[0] || {},
    filters: {
      run_id: options.runId,
      vehicle_id: options.vehicleId,
      country_code: options.countryCode,
      person_link_tier: options.personLinkTier,
      is_complete: options.isComplete,
      sort: options.sort,
      q: options.search,
      limit: options.limit,
      offset: options.offset
    }
  });
}

// =========================================================
// GET /fusion/candidates/:id
// =========================================================

async function getFusionCandidateDetail(pool, candidateId) {
  const result = await pool.query(
    `
      SELECT
        ${CANDIDATE_SELECT_FIELDS},
        vfc.fusion_evidence
      ${CANDIDATE_FROM_CLAUSE}
      WHERE vfc.id = $1
    `,
    [candidateId]
  );

  if (result.rowCount === 0) {
    return response(404, {
      error: "FUSION_CANDIDATE_NOT_FOUND",
      message: `Fusion candidate ${candidateId} was not found.`
    });
  }

  return response(200, {
    data: result.rows[0]
  });
}

module.exports = {
  FUSION_SORT_KEYS,
  FUSION_SORTS,
  createFusionRun,
  getFusionCandidateDetail,
  getFusionRun,
  listFusionCandidates,
  listFusionRuns,
  validateFusionRunPayload
};

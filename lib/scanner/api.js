const {
  SCAN_MODES,
  normalizeRunPayload
} = require("./engine");

const {
  VEHICLE_TYPES
} = require("./vehicle-catalog");

const {
  VEHICLE_ACTIONS
} = require("./entity-resolver");

const AGE_WINDOWS = new Set([
  3,
  7,
  14,
  30
]);

const SCAN_MODE_FILTERS = new Set(SCAN_MODES);

const SIGNAL_VIEWS = new Set([
  "top100",
  "qualified",
  "top30"
]);

const DURATION_BUCKETS = new Set([
  "ALL",
  "UNDER_10",
  "10_TO_20",
  "20_TO_40",
  "41_TO_60",
  "61_TO_180"
]);

const DURATION_BUCKET_CONDITIONS = {
  UNDER_10: `
    sig.duration_seconds IS NOT NULL
    AND sig.duration_seconds < 10
  `,

  "10_TO_20": `
    sig.duration_seconds BETWEEN 10 AND 20
  `,

  "20_TO_40": `
    sig.duration_seconds BETWEEN 21 AND 40
  `,

  "41_TO_60": `
    sig.duration_seconds BETWEEN 41 AND 60
  `,

  "61_TO_180": `
    sig.duration_seconds BETWEEN 61 AND 180
  `
};

const VIRAL_TIER_FILTERS = new Set([
  "ALL",
  "PROVEN",
  "RISING",
  "WATCH",
  "UNQUALIFIED"
]);

const SHORT_FORMAT_FILTERS = new Set([
  "ALL",
  "CLASSIC_SHORT",
  "EXTENDED_SHORT",
  "NOT_SHORT"
]);

const ENTITY_STATUS_FILTERS = new Set([
  "ALL",
  "RESOLVED",
  "BRAND_ONLY",
  "AMBIGUOUS",
  "UNRESOLVED",
  "NOT_APPLICABLE"
]);

const VEHICLE_TYPE_FILTERS = new Set([
  "ALL",
  ...VEHICLE_TYPES
]);

const VEHICLE_ACTION_FILTERS = new Set([
  "ALL",
  ...VEHICLE_ACTIONS
]);

const HAS_VEHICLE_FILTERS = new Set([
  "ALL",
  "TRUE",
  "FALSE"
]);

// Actual Views First: views is the default sort and
// rank_score never drives the default ordering.
const SIGNAL_SORTS = {
  views: `
    sig.views DESC,
    sig.views_per_day DESC NULLS LAST,
    sig.published_at DESC NULLS LAST,
    sig.id DESC
  `,

  views_per_day: `
    sig.views_per_day DESC NULLS LAST,
    sig.views DESC,
    sig.id DESC
  `,

  views_per_hour: `
    sig.views_per_hour DESC NULLS LAST,
    sig.views DESC,
    sig.id DESC
  `,

  growth_velocity: `
    sig.growth_velocity DESC NULLS LAST,
    sig.views DESC,
    sig.id DESC
  `,

  recency: `
    sig.published_at DESC NULLS LAST,
    sig.views DESC,
    sig.id DESC
  `,

  rank_score: `
    sig.rank_score DESC NULLS LAST,
    sig.views DESC,
    sig.id DESC
  `
};

function response(
  statusCode,
  payload
) {
  return {
    statusCode,
    payload
  };
}

function validationError(
  message,
  details = {}
) {
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

function validateScannerRunPayload(
  body
) {
  if (
    body === null ||
    Array.isArray(body) ||
    typeof body !== "object"
  ) {
    return validationError(
      "Request body must be a JSON object."
    );
  }

  if (body.source_ids !== undefined) {
    if (
      !Array.isArray(body.source_ids) ||
      body.source_ids.length === 0
    ) {
      return validationError(
        "source_ids must be a non-empty array."
      );
    }

    if (body.source_ids.length > 100) {
      return validationError(
        "source_ids can contain at most 100 IDs."
      );
    }

    const invalidIds =
      body.source_ids.filter(value => {
        const normalized =
          String(value).trim();

        return !/^[0-9]+$/.test(
          normalized
        );
      });

    if (invalidIds.length > 0) {
      return validationError(
        "source_ids must contain numeric IDs only."
      );
    }
  }

  if (
    body.max_results_per_source !==
    undefined
  ) {
    if (
      !Number.isInteger(
        body.max_results_per_source
      ) ||
      body.max_results_per_source < 1 ||
      body.max_results_per_source > 50
    ) {
      return validationError(
        "max_results_per_source must be an integer from 1 to 50."
      );
    }
  }

  if (
    body.max_age_days !== undefined &&
    !AGE_WINDOWS.has(
      body.max_age_days
    )
  ) {
    return validationError(
      "max_age_days must be 3, 7, 14, or 30."
    );
  }

  if (
    body.force_refresh_channels !==
      undefined &&
    typeof body.force_refresh_channels !==
      "boolean"
  ) {
    return validationError(
      "force_refresh_channels must be a boolean."
    );
  }

  if (
    body.scan_mode !== undefined &&
    !SCAN_MODE_FILTERS.has(body.scan_mode)
  ) {
    return validationError(
      "scan_mode must be CURRENT or HISTORICAL."
    );
  }

  if (
    body.max_pages_per_source !==
    undefined
  ) {
    if (
      !Number.isInteger(
        body.max_pages_per_source
      ) ||
      body.max_pages_per_source < 1 ||
      body.max_pages_per_source > 200
    ) {
      return validationError(
        "max_pages_per_source must be an integer from 1 to 200."
      );
    }
  }

  const normalized =
    normalizeRunPayload(body);

  return {
    value: {
      source_ids:
        normalized.sourceIds,

      max_results_per_source:
        normalized.maxResultsPerSource,

      max_age_days:
        normalized.maxAgeDays,

      force_refresh_channels:
        normalized.forceRefreshChannels,

      scan_mode:
        normalized.scanMode,

      max_pages_per_source:
        normalized.maxPagesPerSource
    }
  };
}

async function createScannerRun(
  pool,
  body
) {
  const validation =
    validateScannerRunPayload(body);

  if (validation.error) {
    return validation.error;
  }

  const requestPayload =
    validation.value;

  const activeResult =
    await pool.query(
      `
        SELECT
          id,
          status,
          created_at,
          started_at
        FROM scanner_runs
        WHERE status IN (
          'QUEUED',
          'RUNNING'
        )
        ORDER BY
          created_at ASC,
          id ASC
        LIMIT 1
      `
    );

  if (activeResult.rowCount > 0) {
    return response(
      409,
      {
        error: "SCANNER_RUN_ACTIVE",

        message:
          "A scanner run is already queued or running.",

        active_run:
          activeResult.rows[0]
      }
    );
  }

  let sourceCount = 0;

  if (requestPayload.source_ids) {
    const sourceResult =
      await pool.query(
        `
          SELECT id
          FROM sources
          WHERE enabled = TRUE
            AND LOWER(platform) =
              'youtube'
            AND id = ANY(
              $1::bigint[]
            )
          ORDER BY id
        `,
        [
          requestPayload.source_ids
        ]
      );

    const foundIds = new Set(
      sourceResult.rows.map(
        row => String(row.id)
      )
    );

    const missingIds =
      requestPayload.source_ids.filter(
        sourceId =>
          !foundIds.has(
            String(sourceId)
          )
      );

    if (missingIds.length > 0) {
      return response(
        400,
        {
          error:
            "INVALID_SOURCE_SELECTION",

          message:
            "One or more sources do not exist, are disabled, or are not YouTube sources.",

          invalid_source_ids:
            missingIds
        }
      );
    }

    sourceCount =
      sourceResult.rowCount;
  } else {
    const countResult =
      await pool.query(
        `
          SELECT COUNT(*)::int AS count
          FROM sources
          WHERE enabled = TRUE
            AND LOWER(platform) =
              'youtube'
        `
      );

    sourceCount =
      countResult.rows[0].count;
  }

  if (sourceCount === 0) {
    return response(
      409,
      {
        error:
          "NO_SCANNABLE_SOURCES",

        message:
          "No enabled YouTube sources are available."
      }
    );
  }

  const insertResult =
    await pool.query(
      `
        INSERT INTO scanner_runs (
          status,
          request_payload,
          source_count
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
          source_count,
          created_at
      `,
      [
        JSON.stringify(
          requestPayload
        ),
        sourceCount
      ]
    );

  return response(
    202,
    {
      data:
        insertResult.rows[0],

      message:
        "Scanner run queued successfully."
    }
  );
}

async function getScannerRun(
  pool,
  runId
) {
  const result = await pool.query(
    `
      SELECT
        id,
        status,
        request_payload,
        summary,

        source_count,
        resolved_source_count,
        failed_source_count,

        video_count,
        inserted_count,
        updated_count,
        qualified_count,

        quota_units_estimated,

        error_message,

        locked_by,
        locked_at,

        started_at,
        completed_at,

        created_at,
        updated_at

      FROM scanner_runs

      WHERE id = $1
    `,
    [runId]
  );

  if (result.rowCount === 0) {
    return response(
      404,
      {
        error:
          "SCANNER_RUN_NOT_FOUND",

        message:
          `Scanner run ${runId} was not found.`
      }
    );
  }

  return response(
    200,
    {
      data:
        result.rows[0]
    }
  );
}

function parseIntegerParameter(
  value,
  {
    fieldName,
    minimum,
    maximum,
    fallback
  }
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return {
      value: fallback
    };
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

  return {
    value: parsed
  };
}

function parseSignalQuery(
  searchParams
) {
  const view =
    searchParams.get("view") ||
    "top100";

  if (!SIGNAL_VIEWS.has(view)) {
    return validationError(
      "view must be top100, qualified, or top30."
    );
  }

  const requestedAgeWindow =
    Number(
      searchParams.get(
        "window_days"
      ) || 14
    );

  if (
    !AGE_WINDOWS.has(
      requestedAgeWindow
    )
  ) {
    return validationError(
      "window_days must be 3, 7, 14, or 30."
    );
  }

  const durationBucket =
    (
      searchParams.get(
        "duration_bucket"
      ) || "ALL"
    ).toUpperCase();

  if (
    !DURATION_BUCKETS.has(
      durationBucket
    )
  ) {
    return validationError(
      "duration_bucket must be ALL, UNDER_10, 10_TO_20, 20_TO_40, 41_TO_60, or 61_TO_180."
    );
  }

  const rawShortsOnly =
    searchParams.get("shorts_only");

  if (
    rawShortsOnly !== null &&
    rawShortsOnly !== "true" &&
    rawShortsOnly !== "false"
  ) {
    return validationError(
      "shorts_only must be true or false."
    );
  }

  const shortsOnly =
    rawShortsOnly === null
      ? true
      : rawShortsOnly === "true";

  const viralTier =
    (
      searchParams.get("viral_tier") ||
      "ALL"
    ).toUpperCase();

  if (
    !VIRAL_TIER_FILTERS.has(viralTier)
  ) {
    return validationError(
      "viral_tier must be ALL, PROVEN, RISING, WATCH, or UNQUALIFIED."
    );
  }

  const shortFormat =
    (
      searchParams.get("short_format") ||
      "ALL"
    ).toUpperCase();

  if (
    !SHORT_FORMAT_FILTERS.has(
      shortFormat
    )
  ) {
    return validationError(
      "short_format must be ALL, CLASSIC_SHORT, EXTENDED_SHORT, or NOT_SHORT."
    );
  }

  const sort =
    searchParams.get("sort") ||
    "views";

  if (!SIGNAL_SORTS[sort]) {
    return validationError(
      "sort must be views, views_per_day, views_per_hour, growth_velocity, recency, or rank_score."
    );
  }

  const limitResult =
    parseIntegerParameter(
      searchParams.get("limit"),
      {
        fieldName: "limit",
        minimum: 1,
        maximum: 100,
        fallback:
          view === "top30"
            ? 30
            : 100
      }
    );

  if (limitResult.error) {
    return validationError(
      limitResult.error
    );
  }

  const offsetResult =
    parseIntegerParameter(
      searchParams.get("offset"),
      {
        fieldName: "offset",
        minimum: 0,
        maximum: 10000,
        fallback: 0
      }
    );

  if (offsetResult.error) {
    return validationError(
      offsetResult.error
    );
  }

  const sourceId =
    searchParams.get("source_id");

  if (
    sourceId !== null &&
    !/^[0-9]+$/.test(sourceId)
  ) {
    return validationError(
      "source_id must be numeric."
    );
  }

  const search =
    (
      searchParams.get("q") || ""
    )
      .trim()
      .slice(0, 200);

  const entityStatus =
    (
      searchParams.get("entity_status") ||
      "ALL"
    ).toUpperCase();

  if (
    !ENTITY_STATUS_FILTERS.has(
      entityStatus
    )
  ) {
    return validationError(
      "entity_status must be ALL, RESOLVED, BRAND_ONLY, AMBIGUOUS, UNRESOLVED, or NOT_APPLICABLE."
    );
  }

  const vehicleType =
    (
      searchParams.get("vehicle_type") ||
      "ALL"
    ).toUpperCase();

  if (
    !VEHICLE_TYPE_FILTERS.has(
      vehicleType
    )
  ) {
    return validationError(
      "vehicle_type is not a recognized vehicle type."
    );
  }

  const vehicleAction =
    (
      searchParams.get("vehicle_action") ||
      "ALL"
    ).toUpperCase();

  if (
    !VEHICLE_ACTION_FILTERS.has(
      vehicleAction
    )
  ) {
    return validationError(
      "vehicle_action is not a recognized vehicle action."
    );
  }

  const hasVehicle =
    (
      searchParams.get("has_vehicle") ||
      "ALL"
    ).toUpperCase();

  if (
    !HAS_VEHICLE_FILTERS.has(hasVehicle)
  ) {
    return validationError(
      "has_vehicle must be ALL, true, or false."
    );
  }

  const vehicleBrand =
    (
      searchParams.get("vehicle_brand") ||
      ""
    )
      .trim()
      .slice(0, 100);

  const rawCountryCode =
    (
      searchParams.get("country_code") ||
      ""
    ).trim();

  if (
    rawCountryCode !== "" &&
    !/^[A-Za-z]{2}$/.test(rawCountryCode)
  ) {
    return validationError(
      "country_code must be a 2-letter ISO 3166-1 alpha-2 code."
    );
  }

  const countryCode =
    rawCountryCode.toUpperCase();

  return {
    value: {
      view,
      windowDays:
        requestedAgeWindow,
      durationBucket,
      shortsOnly,
      viralTier,
      shortFormat,
      entityStatus,
      vehicleType,
      vehicleAction,
      hasVehicle,
      vehicleBrand,
      countryCode,
      sort,
      limit:
        view === "top30"
          ? Math.min(
              limitResult.value,
              30
            )
          : limitResult.value,
      offset:
        offsetResult.value,
      sourceId,
      search,

      // Qualified and Top 30 may only contain
      // PROVEN and RISING signals.
      qualifiedOnly:
        view === "qualified" ||
        view === "top30"
    }
  };
}

async function listSignals(
  pool,
  searchParams
) {
  const parsed =
    parseSignalQuery(
      searchParams
    );

  if (parsed.error) {
    return parsed.error;
  }

  const options = parsed.value;

  const values = [
    options.windowDays
  ];

  const conditions = [
    `
      sig.published_at >=
        NOW() -
        make_interval(
          days => $1::int
        )
    `
  ];

  if (options.qualifiedOnly) {
    conditions.push(
      "sig.qualified = TRUE"
    );

    conditions.push(
      `
        sig.viral_tier IN (
          'PROVEN',
          'RISING'
        )
      `
    );
  }

  if (options.shortsOnly) {
    conditions.push(
      "sig.is_short = TRUE"
    );
  }

  if (options.viralTier !== "ALL") {
    values.push(options.viralTier);

    conditions.push(
      `
        sig.viral_tier =
          $${values.length}
      `
    );
  }

  if (options.shortFormat !== "ALL") {
    values.push(options.shortFormat);

    conditions.push(
      `
        sig.short_format =
          $${values.length}
      `
    );
  }

  if (
    options.durationBucket !==
    "ALL"
  ) {
    conditions.push(
      DURATION_BUCKET_CONDITIONS[
        options.durationBucket
      ]
    );
  }

  if (options.entityStatus !== "ALL") {
    values.push(options.entityStatus);

    conditions.push(
      `
        sig.entity_resolution_status =
          $${values.length}
      `
    );
  }

  if (options.vehicleType !== "ALL") {
    values.push(options.vehicleType);

    conditions.push(
      `
        sig.vehicle_type =
          $${values.length}
      `
    );
  }

  if (options.vehicleAction !== "ALL") {
    values.push(options.vehicleAction);

    conditions.push(
      `
        sig.vehicle_action =
          $${values.length}
      `
    );
  }

  if (options.hasVehicle === "TRUE") {
    conditions.push(
      "sig.vehicle_brand IS NOT NULL"
    );
  } else if (
    options.hasVehicle === "FALSE"
  ) {
    conditions.push(
      "sig.vehicle_brand IS NULL"
    );
  }

  if (options.vehicleBrand) {
    values.push(options.vehicleBrand);

    conditions.push(
      `
        LOWER(sig.vehicle_brand) =
          LOWER($${values.length})
      `
    );
  }

  if (options.countryCode) {
    values.push(options.countryCode);

    conditions.push(
      `
        vc.code =
          $${values.length}
      `
    );
  }

  if (options.sourceId) {
    values.push(
      options.sourceId
    );

    conditions.push(
      `
        sig.source_id =
          $${values.length}
      `
    );
  }

  if (options.search) {
    values.push(
      `%${options.search}%`
    );

    conditions.push(
      `
        (
          sig.title ILIKE
            $${values.length}
          OR
          sig.channel_title ILIKE
            $${values.length}
          OR
          src.name ILIKE
            $${values.length}
        )
      `
    );
  }

  values.push(options.limit);
  const limitIndex =
    values.length;

  values.push(options.offset);
  const offsetIndex =
    values.length;

  const result = await pool.query(
    `
      SELECT
        sig.id,
        sig.source_id,
        sig.external_id,

        sig.title,
        sig.url,

        sig.channel_id,
        sig.channel_title,
        sig.thumbnail_url,

        sig.published_at,
        sig.duration_seconds,

        sig.views,
        sig.views_per_day,
        sig.views_per_hour,
        sig.age_hours,
        sig.growth_velocity,

        sig.is_short,
        sig.short_format,
        sig.short_rejection_reason,
        sig.viral_tier,

        sig.qualified,
        sig.rank_score,

        sig.vehicle_brand,
        sig.vehicle_series,
        sig.vehicle_model,
        sig.vehicle_type,
        sig.vehicle_action,
        sig.conflict_keywords,

        sig.entity_resolution_status,
        sig.entity_confidence,
        sig.entity_match_method,
        sig.entity_resolver_version,
        sig.entity_locked,

        sig.resolved_vehicle_id,
        veh.code AS resolved_vehicle_code,
        veh.name AS resolved_vehicle_name,

        sig.resolved_country_id,
        vc.code AS resolved_country_code,
        vc.name AS resolved_country_name,

        sig.raw_metrics,
        sig.last_scanned_at,

        src.name AS source_name,
        src.priority AS source_priority,

        co.code AS source_country_code,

        COUNT(*) OVER()
          AS total_count

      FROM signals sig

      LEFT JOIN sources src
        ON src.id =
          sig.source_id

      LEFT JOIN countries co
        ON co.id =
          src.country_id

      LEFT JOIN vehicles veh
        ON veh.id =
          sig.resolved_vehicle_id

      LEFT JOIN countries vc
        ON vc.id =
          sig.resolved_country_id

      WHERE
        ${conditions.join(
          "\nAND "
        )}

      ORDER BY
        ${SIGNAL_SORTS[
          options.sort
        ]}

      LIMIT $${limitIndex}
      OFFSET $${offsetIndex}
    `,
    values
  );

  const totalCount =
    result.rows.length > 0
      ? Number(
          result.rows[0]
            .total_count
        )
      : 0;

  const data =
    result.rows.map(row => {
      const {
        total_count,
        ...signal
      } = row;

      return signal;
    });

  return response(
    200,
    {
      data,
      count: data.length,
      total_count: totalCount,

      filters: {
        view:
          options.view,

        window_days:
          options.windowDays,

        duration_bucket:
          options.durationBucket,

        shorts_only:
          options.shortsOnly,

        viral_tier:
          options.viralTier,

        short_format:
          options.shortFormat,

        entity_status:
          options.entityStatus,

        vehicle_type:
          options.vehicleType,

        vehicle_action:
          options.vehicleAction,

        has_vehicle:
          options.hasVehicle,

        vehicle_brand:
          options.vehicleBrand,

        country_code:
          options.countryCode,

        sort:
          options.sort,

        source_id:
          options.sourceId,

        q:
          options.search,

        limit:
          options.limit,

        offset:
          options.offset
      }
    }
  );
}

async function getSignal(
  pool,
  signalId
) {
  const signalResult =
    await pool.query(
      `
        SELECT
          sig.id,
          sig.source_id,
          sig.external_id,

          sig.title,
          sig.url,

          sig.channel_id,
          sig.channel_title,
          sig.thumbnail_url,

          sig.published_at,
          sig.duration_seconds,

          sig.views,
          sig.views_per_day,
          sig.views_per_hour,
          sig.age_hours,
          sig.growth_velocity,

          sig.is_short,
          sig.short_format,
          sig.short_rejection_reason,
          sig.viral_tier,

          sig.qualified,
          sig.rank_score,

          sig.vehicle_brand,
          sig.vehicle_series,
          sig.vehicle_model,
          sig.vehicle_type,
          sig.vehicle_action,
          sig.conflict_keywords,

          sig.entity_resolution_status,
          sig.entity_confidence,
          sig.entity_match_method,
          sig.entity_evidence,
          sig.entity_resolver_version,
          sig.entity_locked,

          sig.resolved_vehicle_id,
          veh.code AS resolved_vehicle_code,
          veh.name AS resolved_vehicle_name,

          sig.resolved_country_id,
          vc.code AS resolved_country_code,
          vc.name AS resolved_country_name,

          sig.raw_metrics,
          sig.last_scanned_at,

          sig.created_at,
          sig.updated_at,

          src.name AS source_name,
          src.url AS source_url,
          src.category AS source_category,
          src.priority AS source_priority,

          co.code AS source_country_code,
          co.name AS source_country_name

        FROM signals sig

        LEFT JOIN sources src
          ON src.id =
            sig.source_id

        LEFT JOIN countries co
          ON co.id =
            src.country_id

        LEFT JOIN vehicles veh
          ON veh.id =
            sig.resolved_vehicle_id

        LEFT JOIN countries vc
          ON vc.id =
            sig.resolved_country_id

        WHERE sig.id = $1
      `,
      [signalId]
    );

  if (signalResult.rowCount === 0) {
    return response(
      404,
      {
        error:
          "SIGNAL_NOT_FOUND",

        message:
          `Signal ${signalId} was not found.`
      }
    );
  }

  const snapshotResult =
    await pool.query(
      `
        SELECT
          id,
          views,
          raw_metrics,
          captured_at

        FROM signal_metric_snapshots

        WHERE signal_id = $1

        ORDER BY
          captured_at DESC,
          id DESC

        LIMIT 20
      `,
      [signalId]
    );

  const contentResult =
    await pool.query(
      `
        SELECT
          content_id,
          title,
          status,
          priority,
          created_at,
          updated_at

        FROM contents

        WHERE signal_id = $1

        ORDER BY
          created_at DESC,
          id DESC
      `,
      [signalId]
    );

  return response(
    200,
    {
      data: {
        ...signalResult.rows[0],

        metric_snapshots:
          snapshotResult.rows,

        contents:
          contentResult.rows
      }
    }
  );
}

// =========================================================
// VEHICLE HISTORICAL TOP 10
//
// Distinct-vehicle ranking of ACTUAL historical views, built
// straight from `signals` -- no fusion_score, no rank_score,
// no growth velocity. Structurally mirrors Person Radar's
// relationship_scope pattern (ONE_YEAR ⊂ TEN_YEARS ⊂ ALL_TIME).
// =========================================================

const HISTORY_SCOPES = new Set([
  "ONE_YEAR",
  "TEN_YEARS",
  "ALL_TIME"
]);

const HISTORY_SCOPE_INTERVALS = {
  ONE_YEAR: "1 year",
  TEN_YEARS: "10 years"
  // ALL_TIME has no lower bound.
};

const HISTORICAL_FORMAT_FILTERS = new Set([
  "SHORTS",
  "ALL"
]);

const HISTORICAL_SORTS = {
  historical_views: `
    va.historical_views_total DESC,
    va.max_video_views DESC,
    va.signal_count DESC,
    veh.id ASC
  `,

  max_video_views: `
    va.max_video_views DESC,
    va.historical_views_total DESC,
    va.signal_count DESC,
    veh.id ASC
  `,

  signal_count: `
    va.signal_count DESC,
    va.historical_views_total DESC,
    va.max_video_views DESC,
    veh.id ASC
  `
};

function parseVehicleHistoricalRankingQuery(
  searchParams
) {
  const historyScope = (
    searchParams.get("history_scope") ||
    "ALL_TIME"
  ).toUpperCase();

  if (!HISTORY_SCOPES.has(historyScope)) {
    return validationError(
      "history_scope must be ONE_YEAR, TEN_YEARS, or ALL_TIME."
    );
  }

  const format = (
    searchParams.get("format") || "SHORTS"
  ).toUpperCase();

  if (!HISTORICAL_FORMAT_FILTERS.has(format)) {
    return validationError(
      "format must be SHORTS or ALL."
    );
  }

  const sort =
    searchParams.get("sort") ||
    "historical_views";

  if (!HISTORICAL_SORTS[sort]) {
    return validationError(
      "sort must be historical_views, max_video_views, or signal_count."
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
      sort,
      limit: limitResult.value,
      offset: offsetResult.value
    }
  };
}

// The most recently COMPLETED historical scanner run tells
// the ranking API (and the dashboard) whether ALL_TIME is
// actually complete, or only a partial history. A scanner
// run that never finished, or was truncated by the page cap,
// must never be read back as a complete ALL_TIME ranking.
async function getLatestHistoricalScanSummary(pool) {
  const result = await pool.query(
    `
      SELECT
        summary,
        completed_at
      FROM scanner_runs
      WHERE status = 'COMPLETED'
        AND request_payload ->> 'scan_mode' = 'HISTORICAL'
      ORDER BY completed_at DESC, id DESC
      LIMIT 1
    `
  );

  const run = result.rows[0];
  const summary = run?.summary || {};

  return {
    history_complete:
      summary.history_complete === true,
    pages_scanned:
      summary.pages_scanned ?? null,
    truncated_sources:
      summary.truncated_sources ?? [],
    oldest_video_published_at:
      summary.oldest_video_published_at ?? null,
    newest_video_published_at:
      summary.newest_video_published_at ?? null,
    scan_completed_at:
      run?.completed_at ?? null
  };
}

// Shared eligibility conditions for both the ranked list and
// the per-vehicle evidence detail: a resolved, RESOLVED-status
// signal with actual views and a canonical vehicle record
// (enforced by the INNER JOIN to vehicles).
function buildHistoricalConditions({
  historyScope,
  format
}) {
  const conditions = [
    `sig.entity_resolution_status = 'RESOLVED'`,
    `sig.resolved_vehicle_id IS NOT NULL`,
    `sig.views > 0`
  ];

  if (format === "SHORTS") {
    conditions.push(`sig.is_short = TRUE`);
  }

  if (HISTORY_SCOPE_INTERVALS[historyScope]) {
    conditions.push(
      `sig.published_at >= NOW() - INTERVAL '${HISTORY_SCOPE_INTERVALS[historyScope]}'`
    );
  }

  return conditions;
}

async function listVehicleHistoricalRanking(
  pool,
  searchParams
) {
  const parsed = parseVehicleHistoricalRankingQuery(
    searchParams
  );

  if (parsed.error) {
    return parsed.error;
  }

  const options = parsed.value;

  const conditions = buildHistoricalConditions(
    options
  );

  const filteredSignalsCte = `
    filtered_signals AS (
      SELECT
        sig.id,
        sig.resolved_vehicle_id,
        sig.views,
        sig.published_at,
        sig.source_id,
        sig.title,
        sig.url
      FROM signals sig
      WHERE ${conditions.join("\nAND ")}
    )
  `;

  const listResult = await pool.query(
    `
      WITH ${filteredSignalsCte},
      vehicle_agg AS (
        SELECT
          resolved_vehicle_id AS vehicle_id,
          SUM(views) AS historical_views_total,
          MAX(views) AS max_video_views,
          COUNT(DISTINCT id) AS signal_count,
          COUNT(DISTINCT source_id) AS source_count,
          MIN(published_at) AS earliest_published_at,
          MAX(published_at) AS latest_published_at
        FROM filtered_signals
        GROUP BY resolved_vehicle_id
      ),
      representative AS (
        SELECT DISTINCT ON (resolved_vehicle_id)
          resolved_vehicle_id AS vehicle_id,
          id AS representative_signal_id,
          title AS representative_video_title,
          url AS representative_video_url,
          views AS representative_video_views
        FROM filtered_signals
        ORDER BY
          resolved_vehicle_id ASC,
          views DESC,
          id ASC
      )
      SELECT
        veh.id AS vehicle_id,
        veh.code AS vehicle_code,
        veh.name AS vehicle_name,
        veh.manufacturer,

        va.historical_views_total,
        va.max_video_views,
        va.signal_count,
        va.source_count,
        va.earliest_published_at,
        va.latest_published_at,

        rep.representative_signal_id,
        rep.representative_video_title,
        rep.representative_video_url,
        rep.representative_video_views

      FROM vehicle_agg va

      JOIN vehicles veh
        ON veh.id = va.vehicle_id

      JOIN representative rep
        ON rep.vehicle_id = va.vehicle_id

      ORDER BY ${HISTORICAL_SORTS[options.sort]}

      LIMIT $1
      OFFSET $2
    `,
    [options.limit, options.offset]
  );

  // Distinct-vehicle count over the WHOLE filtered set, never
  // just the visible page -- deliberately a second query
  // instead of COUNT(*) OVER() so total_count stays correct
  // even though this endpoint paginates the GROUP BY result,
  // not the raw signal rows.
  const totalCountResult = await pool.query(
    `
      WITH ${filteredSignalsCte}
      SELECT
        COUNT(DISTINCT resolved_vehicle_id)::int
          AS total_count
      FROM filtered_signals
    `
  );

  const totalCount = Number(
    totalCountResult.rows[0]?.total_count || 0
  );

  const scanSummary =
    await getLatestHistoricalScanSummary(pool);

  const data = listResult.rows.map(
    (row, index) => {
      return {
        rank: options.offset + index + 1,
        ...row,
        history_scope: options.historyScope,
        format: options.format,
        history_complete:
          scanSummary.history_complete
      };
    }
  );

  return response(200, {
    data,
    count: data.length,
    total_count: totalCount,
    history_scope: options.historyScope,
    format: options.format,
    history_complete:
      scanSummary.history_complete,
    scan_summary: scanSummary,
    filters: {
      history_scope: options.historyScope,
      format: options.format,
      sort: options.sort,
      limit: options.limit,
      offset: options.offset
    }
  });
}

// =========================================================
// GET /vehicle-historical-ranking/:vehicleId
//
// Evidence detail for one vehicle: every eligible signal
// that contributed to its historical total, most-viewed first.
// =========================================================

async function getVehicleHistoricalDetail(
  pool,
  vehicleId,
  searchParams
) {
  const parsed = parseVehicleHistoricalRankingQuery(
    searchParams
  );

  if (parsed.error) {
    return parsed.error;
  }

  const options = parsed.value;

  const vehicleResult = await pool.query(
    `
      SELECT
        id AS vehicle_id,
        code AS vehicle_code,
        name AS vehicle_name,
        manufacturer
      FROM vehicles
      WHERE id = $1
    `,
    [vehicleId]
  );

  if (vehicleResult.rowCount === 0) {
    return response(404, {
      error: "VEHICLE_NOT_FOUND",
      message: `Vehicle ${vehicleId} was not found.`
    });
  }

  const conditions = [
    ...buildHistoricalConditions(options),
    `sig.resolved_vehicle_id = $1`
  ];

  const evidenceResult = await pool.query(
    `
      SELECT
        sig.id AS signal_id,
        sig.title,
        sig.url,
        sig.views,
        sig.published_at,
        sig.is_short,
        sig.short_format,
        sig.channel_title,
        src.name AS source_name

      FROM signals sig

      LEFT JOIN sources src
        ON src.id = sig.source_id

      WHERE ${conditions.join("\nAND ")}

      ORDER BY
        sig.views DESC,
        sig.id ASC

      LIMIT 50
    `,
    [vehicleId]
  );

  const scanSummary =
    await getLatestHistoricalScanSummary(pool);

  const totals = evidenceResult.rows.reduce(
    (accumulator, row) => {
      accumulator.historical_views_total +=
        Number(row.views);
      accumulator.max_video_views = Math.max(
        accumulator.max_video_views,
        Number(row.views)
      );
      return accumulator;
    },
    {
      historical_views_total: 0,
      max_video_views: 0
    }
  );

  return response(200, {
    data: {
      ...vehicleResult.rows[0],
      history_scope: options.historyScope,
      format: options.format,
      history_complete:
        scanSummary.history_complete,
      signal_count: evidenceResult.rowCount,
      historical_views_total:
        totals.historical_views_total,
      max_video_views:
        totals.max_video_views,
      scan_summary: scanSummary,
      evidence: evidenceResult.rows
    }
  });
}

module.exports = {
  HISTORICAL_SORTS,
  SIGNAL_SORTS,
  createScannerRun,
  getScannerRun,
  getSignal,
  getVehicleHistoricalDetail,
  listSignals,
  listVehicleHistoricalRanking,
  parseSignalQuery,
  parseVehicleHistoricalRankingQuery,
  validateScannerRunPayload
};

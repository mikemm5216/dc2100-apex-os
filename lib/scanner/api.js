const {
  normalizeRunPayload
} = require("./engine");

const AGE_WINDOWS = new Set([
  3,
  7,
  14,
  30
]);

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
  "OVER_40"
]);

const SIGNAL_SORTS = {
  rank_score: `
    sig.rank_score DESC NULLS LAST,
    sig.views_per_day DESC NULLS LAST,
    sig.id DESC
  `,

  views: `
    sig.views DESC,
    sig.rank_score DESC NULLS LAST,
    sig.id DESC
  `,

  views_per_day: `
    sig.views_per_day DESC NULLS LAST,
    sig.rank_score DESC NULLS LAST,
    sig.id DESC
  `,

  growth_velocity: `
    sig.growth_velocity DESC NULLS LAST,
    sig.rank_score DESC NULLS LAST,
    sig.id DESC
  `,

  recency: `
    sig.published_at DESC NULLS LAST,
    sig.rank_score DESC NULLS LAST,
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
        normalized.forceRefreshChannels
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
      ) || 30
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
      "duration_bucket must be ALL, UNDER_10, 10_TO_20, 20_TO_40, or OVER_40."
    );
  }

  const sort =
    searchParams.get("sort") ||
    "rank_score";

  if (!SIGNAL_SORTS[sort]) {
    return validationError(
      "sort must be rank_score, views, views_per_day, growth_velocity, or recency."
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

  return {
    value: {
      view,
      windowDays:
        requestedAgeWindow,
      durationBucket,
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
  }

  if (
    options.durationBucket !==
    "ALL"
  ) {
    values.push(
      options.durationBucket
    );

    conditions.push(
      `
        COALESCE(
          sig.raw_metrics
            ->> 'duration_bucket',
          'UNKNOWN'
        ) = $${values.length}
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
        sig.age_hours,
        sig.growth_velocity,

        sig.qualified,
        sig.rank_score,

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
          sig.age_hours,
          sig.growth_velocity,

          sig.qualified,
          sig.rank_score,

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

module.exports = {
  createScannerRun,
  getScannerRun,
  getSignal,
  listSignals,
  parseSignalQuery,
  validateScannerRunPayload
};

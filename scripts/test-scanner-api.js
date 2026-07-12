const assert =
  require("node:assert/strict");

const {
  SIGNAL_SORTS,
  listSignals,
  parseSignalQuery,
  validateScannerRunPayload
} = require(
  "../lib/scanner/api"
);

// ---------------------------------------------------------
// Scanner run payload validation
// ---------------------------------------------------------

const validRun =
  validateScannerRunPayload({
    source_ids: [
      1,
      "2",
      2
    ],

    max_results_per_source: 20,
    max_age_days: 14,
    force_refresh_channels: true
  });

assert.deepEqual(
  validRun.value,
  {
    source_ids: [
      "1",
      "2"
    ],

    max_results_per_source: 20,
    max_age_days: 14,
    force_refresh_channels: true
  }
);

const invalidAge =
  validateScannerRunPayload({
    max_age_days: 10
  });

assert.equal(
  invalidAge.error.statusCode,
  400
);

// ---------------------------------------------------------
// Defaults: shorts_only=true, sort=views, window=14
// ---------------------------------------------------------

const defaults =
  parseSignalQuery(
    new URLSearchParams()
  );

assert.equal(
  defaults.value.shortsOnly,
  true
);

assert.equal(
  defaults.value.sort,
  "views"
);

assert.equal(
  defaults.value.windowDays,
  14
);

assert.equal(
  defaults.value.viralTier,
  "ALL"
);

assert.equal(
  defaults.value.shortFormat,
  "ALL"
);

assert.equal(
  defaults.value.qualifiedOnly,
  false
);

// Task 3.3C entity filter defaults.
assert.equal(
  defaults.value.entityStatus,
  "ALL"
);

assert.equal(
  defaults.value.vehicleType,
  "ALL"
);

assert.equal(
  defaults.value.vehicleAction,
  "ALL"
);

assert.equal(
  defaults.value.hasVehicle,
  "ALL"
);

assert.equal(
  defaults.value.vehicleBrand,
  ""
);

assert.equal(
  defaults.value.countryCode,
  ""
);

// Default sort is Actual Views First, never rank_score.
assert.match(
  SIGNAL_SORTS.views.trim(),
  /^sig\.views DESC/
);

assert.doesNotMatch(
  SIGNAL_SORTS.views,
  /rank_score/
);

// ---------------------------------------------------------
// Filter parsing + validation
// ---------------------------------------------------------

const top30 =
  parseSignalQuery(
    new URLSearchParams({
      view: "top30",
      window_days: "7",
      duration_bucket: "41_TO_60",
      sort: "growth_velocity",
      shorts_only: "false",
      viral_tier: "rising",
      short_format: "classic_short",
      limit: "100"
    })
  );

assert.equal(
  top30.value.qualifiedOnly,
  true
);

assert.equal(
  top30.value.limit,
  30
);

assert.equal(
  top30.value.windowDays,
  7
);

assert.equal(
  top30.value.durationBucket,
  "41_TO_60"
);

assert.equal(
  top30.value.shortsOnly,
  false
);

assert.equal(
  top30.value.viralTier,
  "RISING"
);

assert.equal(
  top30.value.shortFormat,
  "CLASSIC_SHORT"
);

const invalidWindow =
  parseSignalQuery(
    new URLSearchParams({
      window_days: "9"
    })
  );

assert.equal(
  invalidWindow.error.statusCode,
  400
);

const invalidTier =
  parseSignalQuery(
    new URLSearchParams({
      viral_tier: "LEGENDARY"
    })
  );

assert.equal(
  invalidTier.error.statusCode,
  400
);

const invalidFormat =
  parseSignalQuery(
    new URLSearchParams({
      short_format: "MEDIUM_SHORT"
    })
  );

assert.equal(
  invalidFormat.error.statusCode,
  400
);

const invalidShortsOnly =
  parseSignalQuery(
    new URLSearchParams({
      shorts_only: "yes"
    })
  );

assert.equal(
  invalidShortsOnly.error.statusCode,
  400
);

const legacyBucket =
  parseSignalQuery(
    new URLSearchParams({
      duration_bucket: "OVER_40"
    })
  );

assert.equal(
  legacyBucket.error.statusCode,
  400
);

// ---------------------------------------------------------
// Task 3.3C entity filter parsing + validation
// ---------------------------------------------------------

const entityFilters =
  parseSignalQuery(
    new URLSearchParams({
      entity_status: "resolved",
      vehicle_type: "sports_car",
      vehicle_action: "drag_racing",
      has_vehicle: "true",
      vehicle_brand: "Porsche",
      country_code: "de"
    })
  );

assert.equal(
  entityFilters.value.entityStatus,
  "RESOLVED"
);

assert.equal(
  entityFilters.value.vehicleType,
  "SPORTS_CAR"
);

assert.equal(
  entityFilters.value.vehicleAction,
  "DRAG_RACING"
);

assert.equal(
  entityFilters.value.hasVehicle,
  "TRUE"
);

assert.equal(
  entityFilters.value.vehicleBrand,
  "Porsche"
);

assert.equal(
  entityFilters.value.countryCode,
  "DE"
);

const invalidEntityStatus =
  parseSignalQuery(
    new URLSearchParams({
      entity_status: "MAYBE"
    })
  );

assert.equal(
  invalidEntityStatus.error.statusCode,
  400
);

const invalidVehicleType =
  parseSignalQuery(
    new URLSearchParams({
      vehicle_type: "SPACESHIP"
    })
  );

assert.equal(
  invalidVehicleType.error.statusCode,
  400
);

const invalidVehicleAction =
  parseSignalQuery(
    new URLSearchParams({
      vehicle_action: "TELEPORTING"
    })
  );

assert.equal(
  invalidVehicleAction.error.statusCode,
  400
);

const invalidHasVehicle =
  parseSignalQuery(
    new URLSearchParams({
      has_vehicle: "maybe"
    })
  );

assert.equal(
  invalidHasVehicle.error.statusCode,
  400
);

const invalidCountryCode =
  parseSignalQuery(
    new URLSearchParams({
      country_code: "DEU"
    })
  );

assert.equal(
  invalidCountryCode.error.statusCode,
  400
);

const sqlishCountryCode =
  parseSignalQuery(
    new URLSearchParams({
      country_code: "';"
    })
  );

assert.equal(
  sqlishCountryCode.error.statusCode,
  400
);

// ---------------------------------------------------------
// SQL construction: default query + qualified views
// ---------------------------------------------------------

function createCapturingPool() {
  const queries = [];

  return {
    queries,

    async query(sql, values) {
      queries.push({
        sql,
        values
      });

      return {
        rows: [],
        rowCount: 0
      };
    }
  };
}

async function run() {
  const defaultPool =
    createCapturingPool();

  const defaultResponse =
    await listSignals(
      defaultPool,
      new URLSearchParams()
    );

  assert.equal(
    defaultResponse.statusCode,
    200
  );

  assert.equal(
    defaultResponse.payload.filters
      .shorts_only,
    true
  );

  assert.equal(
    defaultResponse.payload.filters
      .sort,
    "views"
  );

  assert.equal(
    defaultResponse.payload.filters
      .window_days,
    14
  );

  const defaultSql =
    defaultPool.queries[0].sql;

  assert.ok(
    defaultSql.includes(
      "sig.is_short = TRUE"
    ),
    "GET /signals must default to shorts_only=true."
  );

  const orderByClause =
    defaultSql
      .split("ORDER BY")[1];

  assert.ok(
    orderByClause
      .trim()
      .startsWith("sig.views DESC"),
    "GET /signals default sort must be actual views first."
  );

  assert.ok(
    !orderByClause.includes(
      "rank_score"
    ),
    "rank_score must not drive the default sorting."
  );

  // Qualified view: only PROVEN and RISING allowed.
  const qualifiedPool =
    createCapturingPool();

  await listSignals(
    qualifiedPool,
    new URLSearchParams({
      view: "qualified"
    })
  );

  const qualifiedSql =
    qualifiedPool.queries[0].sql;

  assert.ok(
    qualifiedSql.includes(
      "sig.qualified = TRUE"
    )
  );

  assert.ok(
    qualifiedSql.includes(
      "sig.viral_tier IN"
    ) &&
      qualifiedSql.includes("'PROVEN'") &&
      qualifiedSql.includes("'RISING'") &&
      !qualifiedSql.includes("'WATCH'"),
    "Qualified view must exclude WATCH."
  );

  // Top 30 view: same tier restriction, capped at 30.
  const top30Pool =
    createCapturingPool();

  const top30Response =
    await listSignals(
      top30Pool,
      new URLSearchParams({
        view: "top30",
        limit: "100"
      })
    );

  const top30Sql =
    top30Pool.queries[0].sql;

  assert.ok(
    top30Sql.includes(
      "sig.qualified = TRUE"
    ) &&
      top30Sql.includes(
        "sig.viral_tier IN"
      ) &&
      !top30Sql.includes("'WATCH'"),
    "Top 30 must exclude WATCH."
  );

  assert.equal(
    top30Response.payload.filters
      .limit,
    30
  );

  // -------------------------------------------------------
  // Task 3.3C: entity filters are parameterized and the
  // default query is unchanged.
  // -------------------------------------------------------

  assert.equal(
    defaultResponse.payload.filters
      .entity_status,
    "ALL"
  );

  assert.equal(
    defaultResponse.payload.filters
      .has_vehicle,
    "ALL"
  );

  assert.ok(
    !defaultSql.includes(
      "entity_resolution_status ="
    ),
    "Default query must not filter by entity status."
  );

  const entityPool =
    createCapturingPool();

  await listSignals(
    entityPool,
    new URLSearchParams({
      entity_status: "RESOLVED",
      vehicle_type: "SPORTS_CAR",
      vehicle_action: "DRAG_RACING",
      has_vehicle: "true",
      vehicle_brand: "Porsche' OR 1=1 --",
      country_code: "DE"
    })
  );

  const entityQuery =
    entityPool.queries[0];

  // vehicle_brand and country_code only appear as bind
  // parameters, never inlined into the SQL text.
  assert.ok(
    !entityQuery.sql.includes("Porsche"),
    "vehicle_brand must be parameterized."
  );

  assert.ok(
    !entityQuery.sql.includes("1=1"),
    "vehicle_brand must never be interpolated into SQL."
  );

  assert.ok(
    entityQuery.values.includes(
      "Porsche' OR 1=1 --"
    ),
    "vehicle_brand must be passed as a bind value."
  );

  assert.ok(
    entityQuery.values.includes("DE"),
    "country_code must be passed as a bind value."
  );

  assert.ok(
    entityQuery.values.includes(
      "RESOLVED"
    ) &&
      entityQuery.values.includes(
        "SPORTS_CAR"
      ) &&
      entityQuery.values.includes(
        "DRAG_RACING"
      ),
    "Entity allowlist filters must be bind values."
  );

  assert.ok(
    entityQuery.sql.includes(
      "sig.vehicle_brand IS NOT NULL"
    ),
    "has_vehicle=true must require a resolved brand."
  );

  assert.ok(
    entityQuery.sql.includes(
      "LOWER(sig.vehicle_brand)"
    ),
    "vehicle_brand must use exact normalized matching."
  );

  // Entity filters must not change the Actual Views First
  // ordering.
  const entityOrderBy =
    entityQuery.sql.split("ORDER BY")[1];

  assert.ok(
    entityOrderBy
      .trim()
      .startsWith("sig.views DESC"),
    "Entity filters must not change views-first sorting."
  );

  // List response includes entity + resolved reference
  // fields.
  for (const column of [
    "sig.vehicle_brand",
    "sig.vehicle_series",
    "sig.vehicle_model",
    "sig.vehicle_type",
    "sig.vehicle_action",
    "sig.conflict_keywords",
    "sig.entity_resolution_status",
    "sig.entity_confidence",
    "sig.entity_match_method",
    "sig.entity_resolver_version",
    "sig.entity_locked",
    "resolved_vehicle_code",
    "resolved_vehicle_name",
    "resolved_country_code",
    "resolved_country_name"
  ]) {
    assert.ok(
      entityQuery.sql.includes(column),
      `Signals list must select ${column}.`
    );
  }

  // The list payload stays compact: full entity evidence is
  // reserved for the detail endpoint.
  assert.ok(
    !entityQuery.sql.includes(
      "sig.entity_evidence"
    ),
    "List endpoint must not return full entity evidence."
  );

  console.log(
    "TASK 3.3B + 3.3C SCANNER API TESTS PASSED"
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

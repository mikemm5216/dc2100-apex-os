const assert =
  require("node:assert/strict");

const { newDb } = require("pg-mem");

const {
  HISTORICAL_SORTS,
  SIGNAL_SORTS,
  getVehicleHistoricalDetail,
  listSignals,
  listVehicleHistoricalRanking,
  parseSignalQuery,
  parseVehicleHistoricalRankingQuery,
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
    force_refresh_channels: true,
    scan_mode: "CURRENT",
    max_pages_per_source: 40
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
// scan_mode: defaults to CURRENT, HISTORICAL is accepted,
// invalid values are rejected.
// ---------------------------------------------------------

const historicalRun =
  validateScannerRunPayload({
    scan_mode: "HISTORICAL",
    max_pages_per_source: 5
  });

assert.equal(
  historicalRun.value.scan_mode,
  "HISTORICAL"
);

assert.equal(
  historicalRun.value.max_pages_per_source,
  5
);

const invalidScanMode =
  validateScannerRunPayload({
    scan_mode: "FUTURE"
  });

assert.equal(
  invalidScanMode.error.statusCode,
  400
);

const invalidMaxPages =
  validateScannerRunPayload({
    max_pages_per_source: 0
  });

assert.equal(
  invalidMaxPages.error.statusCode,
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

// ---------------------------------------------------------
// Vehicle Historical Top 10: query parsing / validation
// ---------------------------------------------------------

function runHistoricalQueryValidationTests() {
  const defaults = parseVehicleHistoricalRankingQuery(
    new URLSearchParams()
  );

  assert.equal(defaults.value.historyScope, "ALL_TIME");
  assert.equal(defaults.value.format, "SHORTS");
  assert.equal(defaults.value.sort, "historical_views");
  assert.equal(defaults.value.limit, 10);
  assert.equal(defaults.value.offset, 0);

  const invalidScope = parseVehicleHistoricalRankingQuery(
    new URLSearchParams({ history_scope: "FIVE_YEARS" })
  );
  assert.equal(invalidScope.error.statusCode, 400);

  const invalidFormat = parseVehicleHistoricalRankingQuery(
    new URLSearchParams({ format: "LONG" })
  );
  assert.equal(invalidFormat.error.statusCode, 400);

  const invalidSort = parseVehicleHistoricalRankingQuery(
    new URLSearchParams({ sort: "fusion_score" })
  );
  assert.equal(invalidSort.error.statusCode, 400);

  const invalidLimit = parseVehicleHistoricalRankingQuery(
    new URLSearchParams({ limit: "101" })
  );
  assert.equal(invalidLimit.error.statusCode, 400);

  // Ranking must never be driven by fusion_score or rank_score.
  for (const sortSql of Object.values(HISTORICAL_SORTS)) {
    assert.ok(!sortSql.includes("fusion_score"));
    assert.ok(!sortSql.includes("rank_score"));
  }

  console.log(
    "VEHICLE HISTORICAL RANKING QUERY VALIDATION TESTS PASSED"
  );
}

// ---------------------------------------------------------
// Vehicle Historical Top 10: aggregation correctness
// (pg-mem, real GROUP BY / SUM / MAX / DISTINCT ON execution)
// ---------------------------------------------------------

async function buildHistoricalFixturePool() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  await pool.query(`
    CREATE TABLE vehicles (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      manufacturer TEXT
    );

    CREATE TABLE sources (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE signals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      resolved_vehicle_id BIGINT,
      source_id BIGINT,
      views BIGINT NOT NULL DEFAULT 0,
      title TEXT,
      url TEXT,
      channel_title TEXT,
      short_format TEXT,
      published_at TIMESTAMPTZ,
      entity_resolution_status TEXT NOT NULL DEFAULT 'UNRESOLVED',
      is_short BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE scanner_runs (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      status TEXT NOT NULL,
      request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      completed_at TIMESTAMPTZ
    );
  `);

  async function insertVehicle(code, name, manufacturer) {
    const result = await pool.query(
      `INSERT INTO vehicles (code, name, manufacturer)
       VALUES ($1, $2, $3) RETURNING id`,
      [code, name, manufacturer]
    );
    return result.rows[0].id;
  }

  async function insertSource(name) {
    const result = await pool.query(
      `INSERT INTO sources (name) VALUES ($1) RETURNING id`,
      [name]
    );
    return result.rows[0].id;
  }

  async function insertSignal({
    vehicleId,
    sourceId,
    views,
    title,
    url,
    publishedAt,
    resolutionStatus = "RESOLVED",
    isShort = true
  }) {
    await pool.query(
      `INSERT INTO signals
        (resolved_vehicle_id, source_id, views, title, url,
         channel_title, short_format, published_at,
         entity_resolution_status, is_short)
       VALUES ($1, $2, $3, $4, $5, $4, 'CLASSIC_SHORT', $6, $7, $8)`,
      [
        vehicleId,
        sourceId,
        views,
        title,
        url,
        publishedAt,
        resolutionStatus,
        isShort
      ]
    );
  }

  const sourceA = await insertSource("Source A");
  const sourceB = await insertSource("Source B");

  const now = new Date();
  const fiveYearsAgo = new Date(now);
  fiveYearsAgo.setFullYear(now.getFullYear() - 5);
  const fifteenYearsAgo = new Date(now);
  fifteenYearsAgo.setFullYear(now.getFullYear() - 15);

  const v1 = await insertVehicle(
    "GT3RS",
    "911 GT3 RS",
    "Porsche"
  );
  const v2 = await insertVehicle(
    "M4COMP",
    "M4 Competition",
    "BMW"
  );
  const v3 = await insertVehicle(
    "SUPRA",
    "GR Supra",
    "Toyota"
  );
  const v4 = await insertVehicle("RS3", "RS3", "Audi");
  const v5 = await insertVehicle("CIVIC", "Civic Type R", "Honda");
  const v6 = await insertVehicle("CLASSIC", "Classic Icon", "Jaguar");

  // V1: two Shorts across two sources -- sum 160,000 / max 110,000.
  await insertSignal({
    vehicleId: v1,
    sourceId: sourceA,
    views: 110000,
    title: "GT3 RS Launch Control",
    url: "https://y/v1",
    publishedAt: now
  });
  await insertSignal({
    vehicleId: v1,
    sourceId: sourceB,
    views: 50000,
    title: "GT3 RS Drift",
    url: "https://y/v2",
    publishedAt: now
  });
  // Long-form video for V1 -- excluded under format=SHORTS,
  // and large enough to flip the #1 rank under format=ALL.
  await insertSignal({
    vehicleId: v1,
    sourceId: sourceA,
    views: 2000000,
    title: "GT3 RS Full Review",
    url: "https://y/v1-long",
    publishedAt: now,
    isShort: false
  });

  // V2: one recent Short (200,000) + one Short from 5 years ago
  // (999,999) -- the 5-year-old signal must only count once
  // ONE_YEAR is widened to TEN_YEARS / ALL_TIME.
  await insertSignal({
    vehicleId: v2,
    sourceId: sourceA,
    views: 200000,
    title: "M4 Competition Burnout",
    url: "https://y/v3",
    publishedAt: now
  });
  await insertSignal({
    vehicleId: v2,
    sourceId: sourceB,
    views: 999999,
    title: "M4 Competition Classic Drift",
    url: "https://y/v9",
    publishedAt: fiveYearsAgo
  });

  // V4 vs V5: identical SUM (100,000) with different MAX --
  // proves the MAX-views tie-break.
  await insertSignal({
    vehicleId: v4,
    sourceId: sourceA,
    views: 60000,
    title: "RS3 Drag Run",
    url: "https://y/v5",
    publishedAt: now
  });
  await insertSignal({
    vehicleId: v4,
    sourceId: sourceB,
    views: 40000,
    title: "RS3 Launch",
    url: "https://y/v6",
    publishedAt: now
  });
  await insertSignal({
    vehicleId: v5,
    sourceId: sourceA,
    views: 100000,
    title: "Civic Type R Track Day",
    url: "https://y/v7",
    publishedAt: now
  });

  // V6: a 15-year-old Short -- must drop out of TEN_YEARS but
  // remain in ALL_TIME.
  await insertSignal({
    vehicleId: v6,
    sourceId: sourceA,
    views: 777,
    title: "Classic Icon Archive Footage",
    url: "https://y/v10",
    publishedAt: fifteenYearsAgo
  });

  // V3: must NEVER appear -- one signal is UNRESOLVED despite
  // having a resolved_vehicle_id, the other has zero views.
  await insertSignal({
    vehicleId: v3,
    sourceId: sourceA,
    views: 100000,
    title: "Supra Unresolved",
    url: "https://y/v8",
    publishedAt: now,
    resolutionStatus: "UNRESOLVED"
  });
  await insertSignal({
    vehicleId: v3,
    sourceId: sourceA,
    views: 0,
    title: "Supra Zero Views",
    url: "https://y/v8b",
    publishedAt: now
  });

  // A signal with no resolved vehicle at all -- must never
  // contribute to any ranking row.
  await insertSignal({
    vehicleId: null,
    sourceId: sourceA,
    views: 500000,
    title: "Unlinked Vehicle Footage",
    url: "https://y/v11",
    publishedAt: now
  });

  return { pool, ids: { v1, v2, v3, v4, v5, v6 } };
}

async function runHistoricalRankingCorrectnessTests() {
  const { pool, ids } = await buildHistoricalFixturePool();

  // No historical scan has ever completed -- must never claim
  // ALL_TIME completeness.
  const beforeScan = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams()
  );

  assert.equal(beforeScan.statusCode, 200);
  assert.equal(beforeScan.payload.history_complete, false);

  await pool.query(
    `INSERT INTO scanner_runs (status, request_payload, summary, completed_at)
     VALUES (
       'COMPLETED',
       '{"scan_mode":"HISTORICAL"}'::jsonb,
       '{"history_complete": true, "pages_scanned": 4}'::jsonb,
       NOW()
     )`
  );

  // -------------------------------------------------------
  // Default: ALL_TIME / SHORTS / historical_views. Distinct
  // vehicles only, ranked by SUM(views) with MAX-views and
  // signal_count tie-breaks.
  // -------------------------------------------------------

  const defaultResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams()
  );

  assert.equal(defaultResult.statusCode, 200);
  assert.equal(defaultResult.payload.history_complete, true);

  const defaultIds = defaultResult.payload.data.map(
    row => row.vehicle_id
  );

  // V3 (unresolved / zero-view) and the unlinked-vehicle
  // signal must never appear.
  assert.ok(!defaultIds.includes(ids.v3));

  assert.deepEqual(
    defaultIds,
    [ids.v2, ids.v1, ids.v5, ids.v4, ids.v6],
    "Default ranking must be distinct-vehicle SUM(views) DESC, tie-broken by MAX(views) DESC."
  );

  const v2Row = defaultResult.payload.data.find(
    row => row.vehicle_id === ids.v2
  );

  assert.equal(
    Number(v2Row.historical_views_total),
    200000 + 999999,
    "SUM must add every distinct video's views for the vehicle, never double count."
  );

  assert.equal(Number(v2Row.max_video_views), 999999);
  assert.equal(Number(v2Row.signal_count), 2);
  assert.equal(Number(v2Row.source_count), 2);
  assert.equal(v2Row.rank, 1);

  const v1Row = defaultResult.payload.data.find(
    row => row.vehicle_id === ids.v1
  );

  // The long-form video (2,000,000 views) must be excluded
  // under the default SHORTS format.
  assert.equal(Number(v1Row.historical_views_total), 160000);
  assert.equal(Number(v1Row.signal_count), 2);

  const v5Row = defaultResult.payload.data.find(
    row => row.vehicle_id === ids.v5
  );
  const v4Row = defaultResult.payload.data.find(
    row => row.vehicle_id === ids.v4
  );

  assert.equal(
    Number(v5Row.historical_views_total),
    Number(v4Row.historical_views_total),
    "V4 and V5 fixtures must be an exact SUM tie."
  );

  assert.ok(
    Number(v5Row.max_video_views) >
      Number(v4Row.max_video_views),
    "Tie-break vehicle (V5) must have the higher MAX(views)."
  );

  assert.equal(
    v1Row.representative_video_title,
    "GT3 RS Launch Control",
    "Representative video must be the highest-viewed eligible signal."
  );

  // -------------------------------------------------------
  // format=ALL: long-form video counts, reordering the top rank.
  // -------------------------------------------------------

  const allFormatResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams({ format: "ALL" })
  );

  assert.equal(
    allFormatResult.payload.data[0].vehicle_id,
    ids.v1,
    "Including long-form videos must let V1's 2,000,000-view review outrank V2."
  );

  // -------------------------------------------------------
  // history_scope: ONE_YEAR excludes the 5-year-old signal;
  // TEN_YEARS and ALL_TIME include it, but only ALL_TIME
  // reaches back 15 years.
  // -------------------------------------------------------

  const oneYearResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams({ history_scope: "ONE_YEAR" })
  );

  const oneYearV2 = oneYearResult.payload.data.find(
    row => row.vehicle_id === ids.v2
  );

  assert.equal(
    Number(oneYearV2.historical_views_total),
    200000,
    "ONE_YEAR scope must exclude the 5-year-old signal."
  );

  assert.ok(
    !oneYearResult.payload.data.some(
      row => row.vehicle_id === ids.v6
    ),
    "ONE_YEAR scope must exclude the 15-year-old signal."
  );

  const tenYearsResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams({ history_scope: "TEN_YEARS" })
  );

  assert.ok(
    !tenYearsResult.payload.data.some(
      row => row.vehicle_id === ids.v6
    ),
    "TEN_YEARS scope must exclude the 15-year-old signal."
  );

  const allTimeResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams({ history_scope: "ALL_TIME" })
  );

  assert.ok(
    allTimeResult.payload.data.some(
      row => row.vehicle_id === ids.v6
    ),
    "ALL_TIME scope must include the 15-year-old signal."
  );

  // -------------------------------------------------------
  // sort=max_video_views / signal_count
  // -------------------------------------------------------

  const maxViewsResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams({ sort: "max_video_views" })
  );

  assert.equal(
    maxViewsResult.payload.data[0].vehicle_id,
    ids.v2,
    "sort=max_video_views must rank by the single highest video, not the SUM."
  );

  // -------------------------------------------------------
  // total_count reflects the distinct-vehicle count, not the
  // raw signal-row count.
  // -------------------------------------------------------

  assert.equal(
    defaultResult.payload.total_count,
    5,
    "total_count must equal the number of DISTINCT eligible vehicles."
  );

  // -------------------------------------------------------
  // Evidence detail endpoint
  // -------------------------------------------------------

  const detailResult = await getVehicleHistoricalDetail(
    pool,
    String(ids.v1),
    new URLSearchParams()
  );

  assert.equal(detailResult.statusCode, 200);
  assert.equal(detailResult.payload.data.signal_count, 2);
  assert.equal(
    detailResult.payload.data.historical_views_total,
    160000
  );
  assert.equal(
    detailResult.payload.data.evidence[0].title,
    "GT3 RS Launch Control",
    "Evidence must be sorted by views descending."
  );

  const missingDetail = await getVehicleHistoricalDetail(
    pool,
    "999999",
    new URLSearchParams()
  );

  assert.equal(missingDetail.statusCode, 404);

  console.log(
    "VEHICLE HISTORICAL RANKING CORRECTNESS TESTS PASSED"
  );
}

async function main() {
  await run();
  runHistoricalQueryValidationTests();
  await runHistoricalRankingCorrectnessTests();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

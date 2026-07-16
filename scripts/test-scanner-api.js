const assert =
  require("node:assert/strict");

const { newDb } = require("pg-mem");

const {
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
  assert.equal(defaults.value.limit, 10);
  assert.equal(defaults.value.offset, 0);

  // The old SUM-based sort parameter is gone entirely --
  // ranking is a single, fixed metric now (the vehicle's own
  // highest-viewed video), so there is nothing left to select
  // between.
  assert.equal(defaults.value.sort, undefined);

  const invalidScope = parseVehicleHistoricalRankingQuery(
    new URLSearchParams({ history_scope: "FIVE_YEARS" })
  );
  assert.equal(invalidScope.error.statusCode, 400);

  const invalidFormat = parseVehicleHistoricalRankingQuery(
    new URLSearchParams({ format: "LONG" })
  );
  assert.equal(invalidFormat.error.statusCode, 400);

  const invalidLimit = parseVehicleHistoricalRankingQuery(
    new URLSearchParams({ limit: "101" })
  );
  assert.equal(invalidLimit.error.statusCode, 400);

  console.log(
    "VEHICLE HISTORICAL RANKING QUERY VALIDATION TESTS PASSED"
  );
}

// ---------------------------------------------------------
// Vehicle Historical Top 10: single-video-per-vehicle
// correctness (pg-mem, real DISTINCT ON / GROUP BY execution)
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
      external_id TEXT,
      resolved_vehicle_id BIGINT,
      source_id BIGINT,
      views BIGINT NOT NULL DEFAULT 0,
      title TEXT,
      url TEXT,
      thumbnail_url TEXT,
      channel_title TEXT,
      short_format TEXT,
      published_at TIMESTAMPTZ,
      entity_resolution_status TEXT NOT NULL DEFAULT 'UNRESOLVED',
      entity_evidence JSONB,
      entity_match_method TEXT,
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

  let externalIdCounter = 0;

  async function insertSignal({
    vehicleId,
    sourceId,
    views,
    title,
    url,
    publishedAt,
    resolutionStatus = "RESOLVED",
    isShort = true,
    entityEvidence = null,
    entityMatchMethod = null
  }) {
    externalIdCounter += 1;

    await pool.query(
      `INSERT INTO signals
        (external_id, resolved_vehicle_id, source_id, views,
         title, url, channel_title, short_format, published_at,
         entity_resolution_status, entity_evidence,
         entity_match_method, is_short)
       VALUES ($1, $2, $3, $4, $5, $6, $5, 'CLASSIC_SHORT', $7, $8, $9::jsonb, $10, $11)`,
      [
        `ext-${externalIdCounter}`,
        vehicleId,
        sourceId,
        views,
        title,
        url,
        publishedAt,
        resolutionStatus,
        entityEvidence
          ? JSON.stringify(entityEvidence)
          : null,
        entityMatchMethod,
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

  const vehicleA = await insertVehicle(
    "AAA",
    "Vehicle A",
    "Brand A"
  );
  const vehicleD = await insertVehicle(
    "DDD",
    "Vehicle D",
    "Brand D"
  );
  const vehicleLong = await insertVehicle(
    "LNG",
    "Vehicle Long",
    "Brand Long"
  );
  const vehicleScope = await insertVehicle(
    "SCP",
    "Vehicle Scope",
    "Brand Scope"
  );
  const vehicleClassic = await insertVehicle(
    "CLS",
    "Vehicle Classic",
    "Brand Classic"
  );
  const vehicleGhost = await insertVehicle(
    "GHOST",
    "Vehicle Ghost",
    "Brand Ghost"
  );

  // Vehicle A: three Shorts (A=10M, B=5M, C=3M). The ranking
  // must use ONLY Video A's 10,000,000 -- never 18,000,000.
  await insertSignal({
    vehicleId: vehicleA,
    sourceId: sourceA,
    views: 10000000,
    title: "Video A",
    url: "https://y/video-a",
    publishedAt: now,
    entityEvidence: { matched_terms: ["Vehicle A"] },
    entityMatchMethod: "MODEL_ALIAS"
  });
  await insertSignal({
    vehicleId: vehicleA,
    sourceId: sourceA,
    views: 5000000,
    title: "Video B",
    url: "https://y/video-b",
    publishedAt: now
  });
  await insertSignal({
    vehicleId: vehicleA,
    sourceId: sourceB,
    views: 3000000,
    title: "Video C",
    url: "https://y/video-c",
    publishedAt: now
  });

  // Vehicle D: a single Short outranking everything (20M).
  await insertSignal({
    vehicleId: vehicleD,
    sourceId: sourceB,
    views: 20000000,
    title: "Video D",
    url: "https://y/video-d",
    publishedAt: now
  });

  // Vehicle Long: a Short (200,000) and a long-form video
  // (2,000,000). format=SHORTS must pick the Short as the
  // vehicle's top video; format=ALL must switch to the
  // long-form video.
  await insertSignal({
    vehicleId: vehicleLong,
    sourceId: sourceA,
    views: 200000,
    title: "Vehicle Long Short Clip",
    url: "https://y/long-short",
    publishedAt: now
  });
  await insertSignal({
    vehicleId: vehicleLong,
    sourceId: sourceA,
    views: 2000000,
    title: "Vehicle Long Full Review",
    url: "https://y/long-review",
    publishedAt: now,
    isShort: false
  });

  // Vehicle Scope: an old, high-view Short (999,999 @ 5 years
  // ago) and a recent, low-view Short (1,000 @ now). Narrowing
  // the scope to ONE_YEAR must switch this vehicle's top video
  // from the 5-year-old one to the recent one.
  await insertSignal({
    vehicleId: vehicleScope,
    sourceId: sourceA,
    views: 999999,
    title: "Vehicle Scope Old Viral Clip",
    url: "https://y/scope-old",
    publishedAt: fiveYearsAgo
  });
  await insertSignal({
    vehicleId: vehicleScope,
    sourceId: sourceA,
    views: 1000,
    title: "Vehicle Scope Recent Clip",
    url: "https://y/scope-recent",
    publishedAt: now
  });

  // Vehicle Classic: a single 15-year-old Short -- must drop
  // out of TEN_YEARS but remain in ALL_TIME.
  await insertSignal({
    vehicleId: vehicleClassic,
    sourceId: sourceA,
    views: 500,
    title: "Vehicle Classic Archive Footage",
    url: "https://y/classic",
    publishedAt: fifteenYearsAgo
  });

  // Vehicle Ghost: must NEVER appear -- one signal is
  // UNRESOLVED despite having a resolved_vehicle_id, the other
  // has zero views.
  await insertSignal({
    vehicleId: vehicleGhost,
    sourceId: sourceA,
    views: 100000,
    title: "Ghost Unresolved",
    url: "https://y/ghost-unresolved",
    publishedAt: now,
    resolutionStatus: "UNRESOLVED"
  });
  await insertSignal({
    vehicleId: vehicleGhost,
    sourceId: sourceA,
    views: 0,
    title: "Ghost Zero Views",
    url: "https://y/ghost-zero",
    publishedAt: now
  });

  // A signal with no resolved vehicle at all -- must never
  // contribute to any ranking row.
  await insertSignal({
    vehicleId: null,
    sourceId: sourceA,
    views: 50000000,
    title: "Unlinked Vehicle Footage",
    url: "https://y/unlinked",
    publishedAt: now
  });

  return {
    pool,
    ids: {
      vehicleA,
      vehicleD,
      vehicleLong,
      vehicleScope,
      vehicleClassic,
      vehicleGhost
    }
  };
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
  // Default: ALL_TIME / SHORTS. Each vehicle keeps only its
  // own single highest-viewed eligible video.
  // -------------------------------------------------------

  const defaultResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams()
  );

  assert.equal(defaultResult.statusCode, 200);
  assert.equal(defaultResult.payload.history_complete, true);

  const defaultRows = defaultResult.payload.data;
  const defaultIds = defaultRows.map(row => row.vehicle_id);

  // Vehicle Ghost (unresolved / zero-view) and the
  // unlinked-vehicle signal must never appear.
  assert.ok(!defaultIds.includes(ids.vehicleGhost));

  // Every vehicle appears exactly once.
  assert.equal(
    new Set(defaultIds).size,
    defaultIds.length,
    "Each vehicle must appear exactly once in the ranking."
  );

  assert.deepEqual(
    defaultIds,
    [
      ids.vehicleD,
      ids.vehicleA,
      ids.vehicleScope,
      ids.vehicleLong,
      ids.vehicleClassic
    ],
    "Ranking must be ordered by each vehicle's single top video views DESC."
  );

  // The exact scenario from the correction: Vehicle A has
  // 10M/5M/3M videos -- the ranking must use ONLY the 10M
  // video, never 18M. Vehicle D's single 20M video must rank
  // above it.
  assert.equal(defaultRows[0].vehicle_id, ids.vehicleD);
  assert.equal(Number(defaultRows[0].video_views), 20000000);
  assert.equal(defaultRows[0].video_title, "Video D");

  assert.equal(defaultRows[1].vehicle_id, ids.vehicleA);
  assert.equal(Number(defaultRows[1].video_views), 10000000);
  assert.equal(defaultRows[1].video_title, "Video A");
  assert.notEqual(
    Number(defaultRows[1].video_views),
    18000000,
    "Vehicle A must never be ranked by 10M + 5M + 3M summed together."
  );

  const vehicleARow = defaultRows.find(
    row => row.vehicle_id === ids.vehicleA
  );

  // Reference-only field: it must reflect all 3 eligible
  // videos, but it must never have driven the ranking above.
  assert.equal(Number(vehicleARow.vehicle_signal_count), 3);

  assert.equal(vehicleARow.entity_match_method, "MODEL_ALIAS");
  assert.deepEqual(vehicleARow.entity_evidence, {
    matched_terms: ["Vehicle A"]
  });

  // No aggregate/derived-score fields must leak into the
  // response at all.
  for (const row of defaultRows) {
    assert.equal(row.historical_views_total, undefined);
    assert.equal(row.max_video_views, undefined);
    assert.equal(row.fusion_score, undefined);
    assert.equal(row.rank_score, undefined);
    assert.equal(row.growth_velocity, undefined);
  }

  // -------------------------------------------------------
  // format=ALL: Vehicle Long's top video switches from its
  // 200,000-view Short to its 2,000,000-view long-form review.
  // -------------------------------------------------------

  const allFormatResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams({ format: "ALL" })
  );

  const vehicleLongAllRow = allFormatResult.payload.data.find(
    row => row.vehicle_id === ids.vehicleLong
  );

  assert.equal(
    Number(vehicleLongAllRow.video_views),
    2000000,
    "format=ALL must let the long-form video become the vehicle's top video."
  );
  assert.equal(
    vehicleLongAllRow.video_title,
    "Vehicle Long Full Review"
  );

  const defaultVehicleLongRow = defaultRows.find(
    row => row.vehicle_id === ids.vehicleLong
  );

  assert.equal(
    Number(defaultVehicleLongRow.video_views),
    200000,
    "format=SHORTS (default) must keep the Short as the vehicle's top video."
  );

  // -------------------------------------------------------
  // history_scope: narrowing to ONE_YEAR must switch Vehicle
  // Scope's top video from its 5-year-old 999,999-view clip
  // to its recent 1,000-view clip, and must drop Vehicle
  // Classic (15 years old) entirely. TEN_YEARS keeps the
  // 5-year-old clip but still drops the 15-year-old one.
  // ALL_TIME includes both.
  // -------------------------------------------------------

  const oneYearResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams({ history_scope: "ONE_YEAR" })
  );

  const oneYearScopeRow = oneYearResult.payload.data.find(
    row => row.vehicle_id === ids.vehicleScope
  );

  assert.equal(
    Number(oneYearScopeRow.video_views),
    1000,
    "ONE_YEAR scope must exclude the 5-year-old video and fall back to the recent one."
  );

  assert.ok(
    !oneYearResult.payload.data.some(
      row => row.vehicle_id === ids.vehicleClassic
    ),
    "ONE_YEAR scope must exclude the 15-year-old-only vehicle."
  );

  const tenYearsResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams({ history_scope: "TEN_YEARS" })
  );

  const tenYearsScopeRow = tenYearsResult.payload.data.find(
    row => row.vehicle_id === ids.vehicleScope
  );

  assert.equal(Number(tenYearsScopeRow.video_views), 999999);

  assert.ok(
    !tenYearsResult.payload.data.some(
      row => row.vehicle_id === ids.vehicleClassic
    ),
    "TEN_YEARS scope must exclude the 15-year-old-only vehicle."
  );

  const allTimeResult = await listVehicleHistoricalRanking(
    pool,
    new URLSearchParams({ history_scope: "ALL_TIME" })
  );

  assert.ok(
    allTimeResult.payload.data.some(
      row => row.vehicle_id === ids.vehicleClassic
    ),
    "ALL_TIME scope must include the 15-year-old-only vehicle."
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
  // Evidence detail endpoint: the single top video, not a
  // list of every video for the vehicle.
  // -------------------------------------------------------

  const detailResult = await getVehicleHistoricalDetail(
    pool,
    String(ids.vehicleA),
    new URLSearchParams()
  );

  assert.equal(detailResult.statusCode, 200);
  assert.equal(
    detailResult.payload.data.vehicle_signal_count,
    3
  );
  assert.equal(
    detailResult.payload.data.top_video.video_title,
    "Video A",
    "Detail must surface the single highest-viewed video, not an aggregate."
  );
  assert.equal(
    Number(detailResult.payload.data.top_video.video_views),
    10000000
  );
  assert.equal(
    detailResult.payload.data.top_video.entity_match_method,
    "MODEL_ALIAS"
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

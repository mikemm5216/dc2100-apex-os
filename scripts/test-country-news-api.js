const assert = require("node:assert/strict");

const {
  NEWS_SORTS,
  createCountryNewsRun,
  getCountryNewsDetail,
  listCountryNews,
  parseCountryNewsQuery,
  validateNewsRunPayload
} = require("../lib/news/api");

// ---------------------------------------------------------
// Run payload validation
// ---------------------------------------------------------

const validRun = validateNewsRunPayload({
  max_countries: 3,
  max_queries_per_country: 3,
  max_items_per_query: 10,
  max_age_hours: 72,
  country_codes: null
});

assert.deepEqual(validRun.value, {
  max_countries: 3,
  max_queries_per_country: 3,
  max_items_per_query: 10,
  max_age_hours: 72,
  country_codes: null
});

// Defaults fill in when fields are omitted.
const defaultRun = validateNewsRunPayload({});

assert.deepEqual(defaultRun.value, {
  max_countries: 10,
  max_queries_per_country: 5,
  max_items_per_query: 20,
  max_age_hours: 72,
  country_codes: null
});

for (const invalidBody of [
  { max_countries: 0 },
  { max_countries: 11 },
  { max_queries_per_country: 6 },
  { max_items_per_query: 4 },
  { max_items_per_query: 51 },
  { max_age_hours: 48 },
  { country_codes: [] },
  { country_codes: ["JPN"] },
  {
    country_codes: [
      "JP", "DE", "US", "IT", "GB", "CN",
      "KR", "FR", "SE", "HR", "ES"
    ]
  },
  null,
  []
]) {
  const result = validateNewsRunPayload(invalidBody);

  assert.equal(
    result.error?.statusCode,
    400,
    `Payload ${JSON.stringify(invalidBody)} must be rejected.`
  );
}

const codesRun = validateNewsRunPayload({
  country_codes: ["jp", "de", "JP"]
});

assert.deepEqual(
  codesRun.value.country_codes,
  ["JP", "DE"]
);

// ---------------------------------------------------------
// Query parsing defaults
// ---------------------------------------------------------

const defaults = parseCountryNewsQuery(
  new URLSearchParams()
);

assert.equal(defaults.value.windowHours, 72);
assert.equal(defaults.value.sort, "traffic_score");
assert.equal(defaults.value.trafficTier, "ALL");
assert.equal(defaults.value.category, "ALL");
assert.equal(
  defaults.value.transformationTier,
  "ALL"
);
assert.equal(
  defaults.value.conflictArchetype,
  "ALL"
);
assert.equal(defaults.value.limit, 100);
assert.equal(defaults.value.offset, 0);

// Default sort ordering starts with traffic_score DESC.
assert.match(
  NEWS_SORTS.traffic_score.trim(),
  /^cns\.traffic_score DESC/
);

// ---------------------------------------------------------
// Query parsing validation
// ---------------------------------------------------------

const parsedFilters = parseCountryNewsQuery(
  new URLSearchParams({
    window_hours: "24",
    country_code: "jp",
    category: "energy",
    traffic_tier: "breakout",
    transformation_tier: "high",
    conflict_archetype: "resource_scarcity",
    sort: "transformation_potential",
    limit: "50",
    offset: "10",
    q: "fuel"
  })
);

assert.equal(parsedFilters.value.windowHours, 24);
assert.equal(parsedFilters.value.countryCode, "JP");
assert.equal(parsedFilters.value.category, "ENERGY");
assert.equal(
  parsedFilters.value.trafficTier,
  "BREAKOUT"
);
assert.equal(
  parsedFilters.value.transformationTier,
  "HIGH"
);
assert.equal(
  parsedFilters.value.conflictArchetype,
  "RESOURCE_SCARCITY"
);
assert.equal(
  parsedFilters.value.sort,
  "transformation_potential"
);
assert.equal(parsedFilters.value.limit, 50);
assert.equal(parsedFilters.value.offset, 10);
assert.equal(parsedFilters.value.search, "fuel");

for (const [key, value] of [
  ["window_hours", "48"],
  ["country_code", "JPN"],
  ["country_code", "';"],
  ["category", "GOSSIP"],
  ["traffic_tier", "VIRAL"],
  ["transformation_tier", "EXTREME"],
  ["conflict_archetype", "ALIEN_INVASION"],
  ["sort", "views"],
  ["limit", "0"],
  ["limit", "101"],
  ["offset", "-1"]
]) {
  const result = parseCountryNewsQuery(
    new URLSearchParams({ [key]: value })
  );

  assert.equal(
    result.error?.statusCode,
    400,
    `${key}=${value} must be rejected.`
  );
}

// ---------------------------------------------------------
// SQL construction with a capturing pool
// ---------------------------------------------------------

function createCapturingPool(responders = []) {
  const queries = [];

  return {
    queries,

    async query(sql, values) {
      queries.push({ sql, values });

      for (const responder of responders) {
        if (sql.includes(responder.match)) {
          return responder.result;
        }
      }

      return { rows: [], rowCount: 0 };
    }
  };
}

async function run() {
  // Default list query.
  const defaultPool = createCapturingPool();

  const defaultResponse = await listCountryNews(
    defaultPool,
    new URLSearchParams()
  );

  assert.equal(defaultResponse.statusCode, 200);
  assert.equal(
    defaultResponse.payload.filters.window_hours,
    72
  );
  assert.equal(
    defaultResponse.payload.filters.sort,
    "traffic_score"
  );
  assert.ok(
    "summary" in defaultResponse.payload
  );
  assert.ok(
    "total_count" in defaultResponse.payload
  );

  const defaultSql = defaultPool.queries[0].sql;

  const orderByClause =
    defaultSql.split("ORDER BY")[1];

  assert.ok(
    orderByClause
      .trim()
      .startsWith("cns.traffic_score DESC"),
    "Default order must be traffic_score DESC."
  );

  // Summary aggregates run against the whole filtered
  // window, not the visible page.
  const summarySql = defaultPool.queries[1].sql;

  assert.ok(
    summarySql.includes("breakout_count") &&
      summarySql.includes(
        "high_transformation_count"
      ) &&
      !summarySql.includes("LIMIT $"),
    "Summary must aggregate without pagination."
  );

  // Parameterized filters: SQL-injection shaped input
  // never reaches the SQL text.
  const injectionPool = createCapturingPool();

  await listCountryNews(
    injectionPool,
    new URLSearchParams({
      country_code: "JP",
      q: "Japan' OR 1=1 --"
    })
  );

  const injectionQuery = injectionPool.queries[0];

  assert.ok(
    !injectionQuery.sql.includes("1=1"),
    "Search input must never be interpolated into SQL."
  );

  assert.ok(
    injectionQuery.values.includes(
      "%Japan' OR 1=1 --%"
    ),
    "Search input must be passed as a bind value."
  );

  assert.ok(
    injectionQuery.values.includes("JP"),
    "country_code must be passed as a bind value."
  );

  // Archetype filter binds as JSONB containment.
  const archetypePool = createCapturingPool();

  await listCountryNews(
    archetypePool,
    new URLSearchParams({
      conflict_archetype: "SANCTIONS_BLOCKADE"
    })
  );

  const archetypeQuery = archetypePool.queries[0];

  assert.ok(
    archetypeQuery.values.includes(
      JSON.stringify(["SANCTIONS_BLOCKADE"])
    )
  );

  // List response selects vehicle anchor aggregates and
  // required fields.
  for (const column of [
    "country_code",
    "traffic_tier",
    "traffic_score",
    "mention_count",
    "publisher_count",
    "query_count",
    "transformation_tier",
    "transformation_potential",
    "conflict_archetypes",
    "vehicle_signal_count",
    "vehicle_views_total",
    "resolver_version"
  ]) {
    assert.ok(
      defaultSql.includes(column),
      `List query must select ${column}.`
    );
  }

  // The compact list never returns full evidence blobs.
  assert.ok(
    !defaultSql.includes("category_evidence") &&
      !defaultSql.includes("raw_metadata"),
    "Evidence stays on the detail endpoint."
  );

  // -------------------------------------------------------
  // POST /country-news/run: active-run conflict
  // -------------------------------------------------------

  const busyPool = createCapturingPool([
    {
      match: "FROM country_news_runs",
      result: {
        rows: [
          {
            id: "9",
            status: "RUNNING",
            created_at: "2026-07-12T00:00:00Z",
            started_at: "2026-07-12T00:00:01Z"
          }
        ],
        rowCount: 1
      }
    }
  ]);

  const busyResponse = await createCountryNewsRun(
    busyPool,
    {}
  );

  assert.equal(busyResponse.statusCode, 409);
  assert.equal(
    busyResponse.payload.error,
    "COUNTRY_NEWS_RUN_ACTIVE"
  );

  // Invalid country selection: requested codes without
  // recent vehicle signals are rejected.
  const noVehiclePool = createCapturingPool([
    {
      match: "WHERE status IN ('QUEUED', 'RUNNING')",
      result: { rows: [], rowCount: 0 }
    },
    {
      match: "SELECT DISTINCT c.code",
      result: {
        rows: [{ code: "JP" }],
        rowCount: 1
      }
    }
  ]);

  const partialResponse = await createCountryNewsRun(
    noVehiclePool,
    { country_codes: ["JP", "DE"] }
  );

  assert.equal(partialResponse.statusCode, 400);
  assert.equal(
    partialResponse.payload.error,
    "INVALID_COUNTRY_SELECTION"
  );
  assert.deepEqual(
    partialResponse.payload.invalid_country_codes,
    ["DE"]
  );

  // Successful queue.
  const queuePool = createCapturingPool([
    {
      match: "WHERE status IN ('QUEUED', 'RUNNING')",
      result: { rows: [], rowCount: 0 }
    },
    {
      match: "INSERT INTO country_news_runs",
      result: {
        rows: [
          {
            id: "1",
            status: "QUEUED",
            request_payload: {},
            country_count: 0,
            created_at: "2026-07-12T00:00:00Z"
          }
        ],
        rowCount: 1
      }
    }
  ]);

  const queueResponse = await createCountryNewsRun(
    queuePool,
    { max_countries: 3 }
  );

  assert.equal(queueResponse.statusCode, 202);
  assert.equal(
    queueResponse.payload.data.status,
    "QUEUED"
  );

  const insertQuery = queuePool.queries.find(
    query =>
      query.sql.includes(
        "INSERT INTO country_news_runs"
      )
  );

  assert.ok(insertQuery);

  const storedPayload = JSON.parse(
    insertQuery.values[0]
  );

  assert.equal(storedPayload.max_countries, 3);
  assert.equal(storedPayload.max_age_hours, 72);

  // -------------------------------------------------------
  // Detail: not found
  // -------------------------------------------------------

  const missingPool = createCapturingPool();

  const missingResponse = await getCountryNewsDetail(
    missingPool,
    "12345"
  );

  assert.equal(missingResponse.statusCode, 404);
  assert.equal(
    missingResponse.payload.error,
    "COUNTRY_NEWS_NOT_FOUND"
  );

  // Detail query includes evidence + mentions ordering.
  const detailPool = createCapturingPool([
    {
      match: "FROM country_news_signals cns",
      result: {
        rows: [
          {
            id: "7",
            country_code: "JP",
            title: "Fixture story"
          }
        ],
        rowCount: 1
      }
    }
  ]);

  const detailResponse = await getCountryNewsDetail(
    detailPool,
    "7"
  );

  assert.equal(detailResponse.statusCode, 200);
  assert.ok(
    Array.isArray(detailResponse.payload.data.mentions)
  );

  const detailSql = detailPool.queries[0].sql;

  for (const column of [
    "category_evidence",
    "country_evidence",
    "raw_metadata"
  ]) {
    assert.ok(
      detailSql.includes(column),
      `Detail query must select ${column}.`
    );
  }

  const mentionSql = detailPool.queries[1].sql;

  assert.ok(
    mentionSql.includes(
      "published_at DESC NULLS LAST"
    ) &&
      mentionSql.includes("feed_rank ASC"),
    "Mentions must order by published_at DESC, feed_rank ASC."
  );

  console.log(
    "TASK 3.3D COUNTRY NEWS API TESTS PASSED"
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

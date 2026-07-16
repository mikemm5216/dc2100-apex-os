const assert = require("node:assert/strict");

const { newDb } = require("pg-mem");

const {
  NEWS_SORTS,
  createCountryNewsRun,
  getCountryDualVideoSignal,
  getCountryNewsDetail,
  listCountryDualVideoSignals,
  listCountryNews,
  parseCountryDualVideoQuery,
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

// ---------------------------------------------------------
// Country Dual-Video Signal Pack: query validation
// ---------------------------------------------------------

function runDualVideoQueryValidationTests() {
  const defaults = parseCountryDualVideoQuery(
    new URLSearchParams()
  );

  assert.equal(defaults.value.windowHours, 168);
  assert.equal(defaults.value.format, "SHORTS");
  assert.equal(defaults.value.status, "COMPLETE");
  assert.equal(defaults.value.limit, 10);

  const invalidStatus = parseCountryDualVideoQuery(
    new URLSearchParams({ status: "MAYBE" })
  );
  assert.equal(invalidStatus.error.statusCode, 400);

  const invalidFormat = parseCountryDualVideoQuery(
    new URLSearchParams({ format: "LONG" })
  );
  assert.equal(invalidFormat.error.statusCode, 400);

  console.log(
    "COUNTRY DUAL VIDEO QUERY VALIDATION TESTS PASSED"
  );
}

// ---------------------------------------------------------
// Country Dual-Video Signal Pack: correctness (pg-mem)
// ---------------------------------------------------------

async function buildCountryDualVideoFixturePool() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  await pool.query(`
    CREATE TABLE countries (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE vehicles (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      manufacturer TEXT
    );

    CREATE TABLE signals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      external_id TEXT,
      resolved_country_id BIGINT,
      resolved_vehicle_id BIGINT,
      entity_resolution_status TEXT NOT NULL DEFAULT 'UNRESOLVED',
      views BIGINT NOT NULL DEFAULT 0,
      views_per_hour NUMERIC(18, 4),
      views_per_day NUMERIC(18, 2),
      title TEXT,
      url TEXT,
      thumbnail_url TEXT,
      channel_title TEXT,
      published_at TIMESTAMPTZ,
      is_short BOOLEAN NOT NULL DEFAULT FALSE,
      entity_evidence JSONB,
      entity_match_method TEXT
    );

    CREATE TABLE country_news_signals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      country_id BIGINT NOT NULL,
      category TEXT NOT NULL DEFAULT 'OTHER',
      keywords JSONB NOT NULL DEFAULT '[]'::jsonb,
      conflict_archetypes JSONB NOT NULL DEFAULT '[]'::jsonb,
      canonical_title TEXT,
      title TEXT NOT NULL,
      representative_url TEXT NOT NULL,
      traffic_score NUMERIC(6, 2) NOT NULL DEFAULT 0,
      published_at TIMESTAMPTZ,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE country_event_video_signals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      country_news_signal_id BIGINT NOT NULL,
      country_id BIGINT NOT NULL,
      signal_id BIGINT NOT NULL,
      matched_country_term TEXT,
      matched_event_term TEXT,
      views_per_hour_at_match NUMERIC(18, 4),
      relevance_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT country_event_video_signals_unique
        UNIQUE (country_news_signal_id, signal_id)
    );
  `);

  async function insertCountry(code, name) {
    const result = await pool.query(
      `INSERT INTO countries (code, name) VALUES ($1, $2) RETURNING id`,
      [code, name]
    );
    return result.rows[0].id;
  }

  async function insertVehicle(code, name, manufacturer) {
    const result = await pool.query(
      `INSERT INTO vehicles (code, name, manufacturer)
       VALUES ($1, $2, $3) RETURNING id`,
      [code, name, manufacturer]
    );
    return result.rows[0].id;
  }

  let externalIdCounter = 0;

  async function insertSignal({
    resolvedCountryId = null,
    resolvedVehicleId = null,
    resolutionStatus = "UNRESOLVED",
    views,
    viewsPerHour = null,
    title,
    isShort = true,
    publishedAt
  }) {
    externalIdCounter += 1;

    const result = await pool.query(
      `INSERT INTO signals
        (external_id, resolved_country_id, resolved_vehicle_id,
         entity_resolution_status, views, views_per_hour,
         title, url, channel_title, published_at, is_short)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $7, $9, $10)
       RETURNING id`,
      [
        `ext-${externalIdCounter}`,
        resolvedCountryId,
        resolvedVehicleId,
        resolutionStatus,
        views,
        viewsPerHour,
        title,
        `https://y/${externalIdCounter}`,
        publishedAt,
        isShort
      ]
    );

    return result.rows[0].id;
  }

  async function insertCountryNewsSignal({
    countryId,
    category,
    keywords = [],
    title,
    publishedAt
  }) {
    const result = await pool.query(
      `INSERT INTO country_news_signals
        (country_id, category, keywords, title, representative_url,
         traffic_score, published_at)
       VALUES ($1, $2, $3::jsonb, $4, $5, 80, $6)
       RETURNING id`,
      [
        countryId,
        category,
        JSON.stringify(keywords),
        title,
        `https://news/${title.slice(0, 10)}`,
        publishedAt
      ]
    );

    return result.rows[0].id;
  }

  const now = new Date();

  const germany = await insertCountry("DE", "Germany");
  const japan = await insertCountry("JP", "Japan");
  const italy = await insertCountry("IT", "Italy");
  const france = await insertCountry("FR", "France");

  const bmwM3 = await insertVehicle("BMWM3", "M3", "BMW");
  const toyotaSupra = await insertVehicle(
    "TOYOTASUPRA",
    "Supra",
    "Toyota"
  );

  // Germany: vehicle-identity candidates -- the HIGHER-viewed
  // one must win, never a sum of both.
  const bmwTopSignalId = await insertSignal({
    resolvedCountryId: germany,
    resolvedVehicleId: bmwM3,
    resolutionStatus: "RESOLVED",
    views: 500000,
    title: "BMW M3 Nurburgring Lap Record",
    publishedAt: now
  });
  await insertSignal({
    resolvedCountryId: germany,
    resolvedVehicleId: bmwM3,
    resolutionStatus: "RESOLVED",
    views: 100000,
    title: "BMW M3 Track Day",
    publishedAt: now
  });

  // A car-culture video whose resolved_country_id is Japan
  // (i.e. NOT Germany) but whose TITLE mentions Germany + a
  // war keyword. Germany's event video must come from THIS
  // signal, proving event-country resolution never consults
  // signals.resolved_country_id.
  const germanyEventSignalLowVph = await insertSignal({
    resolvedCountryId: japan,
    resolvedVehicleId: null,
    resolutionStatus: "NOT_APPLICABLE",
    views: 400000,
    viewsPerHour: 50,
    title: "German Military Vehicle Convoy Drives Through War Zone",
    publishedAt: now
  });

  // A second candidate for the SAME event, lower absolute
  // views but higher views_per_hour -- this one must win the
  // event-video role (ranked by velocity, never raw SUM/total).
  const germanyEventSignalHighVph = await insertSignal({
    resolvedCountryId: null,
    resolvedVehicleId: null,
    resolutionStatus: "UNRESOLVED",
    views: 90000,
    viewsPerHour: 900,
    title: "Germany War Museum Tank Restoration",
    publishedAt: now
  });

  const germanyNewsId = await insertCountryNewsSignal({
    countryId: germany,
    category: "WAR_SECURITY",
    keywords: ["war"],
    title: "Germany increases defense budget amid war fears",
    publishedAt: now
  });

  // Japan: vehicle identity present, but its news signal has
  // no matchable keywords/category rule -- must be VEHICLE_ONLY.
  const supraSignalId = await insertSignal({
    resolvedCountryId: japan,
    resolvedVehicleId: toyotaSupra,
    resolutionStatus: "RESOLVED",
    views: 300000,
    title: "Toyota Supra Drift Japan",
    publishedAt: now
  });

  await insertCountryNewsSignal({
    countryId: japan,
    category: "OTHER",
    keywords: [],
    title: "Japan hosts a cultural festival",
    publishedAt: now
  });

  // Italy: no vehicle-identity signal at all, but an event
  // video exists and matches -- must be EVENT_ONLY.
  await insertCountryNewsSignal({
    countryId: italy,
    category: "DISASTER_CLIMATE",
    keywords: ["earthquake"],
    title: "Italy hit by earthquake",
    publishedAt: now
  });

  await insertSignal({
    resolvedCountryId: null,
    resolvedVehicleId: null,
    resolutionStatus: "UNRESOLVED",
    views: 50000,
    viewsPerHour: 20,
    title: "Italy Earthquake Aftermath Footage",
    publishedAt: now
  });

  // France: a news signal exists but NO candidate video
  // matches it, and there is no vehicle-identity signal
  // either -- must be NO_MATCH.
  await insertCountryNewsSignal({
    countryId: france,
    category: "SANCTIONS_TRADE",
    keywords: ["tariff"],
    title: "France pushes new tariff policy",
    publishedAt: now
  });

  return {
    pool,
    ids: {
      germany,
      japan,
      italy,
      france,
      bmwTopSignalId: String(bmwTopSignalId),
      germanyEventSignalLowVph: String(
        germanyEventSignalLowVph
      ),
      germanyEventSignalHighVph: String(
        germanyEventSignalHighVph
      ),
      supraSignalId: String(supraSignalId)
    }
  };
}

async function runCountryDualVideoCorrectnessTests() {
  const { pool, ids } =
    await buildCountryDualVideoFixturePool();

  const allResult = await listCountryDualVideoSignals(
    pool,
    new URLSearchParams({ status: "ALL" })
  );

  assert.equal(allResult.statusCode, 200);

  const packs = allResult.payload.data;
  const countryIds = packs.map(pack => pack.country_id);

  // Every country appears exactly once.
  assert.equal(
    new Set(countryIds).size,
    countryIds.length,
    "Each country must appear exactly once."
  );

  const germanyPack = packs.find(
    pack => pack.country_code === "DE"
  );
  const japanPack = packs.find(
    pack => pack.country_code === "JP"
  );
  const italyPack = packs.find(
    pack => pack.country_code === "IT"
  );
  const francePack = packs.find(
    pack => pack.country_code === "FR"
  );

  // 1 + 4 + 6: vehicle-identity video preserved, single video,
  // never a SUM of Germany's two BMW signals (500,000 +
  // 100,000 = 600,000 must never appear).
  assert.equal(germanyPack.status, "COMPLETE");
  assert.equal(
    germanyPack.country_vehicle_identity_video.signal_id,
    ids.bmwTopSignalId
  );
  assert.equal(
    Number(
      germanyPack.country_vehicle_identity_video.video_views
    ),
    500000
  );
  assert.notEqual(
    Number(
      germanyPack.country_vehicle_identity_video.video_views
    ),
    600000,
    "Vehicle identity video must never be a SUM of multiple videos."
  );

  // 2: current event video preserved, and ranked by
  // views_per_hour (900 > 50), not raw views (400,000 > 90,000).
  assert.equal(
    germanyPack.country_current_event_video.signal_id,
    ids.germanyEventSignalHighVph,
    "Event video must be ranked by views_per_hour, not raw views."
  );

  // 3: vehicle identity and event video are independent roles
  // that coexist -- neither replaced the other.
  assert.notEqual(
    germanyPack.country_vehicle_identity_video.signal_id,
    germanyPack.country_current_event_video.signal_id
  );

  // 4: vehicle-origin country was never used as the event
  // country -- the winning event signal's OWN resolved_country_id
  // was Japan (or null), yet it was correctly attached to
  // Germany's event because the match is driven entirely by
  // country_news_signals.country_id + title text.
  assert.equal(
    germanyPack.country_current_event_video
      .country_news_signal_id,
    String(
      (
        await pool.query(
          `SELECT id FROM country_news_signals WHERE country_id = $1`,
          [ids.germany]
        )
      ).rows[0].id
    )
  );

  // 8: COMPLETE / VEHICLE_ONLY / EVENT_ONLY / NO_MATCH.
  assert.equal(japanPack.status, "VEHICLE_ONLY");
  assert.equal(
    japanPack.country_vehicle_identity_video.signal_id,
    ids.supraSignalId
  );
  assert.equal(japanPack.country_current_event_video, null);

  assert.equal(italyPack.status, "EVENT_ONLY");
  assert.equal(italyPack.country_vehicle_identity_video, null);
  assert.ok(italyPack.country_current_event_video);

  assert.equal(francePack.status, "NO_MATCH");
  assert.equal(francePack.country_vehicle_identity_video, null);
  assert.equal(francePack.country_current_event_video, null);

  // Default list (status=COMPLETE) must only return Germany.
  const completeOnly = await listCountryDualVideoSignals(
    pool,
    new URLSearchParams()
  );

  assert.equal(completeOnly.payload.data.length, 1);
  assert.equal(
    completeOnly.payload.data[0].country_code,
    "DE"
  );

  // 9: shared_signal -- construct a country whose vehicle
  // identity video is the SAME signal as its event video.
  // Reuse Japan's Supra signal as an event match by adding a
  // matching Japan news signal + retitling the Supra signal to
  // mention Japan + a matched keyword.
  await pool.query(
    `UPDATE signals SET title = 'Japan Earthquake Toyota Supra Rescue Convoy'
     WHERE id = $1`,
    [ids.supraSignalId]
  );

  await pool.query(
    `DELETE FROM country_news_signals WHERE country_id = $1`,
    [ids.japan]
  );

  await insertCountryNewsSignalHelper(pool, {
    countryId: ids.japan,
    category: "DISASTER_CLIMATE",
    keywords: ["earthquake"],
    title: "Japan hit by earthquake",
    publishedAt: new Date()
  });

  const sharedResult = await listCountryDualVideoSignals(
    pool,
    new URLSearchParams({ status: "ALL" })
  );

  const japanSharedPack = sharedResult.payload.data.find(
    pack => pack.country_code === "JP"
  );

  assert.equal(japanSharedPack.status, "COMPLETE");
  assert.equal(japanSharedPack.shared_signal, true);
  assert.equal(
    japanSharedPack.country_vehicle_identity_video.signal_id,
    japanSharedPack.country_current_event_video.signal_id
  );

  // Detail endpoint for a country not in scope at all.
  const missingCountry = await pool.query(
    `INSERT INTO countries (code, name) VALUES ('ES', 'Spain') RETURNING id`
  );

  const detailResult = await getCountryDualVideoSignal(
    pool,
    String(missingCountry.rows[0].id),
    new URLSearchParams()
  );

  assert.equal(detailResult.statusCode, 200);
  assert.equal(detailResult.payload.data.status, "NO_MATCH");

  const notFoundResult = await getCountryDualVideoSignal(
    pool,
    "999999",
    new URLSearchParams()
  );

  assert.equal(notFoundResult.statusCode, 404);

  console.log(
    "COUNTRY DUAL VIDEO CORRECTNESS TESTS PASSED"
  );
}

async function insertCountryNewsSignalHelper(
  pool,
  { countryId, category, keywords, title, publishedAt }
) {
  await pool.query(
    `INSERT INTO country_news_signals
      (country_id, category, keywords, title, representative_url,
       traffic_score, published_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, 80, $6)`,
    [
      countryId,
      category,
      JSON.stringify(keywords),
      title,
      `https://news/${title.slice(0, 10)}`,
      publishedAt
    ]
  );
}

async function main() {
  await run();
  runDualVideoQueryValidationTests();
  await runCountryDualVideoCorrectnessTests();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

const assert = require("node:assert/strict");

const { newDb } = require("pg-mem");

const {
  PERSON_SORTS,
  createPersonRadarRun,
  getPersonDualVideoSignal,
  getPersonRadarDetail,
  listPersonDualVideoSignals,
  listPersonRadar,
  parsePersonDualVideoQuery,
  parsePersonRadarQuery,
  validatePersonRunPayload
} = require("../lib/person/api");

// ---------------------------------------------------------
// Run payload validation
// ---------------------------------------------------------

const validRun = validatePersonRunPayload({
  max_people: 5,
  vehicle_window_days: 14,
  max_queries_per_person: 2,
  max_items_per_query: 10,
  max_age_hours: 72
});

assert.deepEqual(validRun.value, {
  max_people: 5,
  vehicle_window_days: 14,
  max_queries_per_person: 2,
  max_items_per_query: 10,
  max_age_hours: 72,
  person_ids: null,
  person_slugs: null
});

// Defaults fill in when fields are omitted.
const defaultRun = validatePersonRunPayload({});

assert.deepEqual(defaultRun.value, {
  max_people: 20,
  vehicle_window_days: 14,
  max_queries_per_person: 3,
  max_items_per_query: 20,
  max_age_hours: 72,
  person_ids: null,
  person_slugs: null
});

for (const invalidBody of [
  { max_people: 0 },
  { max_people: 31 },
  { vehicle_window_days: 10 },
  { max_queries_per_person: 5 },
  { max_items_per_query: 4 },
  { max_items_per_query: 51 },
  { max_age_hours: 48 },
  { person_ids: [] },
  { person_ids: ["abc"] },
  { person_slugs: ["UPPER"] },
  { person_slugs: ["bad slug"] },
  null,
  []
]) {
  const result = validatePersonRunPayload(invalidBody);

  assert.equal(
    result.error?.statusCode,
    400,
    `Payload ${JSON.stringify(invalidBody)} must be rejected.`
  );
}

const slugRun = validatePersonRunPayload({
  person_slugs: ["lei-jun", "elon-musk", "lei-jun"]
});

assert.deepEqual(
  slugRun.value.person_slugs,
  ["lei-jun", "elon-musk"]
);

// ---------------------------------------------------------
// Query parsing defaults
// ---------------------------------------------------------

const defaults = parsePersonRadarQuery(
  new URLSearchParams()
);

assert.equal(defaults.value.windowHours, 168);
assert.equal(defaults.value.sort, "traffic_score");
assert.equal(defaults.value.trafficTier, "ALL");
assert.equal(defaults.value.roleCategory, "ALL");
assert.equal(defaults.value.relationType, "ALL");
assert.equal(
  defaults.value.transformationTier,
  "ALL"
);
assert.equal(
  defaults.value.attentionArchetype,
  "ALL"
);
assert.equal(defaults.value.limit, 100);
assert.equal(defaults.value.offset, 0);

assert.match(
  PERSON_SORTS.traffic_score.trim(),
  /^pts\.traffic_score DESC/
);

// ---------------------------------------------------------
// Query parsing validation
// ---------------------------------------------------------

const parsedFilters = parsePersonRadarQuery(
  new URLSearchParams({
    window_hours: "24",
    role_category: "founder_executive",
    relation_type: "founder",
    vehicle_brand: "Xiaomi",
    vehicle_model: "SU7 Ultra",
    country_code: "cn",
    traffic_tier: "breakout",
    transformation_tier: "high",
    attention_archetype: "technology_vision",
    sort: "vehicle_views",
    limit: "50",
    offset: "10",
    q: "lei"
  })
);

assert.equal(parsedFilters.value.windowHours, 24);
assert.equal(
  parsedFilters.value.roleCategory,
  "FOUNDER_EXECUTIVE"
);
assert.equal(
  parsedFilters.value.relationType,
  "FOUNDER"
);
assert.equal(
  parsedFilters.value.vehicleBrand,
  "Xiaomi"
);
assert.equal(
  parsedFilters.value.vehicleModel,
  "SU7 Ultra"
);
assert.equal(parsedFilters.value.countryCode, "CN");
assert.equal(
  parsedFilters.value.trafficTier,
  "BREAKOUT"
);
assert.equal(
  parsedFilters.value.transformationTier,
  "HIGH"
);
assert.equal(
  parsedFilters.value.attentionArchetype,
  "TECHNOLOGY_VISION"
);
assert.equal(
  parsedFilters.value.sort,
  "vehicle_views"
);
assert.equal(parsedFilters.value.limit, 50);
assert.equal(parsedFilters.value.offset, 10);
assert.equal(parsedFilters.value.search, "lei");

for (const [key, value] of [
  ["window_hours", "48"],
  ["role_category", "CELEBRITY"],
  ["relation_type", "FRIEND"],
  ["country_code", "CHN"],
  ["country_code", "';"],
  ["traffic_tier", "VIRAL"],
  ["transformation_tier", "EXTREME"],
  ["attention_archetype", "ALIEN_INVASION"],
  ["sort", "views"],
  ["limit", "0"],
  ["limit", "101"],
  ["offset", "-1"]
]) {
  const result = parsePersonRadarQuery(
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

  const defaultResponse = await listPersonRadar(
    defaultPool,
    new URLSearchParams()
  );

  assert.equal(defaultResponse.statusCode, 200);
  assert.equal(
    defaultResponse.payload.filters.window_hours,
    168
  );
  assert.equal(
    defaultResponse.payload.filters.sort,
    "traffic_score"
  );
  assert.ok("summary" in defaultResponse.payload);
  assert.ok(
    "total_count" in defaultResponse.payload
  );

  const defaultSql = defaultPool.queries[0].sql;

  const orderByClause =
    defaultSql.split("ORDER BY")[1];

  assert.ok(
    orderByClause
      .trim()
      .startsWith("pts.traffic_score DESC"),
    "Default order must be traffic_score DESC."
  );

  assert.ok(
    orderByClause.includes(
      "pts.vehicle_views_total DESC"
    ),
    "Default order must fall back to vehicle views."
  );

  // Summary aggregates run against the whole filtered
  // window, not the visible page.
  const summarySql = defaultPool.queries[1].sql;

  assert.ok(
    summarySql.includes("visible_people") &&
      summarySql.includes("high_potential") &&
      summarySql.includes("direct_mention_people") &&
      summarySql.includes("active_brands") &&
      !summarySql.includes("LIMIT $"),
    "Summary must aggregate without pagination."
  );

  // Parameterized filters: SQL-injection shaped input
  // never reaches the SQL text.
  const injectionPool = createCapturingPool();

  await listPersonRadar(
    injectionPool,
    new URLSearchParams({
      vehicle_brand: "Tesla' OR 1=1 --",
      vehicle_model: "SU7' OR 1=1 --",
      q: "Jun' OR 1=1 --"
    })
  );

  const injectionQuery = injectionPool.queries[0];

  assert.ok(
    !injectionQuery.sql.includes("1=1"),
    "User input must never be interpolated into SQL."
  );

  assert.ok(
    injectionQuery.values.includes(
      "Tesla' OR 1=1 --"
    ),
    "vehicle_brand must be passed as a bind value."
  );

  assert.ok(
    injectionQuery.values.includes(
      "SU7' OR 1=1 --"
    ),
    "vehicle_model must be passed as a bind value."
  );

  assert.ok(
    injectionQuery.values.includes(
      "%Jun' OR 1=1 --%"
    ),
    "Search input must be passed as a bind value."
  );

  // Archetype filter binds as JSONB containment.
  const archetypePool = createCapturingPool();

  await listPersonRadar(
    archetypePool,
    new URLSearchParams({
      attention_archetype: "CONTROVERSY"
    })
  );

  assert.ok(
    archetypePool.queries[0].values.includes(
      JSON.stringify(["CONTROVERSY"])
    )
  );

  // List response selects required fields.
  for (const column of [
    "person_slug",
    "canonical_name",
    "role_category",
    "linked_brands",
    "linked_models",
    "relation_types",
    "link_confidence",
    "traffic_tier",
    "traffic_score",
    "vehicle_attention_score",
    "news_coverage_score",
    "vehicle_views_total",
    "direct_vehicle_mention_count",
    "news_mention_count",
    "publisher_count",
    "attention_archetypes",
    "transformation_tier",
    "transformation_potential",
    "representative_headline",
    "resolver_version"
  ]) {
    assert.ok(
      defaultSql.includes(column),
      `List query must select ${column}.`
    );
  }

  // The compact list never returns full evidence blobs.
  assert.ok(
    !defaultSql.includes("raw_metadata") &&
      !defaultSql.includes("link_evidence"),
    "Evidence stays on the detail endpoint."
  );

  // -------------------------------------------------------
  // POST /person-radar/run: active-run conflict
  // -------------------------------------------------------

  const busyPool = createCapturingPool([
    {
      match: "FROM person_radar_runs",
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

  const busyResponse = await createPersonRadarRun(
    busyPool,
    {}
  );

  assert.equal(busyResponse.statusCode, 409);
  assert.equal(
    busyResponse.payload.error,
    "PERSON_RADAR_RUN_ACTIVE"
  );

  // Successful queue.
  const queuePool = createCapturingPool([
    {
      match: "WHERE status IN ('QUEUED', 'RUNNING')",
      result: { rows: [], rowCount: 0 }
    },
    {
      match: "INSERT INTO person_radar_runs",
      result: {
        rows: [
          {
            id: "1",
            status: "QUEUED",
            request_payload: {},
            person_count: 0,
            created_at: "2026-07-12T00:00:00Z"
          }
        ],
        rowCount: 1
      }
    }
  ]);

  const queueResponse = await createPersonRadarRun(
    queuePool,
    { max_people: 5, max_queries_per_person: 2 }
  );

  assert.equal(queueResponse.statusCode, 202);
  assert.equal(
    queueResponse.payload.data.status,
    "QUEUED"
  );

  const insertQuery = queuePool.queries.find(
    query =>
      query.sql.includes(
        "INSERT INTO person_radar_runs"
      )
  );

  assert.ok(insertQuery);

  const storedPayload = JSON.parse(
    insertQuery.values[0]
  );

  assert.equal(storedPayload.max_people, 5);
  assert.equal(
    storedPayload.max_queries_per_person,
    2
  );
  assert.equal(storedPayload.max_age_hours, 72);

  // -------------------------------------------------------
  // Detail: not found
  // -------------------------------------------------------

  const missingPool = createCapturingPool();

  const missingResponse = await getPersonRadarDetail(
    missingPool,
    "12345"
  );

  assert.equal(missingResponse.statusCode, 404);
  assert.equal(
    missingResponse.payload.error,
    "PERSON_RADAR_NOT_FOUND"
  );

  // Detail query includes evidence + links + mentions.
  const detailPool = createCapturingPool([
    {
      match: "FROM person_traffic_signals pts",
      result: {
        rows: [
          {
            id: "7",
            person_id: "3",
            canonical_name: "Lei Jun"
          }
        ],
        rowCount: 1
      }
    }
  ]);

  const detailResponse = await getPersonRadarDetail(
    detailPool,
    "7"
  );

  assert.equal(detailResponse.statusCode, 200);
  assert.ok(
    Array.isArray(
      detailResponse.payload.data.vehicle_links
    )
  );
  assert.ok(
    Array.isArray(
      detailResponse.payload.data.mentions
    )
  );

  const detailSql = detailPool.queries[0].sql;

  for (const column of [
    "person_aliases",
    "person_metadata",
    "raw_metadata"
  ]) {
    assert.ok(
      detailSql.includes(column),
      `Detail query must select ${column}.`
    );
  }

  const linksSql = detailPool.queries[1].sql;

  assert.ok(
    linksSql.includes("link_evidence") &&
      linksSql.includes("locked"),
    "Link evidence and lock state must be returned."
  );

  const mentionSql = detailPool.queries[2].sql;

  assert.ok(
    mentionSql.includes(
      "published_at DESC NULLS LAST"
    ) &&
      mentionSql.includes("feed_rank ASC") &&
      mentionSql.includes("person_match_method"),
    "Mentions must order by published_at DESC, feed_rank ASC."
  );

  console.log(
    "TASK 3.3E PERSON API TESTS PASSED"
  );
}

// ---------------------------------------------------------
// Person Dual-Video Signal Pack: query validation
// ---------------------------------------------------------

function runPersonDualVideoQueryValidationTests() {
  const defaults = parsePersonDualVideoQuery(
    new URLSearchParams()
  );

  assert.equal(defaults.value.historyScope, "ALL_TIME");
  assert.equal(defaults.value.format, "SHORTS");
  assert.equal(defaults.value.status, "COMPLETE");
  assert.equal(defaults.value.limit, 10);

  const invalidStatus = parsePersonDualVideoQuery(
    new URLSearchParams({ status: "MAYBE" })
  );
  assert.equal(invalidStatus.error.statusCode, 400);

  const invalidScope = parsePersonDualVideoQuery(
    new URLSearchParams({ history_scope: "FIVE_YEARS" })
  );
  assert.equal(invalidScope.error.statusCode, 400);

  console.log(
    "PERSON DUAL VIDEO QUERY VALIDATION TESTS PASSED"
  );
}

// ---------------------------------------------------------
// Person Dual-Video Signal Pack: correctness (pg-mem)
// ---------------------------------------------------------

async function buildPersonDualVideoFixturePool() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  await pool.query(`
    CREATE TABLE people (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      slug TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
      role_category TEXT NOT NULL DEFAULT 'OTHER',
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE vehicles (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      code TEXT,
      name TEXT,
      manufacturer TEXT
    );

    CREATE TABLE vehicle_person_links (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      person_id BIGINT NOT NULL,
      vehicle_id BIGINT,
      vehicle_brand TEXT,
      vehicle_series TEXT,
      vehicle_model TEXT,
      relation_type TEXT NOT NULL DEFAULT 'OTHER',
      link_confidence NUMERIC(5, 4),
      link_evidence JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE signals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      external_id TEXT,
      resolved_vehicle_id BIGINT,
      vehicle_brand TEXT,
      vehicle_series TEXT,
      vehicle_model TEXT,
      entity_resolution_status TEXT NOT NULL DEFAULT 'UNRESOLVED',
      views BIGINT NOT NULL DEFAULT 0,
      title TEXT,
      url TEXT,
      thumbnail_url TEXT,
      channel_title TEXT,
      published_at TIMESTAMPTZ,
      is_short BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE person_direct_video_signals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      person_id BIGINT NOT NULL,
      signal_id BIGINT NOT NULL,
      matched_alias TEXT NOT NULL,
      direct_mention_field TEXT NOT NULL,
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT person_direct_video_signals_unique
        UNIQUE (person_id, signal_id)
    );
  `);

  async function insertPerson(slug, canonicalName, aliases = []) {
    const result = await pool.query(
      `INSERT INTO people (slug, canonical_name, aliases)
       VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [slug, canonicalName, JSON.stringify(aliases)]
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

  async function insertLink({
    personId,
    vehicleId = null,
    vehicleBrand = null,
    vehicleSeries = null,
    vehicleModel = null,
    relationType = "OTHER"
  }) {
    await pool.query(
      `INSERT INTO vehicle_person_links
        (person_id, vehicle_id, vehicle_brand, vehicle_series,
         vehicle_model, relation_type)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        personId,
        vehicleId,
        vehicleBrand,
        vehicleSeries,
        vehicleModel,
        relationType
      ]
    );
  }

  let externalIdCounter = 0;

  async function insertSignal({
    resolvedVehicleId = null,
    vehicleBrand = null,
    vehicleSeries = null,
    vehicleModel = null,
    resolutionStatus = "UNRESOLVED",
    views,
    title,
    publishedAt
  }) {
    externalIdCounter += 1;

    const result = await pool.query(
      `INSERT INTO signals
        (external_id, resolved_vehicle_id, vehicle_brand, vehicle_series,
         vehicle_model, entity_resolution_status, views, title, url,
         channel_title, published_at, is_short)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $10, TRUE)
       RETURNING id`,
      [
        `ext-${externalIdCounter}`,
        resolvedVehicleId,
        vehicleBrand,
        vehicleSeries,
        vehicleModel,
        resolutionStatus,
        views,
        title,
        `https://y/${externalIdCounter}`,
        publishedAt
      ]
    );

    return result.rows[0].id;
  }

  const now = new Date();

  const gtr = await insertVehicle("NISSANGTR", "GT-R", "Nissan");
  const rs3 = await insertVehicle("AUDIRS3", "RS3", "Audi");

  // Driver A: EXACT association + a separate, lower-viewed
  // direct-mention video -- COMPLETE, not shared.
  const driverA = await insertPerson(
    "max-driver",
    "Max Driver",
    ["Maxy"]
  );
  await insertLink({
    personId: driverA,
    vehicleId: gtr,
    relationType: "RACING_DRIVER"
  });

  const driverATopAssoc = await insertSignal({
    resolvedVehicleId: gtr,
    vehicleBrand: "Nissan",
    vehicleModel: "GT-R",
    resolutionStatus: "RESOLVED",
    views: 800000,
    title: "GTR Nurburgring Lap",
    publishedAt: now
  });
  await insertSignal({
    resolvedVehicleId: gtr,
    vehicleBrand: "Nissan",
    vehicleModel: "GT-R",
    resolutionStatus: "RESOLVED",
    views: 100000,
    title: "GTR Track Day",
    publishedAt: now
  });

  const driverADirect = await insertSignal({
    resolvedVehicleId: null,
    resolutionStatus: "UNRESOLVED",
    views: 50000,
    title: "Max Driver Onboard Lap",
    publishedAt: now
  });

  // Driver B: BRAND_ASSOCIATION only, no direct mention video
  // anywhere -- ASSOCIATION_ONLY.
  const driverB = await insertPerson("ella-racer", "Ella Racer");
  await insertLink({
    personId: driverB,
    vehicleBrand: "Ford",
    relationType: "DRIVER"
  });
  const driverBAssoc = await insertSignal({
    vehicleBrand: "Ford",
    resolutionStatus: "BRAND_ONLY",
    views: 200000,
    title: "Ford Mustang Drift Show",
    publishedAt: now
  });

  // Driver C: direct mention only, no vehicle_person_links at
  // all -- DIRECT_ONLY.
  const driverC = await insertPerson(
    "sam-hooker",
    "Sam Hooker",
    ["Hook"]
  );
  const driverCDirect = await insertSignal({
    resolutionStatus: "UNRESOLVED",
    views: 300000,
    title: "Sam Hooker Sends It",
    publishedAt: now
  });

  // Driver D: nothing matches at all -- NO_MATCH.
  const driverD = await insertPerson(
    "nora-nomatch",
    "Nora NoMatch"
  );

  // Driver E: the SAME video serves as both the association
  // video (EXACT vehicle match) and the direct-mention video
  // (title contains the alias) -- COMPLETE + shared_signal.
  const driverE = await insertPerson(
    "vic-shared",
    "Vic Shared",
    ["Vic"]
  );
  await insertLink({
    personId: driverE,
    vehicleId: rs3,
    relationType: "DRIVER"
  });
  const driverESharedSignal = await insertSignal({
    resolvedVehicleId: rs3,
    vehicleBrand: "Audi",
    vehicleModel: "RS3",
    resolutionStatus: "RESOLVED",
    views: 900000,
    title: "Vic Shared Drives the New RS3",
    publishedAt: now
  });

  // Driver F: MODEL_ASSOCIATION tier -- link has no vehicle_id,
  // only brand + model.
  const driverF = await insertPerson(
    "model-match-driver",
    "Model Match Driver"
  );
  await insertLink({
    personId: driverF,
    vehicleBrand: "Audi",
    vehicleModel: "RS3",
    relationType: "OTHER"
  });
  const driverFModelAssoc = await insertSignal({
    vehicleBrand: "Audi",
    vehicleModel: "RS3",
    resolutionStatus: "RESOLVED",
    views: 700000,
    title: "Audi RS3 Track Review",
    publishedAt: now
  });

  // Driver G: SERIES_ASSOCIATION tier -- link has brand +
  // series but no specific model.
  const driverG = await insertPerson(
    "series-match-driver",
    "Series Match Driver"
  );
  await insertLink({
    personId: driverG,
    vehicleBrand: "Porsche",
    vehicleSeries: "911",
    relationType: "OTHER"
  });
  const driverGSeriesAssoc = await insertSignal({
    vehicleBrand: "Porsche",
    vehicleSeries: "911",
    vehicleModel: "911 Turbo",
    resolutionStatus: "RESOLVED",
    views: 250000,
    title: "Porsche 911 Turbo Review",
    publishedAt: now
  });

  return {
    pool,
    ids: {
      driverA: String(driverA),
      driverB: String(driverB),
      driverC: String(driverC),
      driverD: String(driverD),
      driverE: String(driverE),
      driverF: String(driverF),
      driverG: String(driverG),
      driverATopAssoc: String(driverATopAssoc),
      driverADirect: String(driverADirect),
      driverBAssoc: String(driverBAssoc),
      driverCDirect: String(driverCDirect),
      driverESharedSignal: String(driverESharedSignal),
      driverFModelAssoc: String(driverFModelAssoc),
      driverGSeriesAssoc: String(driverGSeriesAssoc)
    }
  };
}

async function runPersonDualVideoCorrectnessTests() {
  const { pool, ids } =
    await buildPersonDualVideoFixturePool();

  const allResult = await listPersonDualVideoSignals(
    pool,
    new URLSearchParams({ status: "ALL" })
  );

  assert.equal(allResult.statusCode, 200);

  const packs = allResult.payload.data;
  const personIds = packs.map(pack => pack.person_id);

  // 10: every person appears exactly once.
  assert.equal(
    new Set(personIds).size,
    personIds.length,
    "Each person must appear exactly once."
  );

  const packFor = id =>
    packs.find(pack => pack.person_id === id);

  const packA = packFor(ids.driverA);
  const packB = packFor(ids.driverB);
  const packC = packFor(ids.driverC);
  const packD = packFor(ids.driverD);
  const packE = packFor(ids.driverE);
  const packF = packFor(ids.driverF);
  const packG = packFor(ids.driverG);

  // 1 + 6 + 7: association-only video preserved, single video,
  // never a SUM of Driver A's two GT-R signals (800,000 +
  // 100,000 = 900,000 must never appear).
  assert.equal(packA.status, "COMPLETE");
  assert.equal(
    packA.person_association_video.signal_id,
    ids.driverATopAssoc
  );
  assert.equal(
    Number(packA.person_association_video.video_views),
    800000
  );
  assert.notEqual(
    Number(packA.person_association_video.video_views),
    900000,
    "Association video must never be a SUM of multiple videos."
  );
  assert.equal(
    packA.person_association_video.association_level,
    "EXACT"
  );
  assert.equal(
    packA.person_association_video.association_only,
    true
  );

  // 3: association-only video must not claim direct_mention
  // unless the title genuinely contains the person's name.
  assert.equal(
    packA.person_association_video.direct_mention,
    false,
    "GTR Nurburgring Lap does not mention Max Driver -- direct_mention must be false."
  );

  // 2: direct mention video preserved, independent role.
  assert.equal(
    packA.person_direct_hook_video.signal_id,
    ids.driverADirect
  );
  assert.equal(
    packA.person_direct_hook_video.direct_mention,
    true
  );
  assert.notEqual(
    packA.person_association_video.signal_id,
    packA.person_direct_hook_video.signal_id
  );

  // 5 + 8: brand association legal but tagged, ASSOCIATION_ONLY.
  assert.equal(packB.status, "ASSOCIATION_ONLY");
  assert.equal(
    packB.person_association_video.signal_id,
    ids.driverBAssoc
  );
  assert.equal(
    packB.person_association_video.association_level,
    "BRAND_ASSOCIATION"
  );
  assert.equal(packB.person_direct_hook_video, null);

  // 8: DIRECT_ONLY -- no vehicle_person_links at all.
  assert.equal(packC.status, "DIRECT_ONLY");
  assert.equal(
    packC.person_direct_hook_video.signal_id,
    ids.driverCDirect
  );
  assert.equal(packC.person_association_video, null);

  // 8: NO_MATCH.
  assert.equal(packD.status, "NO_MATCH");
  assert.equal(packD.person_association_video, null);
  assert.equal(packD.person_direct_hook_video, null);

  // 9: shared_signal -- the SAME video serves both roles.
  assert.equal(packE.status, "COMPLETE");
  assert.equal(packE.shared_signal, true);
  assert.equal(
    packE.person_association_video.signal_id,
    ids.driverESharedSignal
  );
  assert.equal(
    packE.person_direct_hook_video.signal_id,
    ids.driverESharedSignal
  );
  assert.equal(
    packE.person_association_video.direct_mention,
    true,
    "The shared video's association role must also report direct_mention = true."
  );

  // MODEL_ASSOCIATION and SERIES_ASSOCIATION tiers tagged
  // correctly.
  assert.equal(
    packF.person_association_video.association_level,
    "MODEL_ASSOCIATION"
  );
  assert.equal(
    packG.person_association_video.association_level,
    "SERIES_ASSOCIATION"
  );

  // Default list (status=COMPLETE) must only return Driver A
  // and Driver E.
  const completeOnly = await listPersonDualVideoSignals(
    pool,
    new URLSearchParams()
  );

  const completeIds = completeOnly.payload.data.map(
    pack => pack.person_id
  );

  assert.deepEqual(
    new Set(completeIds),
    new Set([ids.driverA, ids.driverE])
  );

  // Detail endpoint.
  const detailResult = await getPersonDualVideoSignal(
    pool,
    ids.driverA,
    new URLSearchParams()
  );

  assert.equal(detailResult.statusCode, 200);
  assert.equal(detailResult.payload.data.status, "COMPLETE");

  const notFoundResult = await getPersonDualVideoSignal(
    pool,
    "999999",
    new URLSearchParams()
  );

  assert.equal(notFoundResult.statusCode, 404);

  console.log(
    "PERSON DUAL VIDEO CORRECTNESS TESTS PASSED"
  );
}

async function main() {
  await run();
  runPersonDualVideoQueryValidationTests();
  await runPersonDualVideoCorrectnessTests();
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

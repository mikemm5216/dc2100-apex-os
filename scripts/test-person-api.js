const assert = require("node:assert/strict");

const {
  PERSON_SORTS,
  createPersonRadarRun,
  getPersonRadarDetail,
  listPersonRadar,
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

run().catch(error => {
  console.error(error);
  process.exit(1);
});

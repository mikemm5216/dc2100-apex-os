const assert = require("node:assert/strict");

const {
  createFusionRun,
  getFusionCandidateDetail,
  listFusionCandidates,
  validateFusionRunPayload
} = require("../lib/fusion/api");

// ---------------------------------------------------------
// Run payload validation
// ---------------------------------------------------------

const validRun = validateFusionRunPayload({
  max_vehicles: 10,
  vehicle_window_days: 7,
  news_window_hours: 72,
  max_news_per_vehicle: 2,
  max_people_per_vehicle: 2
});

assert.deepEqual(validRun.value, {
  max_vehicles: 10,
  vehicle_window_days: 7,
  news_window_hours: 72,
  max_news_per_vehicle: 2,
  max_people_per_vehicle: 2,
  vehicle_ids: null
});

const defaultRun = validateFusionRunPayload({});

assert.deepEqual(defaultRun.value, {
  max_vehicles: 25,
  vehicle_window_days: 14,
  news_window_hours: 168,
  max_news_per_vehicle: 3,
  max_people_per_vehicle: 3,
  vehicle_ids: null
});

for (const invalidBody of [
  { max_vehicles: 0 },
  { max_vehicles: 101 },
  { vehicle_window_days: 5 },
  { news_window_hours: 12 },
  { max_news_per_vehicle: 0 },
  { max_news_per_vehicle: 6 },
  { max_people_per_vehicle: 6 },
  { vehicle_ids: [] },
  { vehicle_ids: ["abc"] },
  null,
  []
]) {
  const result = validateFusionRunPayload(invalidBody);

  assert.equal(
    result.error?.statusCode,
    400,
    `Payload ${JSON.stringify(invalidBody)} must be rejected.`
  );
}

const vehicleIdRun = validateFusionRunPayload({
  vehicle_ids: ["12", "34", "12"]
});

assert.deepEqual(
  vehicleIdRun.value.vehicle_ids,
  ["12", "34"]
);

// ---------------------------------------------------------
// createFusionRun: refuses a second run while one is
// active — same conflict rule as the other radars.
// ---------------------------------------------------------

function createRunConflictPool() {
  return {
    async query(sql) {
      if (sql.includes("status IN ('QUEUED', 'RUNNING')")) {
        return {
          rows: [
            { id: 1, status: "RUNNING", created_at: new Date() }
          ],
          rowCount: 1
        };
      }
      throw new Error(
        `Unexpected query when a run is active: ${sql.slice(0, 80)}`
      );
    }
  };
}

async function run() {
  const conflict = await createFusionRun(
    createRunConflictPool(),
    {}
  );

  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.payload.error, "FUSION_RUN_ACTIVE");

  // ---------------------------------------------------------
  // createFusionRun: happy path queues the run with the
  // normalized payload.
  // ---------------------------------------------------------

  function createRunQueuePool() {
    const queries = [];
    return {
      queries,
      async query(sql, values) {
        queries.push({ sql, values });

        if (sql.includes("status IN ('QUEUED', 'RUNNING')")) {
          return { rows: [], rowCount: 0 };
        }

        if (sql.includes("INSERT INTO fusion_runs")) {
          return {
            rows: [
              {
                id: 5,
                status: "QUEUED",
                request_payload: JSON.parse(values[0]),
                vehicle_count: 0,
                created_at: new Date()
              }
            ],
            rowCount: 1
          };
        }

        throw new Error(
          `Unexpected query: ${sql.slice(0, 80)}`
        );
      }
    };
  }

  const queuePool = createRunQueuePool();
  const queued = await createFusionRun(queuePool, {
    max_vehicles: 5
  });

  assert.equal(queued.statusCode, 202);
  assert.equal(queued.payload.data.request_payload.max_vehicles, 5);
  assert.equal(
    queued.payload.data.request_payload.vehicle_window_days,
    14,
    "Omitted fields fall back to documented defaults."
  );

  // ---------------------------------------------------------
  // listFusionCandidates: with no explicit run_id, the
  // latest COMPLETED run is used automatically.
  // ---------------------------------------------------------

  function createCapturingPool({ latestRunId, rows }) {
    const queries = [];
    return {
      queries,
      async query(sql, values) {
        queries.push({ sql, values });

        if (
          sql.includes("FROM fusion_runs") &&
          sql.includes("status = 'COMPLETED'")
        ) {
          return latestRunId
            ? { rows: [{ id: latestRunId }], rowCount: 1 }
            : { rows: [], rowCount: 0 };
        }

        if (sql.includes("COUNT(*) OVER()")) {
          return { rows, rowCount: rows.length };
        }

        return { rows: [{}], rowCount: 1 };
      }
    };
  }

  const noRunPool = createCapturingPool({
    latestRunId: null,
    rows: []
  });

  const emptyResponse = await listFusionCandidates(
    noRunPool,
    new URLSearchParams()
  );

  assert.equal(emptyResponse.statusCode, 200);
  assert.deepEqual(emptyResponse.payload.data, []);
  assert.equal(emptyResponse.payload.filters.run_id, null);

  const dataPool = createCapturingPool({
    latestRunId: 7,
    rows: [
      {
        id: "1",
        fusion_score: "88.50",
        total_count: "1"
      }
    ]
  });

  const listed = await listFusionCandidates(
    dataPool,
    new URLSearchParams()
  );

  assert.equal(listed.statusCode, 200);
  assert.equal(listed.payload.filters.run_id, 7);
  assert.equal(listed.payload.data[0].fusion_score, "88.50");

  const listSql = dataPool.queries.find(item =>
    item.sql.includes("COUNT(*) OVER()")
  ).sql;

  assert.ok(
    listSql.includes("vfc.run_id = $1"),
    "run_id must always scope the candidate list."
  );
  assert.ok(listSql.includes("ORDER BY"));
  assert.ok(
    listSql.includes("vfc.fusion_score DESC"),
    "Default sort is fusion_score."
  );

  // ---------------------------------------------------------
  // Vehicle filter and allowlist validation.
  // ---------------------------------------------------------

  const vehicleFilterPool = createCapturingPool({
    latestRunId: 7,
    rows: []
  });

  await listFusionCandidates(
    vehicleFilterPool,
    new URLSearchParams({ vehicle_id: "42" })
  );

  const filteredSql = vehicleFilterPool.queries.find(item =>
    item.sql.includes("COUNT(*) OVER()")
  ).sql;

  assert.ok(
    filteredSql.includes("vfc.vehicle_id = $2"),
    "vehicle_id must be a bound parameter, not interpolated."
  );

  for (const [key, value] of [
    ["vehicle_id", "not-a-number"],
    ["person_link_tier", "MADE_UP_TIER"],
    ["is_complete", "MAYBE"],
    ["sort", "popularity"],
    ["country_code", "USA"]
  ]) {
    const invalidQuery = await listFusionCandidates(
      createCapturingPool({ latestRunId: 7, rows: [] }),
      new URLSearchParams({ [key]: value })
    );

    assert.equal(
      invalidQuery.error?.statusCode ?? invalidQuery.statusCode,
      400,
      `${key}=${value} must be rejected.`
    );
  }

  // ---------------------------------------------------------
  // getFusionCandidateDetail: 404 for a missing candidate,
  // grouped evidence passed through untouched.
  // ---------------------------------------------------------

  const notFoundPool = {
    async query() {
      return { rows: [], rowCount: 0 };
    }
  };

  const notFound = await getFusionCandidateDetail(
    notFoundPool,
    "999"
  );

  assert.equal(notFound.statusCode, 404);
  assert.equal(
    notFound.payload.error,
    "FUSION_CANDIDATE_NOT_FOUND"
  );

  const detailPool = {
    async query() {
      return {
        rows: [
          {
            id: "1",
            fusion_evidence: {
              vehicle: { vehicle_id: "1" },
              country_news: { category: "ENERGY" },
              person_current: null,
              historical_relationship: null,
              transformation: {}
            }
          }
        ],
        rowCount: 1
      };
    }
  };

  const detail = await getFusionCandidateDetail(
    detailPool,
    "1"
  );

  assert.equal(detail.statusCode, 200);
  assert.equal(
    detail.payload.data.fusion_evidence.country_news.category,
    "ENERGY"
  );

  console.log("TASK 3.3F FUSION API TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

const assert = require("node:assert/strict");

const {
  NO_QUALIFIED_VEHICLE_TRAFFIC_ERROR,
  processNextFusionRun
} = require("../lib/fusion/engine");

// ---------------------------------------------------------
// In-memory mock database. Dispatches on SQL text
// substrings, exactly the pattern used by
// scripts/test-person-worker.js and
// scripts/test-country-news-worker.js — no real Postgres
// connection is required.
// ---------------------------------------------------------

function createMockDb({ run, vehicles, newsByCountry, linksByBrand }) {
  const state = {
    run: { ...run, status: "QUEUED" },
    candidates: new Map(),
    nextCandidateId: 1
  };

  function candidateKey(values) {
    // run_id, vehicle_id, country_news_signal_id, person_id
    return [
      values[0],
      values[1],
      values[3],
      values[4] ?? "-1"
    ].join("::");
  }

  async function query(sql, values = []) {
    if (
      sql.includes("FROM fusion_runs") &&
      sql.includes("status = 'QUEUED'")
    ) {
      if (state.run.status !== "QUEUED") {
        return { rows: [], rowCount: 0 };
      }
      return {
        rows: [
          {
            id: state.run.id,
            request_payload: state.run.request_payload
          }
        ],
        rowCount: 1
      };
    }

    if (
      sql.includes("UPDATE fusion_runs") &&
      sql.includes("status = 'RUNNING'")
    ) {
      state.run.status = "RUNNING";
      return { rows: [], rowCount: 1 };
    }

    // Vehicle traffic anchors.
    if (sql.includes("ranked AS")) {
      return { rows: vehicles, rowCount: vehicles.length };
    }

    // Eligible country news.
    if (sql.includes("FROM country_news_signals")) {
      const countryId = values[0];
      const rows = newsByCountry[countryId] || [];
      return { rows, rowCount: rows.length };
    }

    // Eligible person links.
    if (
      sql.includes("FROM vehicle_person_links vpl") &&
      sql.includes("JOIN person_traffic_signals pts")
    ) {
      const brand = String(values[0]).replace(/%/g, "");
      const rows = linksByBrand[brand] || [];
      return { rows, rowCount: rows.length };
    }

    // Candidate upsert.
    if (sql.includes("INSERT INTO vehicle_fusion_candidates")) {
      const key = candidateKey(values);
      const existing = state.candidates.get(key);

      if (existing) {
        return { rows: [{ id: existing.id, inserted: false }], rowCount: 1 };
      }

      const id = state.nextCandidateId++;
      state.candidates.set(key, { id, values });
      return { rows: [{ id, inserted: true }], rowCount: 1 };
    }

    // Run progress / finalize (both UPDATE fusion_runs, no
    // status literal — progress omits status; finalize
    // sets it explicitly as $1).
    if (
      sql.includes("UPDATE fusion_runs") &&
      sql.includes("status = $1")
    ) {
      state.run.status = values[0];
      state.run.finalSummary = JSON.parse(values[7]);
      return { rows: [], rowCount: 1 };
    }

    if (
      sql.includes("UPDATE fusion_runs") &&
      sql.includes("vehicle_count = $1")
    ) {
      return { rows: [], rowCount: 1 };
    }

    throw new Error(
      `Unexpected fusion query: ${sql.slice(0, 120)}`
    );
  }

  return { query, connect: null, state };
}

// A pool.connect()-based client is needed for
// claimNextFusionRun's BEGIN/COMMIT transaction.
function wrapAsPool(mockDb) {
  return {
    query: mockDb.query,
    async connect() {
      return {
        query: mockDb.query,
        release() {}
      };
    }
  };
}

const GR86 = {
  vehicle_id: "1",
  vehicle_code: "GR86",
  vehicle_name: "Toyota GR86",
  country_id: "10",
  country_code: "JP",
  country_name: "Japan",
  vehicle_brand: "Toyota",
  vehicle_series: "GR",
  vehicle_model: "GR86",
  representative_viral_tier: "PROVEN",
  qualified_vehicle_signal_count: 5,
  vehicle_views_total: "4000000",
  vehicle_views_max: "1500000"
};

const MUSTANG = {
  vehicle_id: "2",
  vehicle_code: "MUSTANG",
  vehicle_name: "Ford Mustang",
  country_id: "20",
  country_code: "US",
  country_name: "United States",
  vehicle_brand: "Ford",
  vehicle_series: "Mustang",
  vehicle_model: "Mustang GT",
  representative_viral_tier: "RISING",
  qualified_vehicle_signal_count: 3,
  vehicle_views_total: "900000",
  vehicle_views_max: "400000"
};

async function run() {
  // -------------------------------------------------------
  // Case 1: vehicle with 2 news signals and 2 eligible
  // person links produces 4 candidates (cross product), a
  // vehicle with no country-matched news is skipped
  // entirely (NO_COUNTRY_NEWS_SIGNAL) and produces zero
  // candidates.
  // -------------------------------------------------------

  const mockDb = createMockDb({
    run: {
      id: 1,
      request_payload: {}
    },
    vehicles: [GR86, MUSTANG],
    newsByCountry: {
      10: [
        {
          id: "901",
          category: "ENERGY",
          conflict_archetypes: ["RESOURCE_SCARCITY"],
          traffic_score: 80,
          transformation_potential: 50
        },
        {
          id: "902",
          category: "TRADE",
          conflict_archetypes: [],
          traffic_score: 60,
          transformation_potential: 30
        }
      ]
      // country 20 (US, Mustang) has no eligible news.
    },
    linksByBrand: {
      Toyota: [
        {
          link_id: "701",
          person_id: "501",
          vehicle_id: "1",
          vehicle_brand: "Toyota",
          vehicle_series: "GR",
          vehicle_model: "GR86",
          link_confidence: 0.85,
          evidence_horizon: "ALL_TIME",
          historical_resonance_score: 90,
          historical_resonance_tier: "ICONIC",
          person_traffic_score: 70,
          person_transformation_potential: 60
        },
        {
          link_id: "702",
          person_id: "502",
          vehicle_id: null,
          vehicle_brand: "Toyota",
          vehicle_series: "GR",
          vehicle_model: "GR Corolla",
          link_confidence: 0.75,
          evidence_horizon: "TEN_YEARS",
          historical_resonance_score: 65,
          historical_resonance_tier: "RECOGNIZABLE",
          person_traffic_score: 40,
          person_transformation_potential: 35
        }
      ]
    }
  });

  const pool = wrapAsPool(mockDb);

  const result = await processNextFusionRun(pool, {
    workerId: "test-worker"
  });

  assert.ok(result, "A queued run must be claimed.");
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.vehicleCount, 2);
  assert.equal(result.completedVehicleCount, 1);
  assert.equal(
    result.skippedVehicleCount,
    1,
    "Mustang has no country-matched news and must be skipped."
  );

  // GR86: 2 news x 2 people = 4 candidates. Mustang: 0.
  assert.equal(result.candidateCount, 4);
  assert.equal(result.candidateInsertedCount, 4);

  const skipError = result.errors.find(
    item => item.code === "NO_COUNTRY_NEWS_SIGNAL"
  );

  assert.ok(skipError, "Skip reason must be persisted.");
  assert.equal(skipError.vehicle_code, "MUSTANG");

  // Tier accounting: link 701 is an exact vehicle_id match
  // (EXACT_VEHICLE); link 702 has no vehicle_id but a
  // matching model (also EXACT_VEHICLE per tier rules).
  assert.equal(result.exactVehicleCount, 4);
  assert.equal(result.sameSeriesCount, 0);
  assert.equal(result.sameBrandCount, 0);
  assert.equal(result.noPersonSignalCount, 0);

  // -------------------------------------------------------
  // Case 2: re-running the identical evidence upserts
  // rather than duplicating (uniqueness on run_id,
  // vehicle_id, country_news_signal_id, person_id).
  // -------------------------------------------------------

  mockDb.state.run.status = "QUEUED";

  const rerun = await processNextFusionRun(pool, {
    workerId: "test-worker"
  });

  assert.equal(rerun.candidateCount, 4);
  assert.equal(
    rerun.candidateInsertedCount,
    0,
    "Identical evidence must upsert, not insert new rows."
  );
  assert.equal(rerun.candidateUpdatedCount, 4);

  // -------------------------------------------------------
  // Case 3: a vehicle with eligible news but NO eligible
  // person still produces candidates, marked
  // NO_PERSON_SIGNAL — it is not skipped.
  // -------------------------------------------------------

  const soloDb = createMockDb({
    run: { id: 2, request_payload: {} },
    vehicles: [MUSTANG],
    newsByCountry: {
      20: [
        {
          id: "903",
          category: "SANCTIONS_TRADE",
          conflict_archetypes: [],
          traffic_score: 55,
          transformation_potential: 45
        }
      ]
    },
    linksByBrand: {}
  });

  const soloResult = await processNextFusionRun(
    wrapAsPool(soloDb),
    { workerId: "test-worker" }
  );

  assert.equal(soloResult.status, "COMPLETED");
  assert.equal(soloResult.skippedVehicleCount, 0);
  assert.equal(soloResult.candidateCount, 1);
  assert.equal(soloResult.noPersonSignalCount, 1);

  // -------------------------------------------------------
  // Case 4: no qualified vehicle traffic at all => FAILED
  // with the documented error code, never silently empty.
  // -------------------------------------------------------

  const emptyDb = createMockDb({
    run: { id: 3, request_payload: {} },
    vehicles: [],
    newsByCountry: {},
    linksByBrand: {}
  });

  const emptyResult = await processNextFusionRun(
    wrapAsPool(emptyDb),
    { workerId: "test-worker" }
  );

  assert.equal(emptyResult.status, "FAILED");
  assert.equal(
    emptyResult.errorCode,
    NO_QUALIFIED_VEHICLE_TRAFFIC_ERROR
  );

  console.log("TASK 3.3F FUSION WORKER TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

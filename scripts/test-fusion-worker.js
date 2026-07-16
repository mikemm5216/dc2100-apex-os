const assert = require("node:assert/strict");
const { processNextFusionRun } = require("../lib/fusion/engine");

function createMockDb({ run, pairs, newsByCountry }) {
  const state = {
    run: { ...run, status: "QUEUED" },
    candidates: [],
    statusHistory: ["QUEUED"],
    transactionLog: []
  };
  async function query(sql, values = []) {
    const normalized = String(sql).trim().toUpperCase();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized)) {
      state.transactionLog.push(normalized);
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("FROM fusion_runs") && sql.includes("status = 'QUEUED'")) {
      return state.run.status === "QUEUED"
        ? { rows: [{ id: state.run.id, request_payload: state.run.request_payload }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (sql.includes("UPDATE fusion_runs") && sql.includes("status = 'RUNNING'")) {
      state.run.status = "RUNNING";
      state.statusHistory.push("RUNNING");
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM vehicle_person_pair_signals ps")) {
      return { rows: pairs, rowCount: pairs.length };
    }
    if (sql.includes("UPDATE fusion_runs SET pair_run_id")) {
      state.run.pairRunId = values[0];
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM country_news_signals")) {
      const rows = newsByCountry[String(values[0])] || [];
      return { rows, rowCount: rows.length };
    }
    if (sql.includes("INSERT INTO vehicle_fusion_candidates")) {
      state.candidates.push(values);
      return { rows: [{ id: state.candidates.length, inserted: true }], rowCount: 1 };
    }
    if (sql.includes("UPDATE fusion_runs") && sql.includes("status = $1")) {
      state.run.status = values[0];
      state.statusHistory.push(values[0]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE fusion_runs") && sql.includes("vehicle_count = $1")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("UPDATE fusion_runs") && sql.includes("status = 'FAILED'")) {
      state.run.status = "FAILED";
      state.statusHistory.push("FAILED");
      state.run.errorMessage = values[0];
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected fusion query: ${sql.slice(0, 120)}`);
  }
  return {
    state,
    query,
    async connect() { return { query, release() {} }; }
  };
}

function pair(overrides = {}) {
  return {
    id: "501", run_id: "77", vehicle_id: "1", vehicle_code: "GR86",
    vehicle_name: "Toyota GR86", vehicle_brand: "Toyota",
    vehicle_country_id: "10", vehicle_country_code: "JP",
    person_id: "22", canonical_name: "Test Driver",
    person_country_id: "20", person_country_code: "US",
    person_country_name: "United States", vehicle_person_link_id: "301",
    pair_status: "PROVEN_PAIR", pair_specificity: "EXACT_MODEL",
    cross_country_pair: true, vehicle_anchor_views: "900000",
    joint_video_id: "joint-1", joint_video_views: "700000",
    link_confidence: 0.9, evidence_horizon: "TEN_YEARS",
    historical_resonance_score: 80, historical_resonance_tier: "ICONIC",
    person_traffic_score: 70, person_transformation_potential: 60,
    ...overrides
  };
}

const news = {
  id: "901", category: "TRADE",
  conflict_archetypes: ["RESOURCE_SCARCITY"],
  traffic_score: 80, transformation_potential: 50
};

async function run() {
  const db = createMockDb({
    run: { id: 1, request_payload: { pair_run_id: "77", max_vehicles: 10 } },
    pairs: [pair()], newsByCountry: { "20": [news] }
  });
  const result = await processNextFusionRun(db, { workerId: "test-worker" });
  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(db.state.transactionLog, ["BEGIN", "COMMIT"]);
  assert.deepEqual(db.state.statusHistory, ["QUEUED", "RUNNING", "COMPLETED"]);
  assert.equal(result.candidateCount, 1);
  const values = db.state.candidates[0];
  assert.equal(values[1], "1", "vehicle_id is preserved");
  assert.equal(values[2], "20", "country_id must bind to the person's country");
  assert.equal(values[4], "22", "person_id can never be null");
  assert.equal(values[26], "501", "pair signal lineage is persisted");
  assert.equal(values[27], "77", "pair run lineage is persisted");
  assert.equal(values[28], "joint-1");
  assert.equal(values[32], "20");
  assert.equal(values[33], "10");
  assert.equal(values[34], true);
  assert.equal(values[35], "PERSON_COUNTRY");

  const noNewsDb = createMockDb({
    run: { id: 2, request_payload: { pair_run_id: "77" } },
    pairs: [pair()], newsByCountry: { "10": [news] }
  });
  const noNews = await processNextFusionRun(noNewsDb, { workerId: "test-worker" });
  assert.equal(noNews.status, "FAILED");
  assert.equal(noNews.candidateCount, 0);
  assert.equal(noNewsDb.state.candidates.length, 0, "vehicle-country news must not be used as fallback");
  assert.equal(noNews.errors[0].code, "NO_PERSON_COUNTRY_NEWS");

  const noPairDb = createMockDb({
    run: { id: 3, request_payload: { pair_run_id: "77" } },
    pairs: [], newsByCountry: {}
  });
  const noPair = await processNextFusionRun(noPairDb, { workerId: "test-worker" });
  assert.equal(noPair.status, "FAILED");
  assert.match(noPairDb.state.run.errorMessage, /NO_VEHICLE_PERSON_PAIR_SIGNALS/);
  console.log("VEHICLE-PERSON PAIR FUSION WORKER TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

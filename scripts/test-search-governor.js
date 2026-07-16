const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  DAILY_SEARCH_LIMIT,
  AUTOMATED_SAFE_LIMIT,
  RESERVED_SEARCH_CREDITS,
  SearchBudgetExhaustedError,
  pacificQuotaDate,
  acquireSearchCredit,
  governedSearchVideos
} = require("../lib/scanner/search-governor");
const {
  STATION_SEARCH_BUDGET,
  modeExecutionPolicy,
  consumeStationSearchCredit
} = require("../lib/content/modes");
const { runLockedCanonIdentityValidator } = require("../lib/story/validators");

assert.equal(DAILY_SEARCH_LIMIT, 100);
assert.equal(AUTOMATED_SAFE_LIMIT, 90);
assert.equal(RESERVED_SEARCH_CREDITS, 10);
assert.equal(STATION_SEARCH_BUDGET.total, 30);
assert.equal(Object.values(STATION_SEARCH_BUDGET).reduce((sum, value) => sum + value, 0) - 30, 30);
assert.equal(pacificQuotaDate(new Date("2026-07-16T06:59:59Z")), "2026-07-15");
assert.equal(pacificQuotaDate(new Date("2026-07-16T07:00:00Z")), "2026-07-16");

const locked = modeExecutionPolicy("LOCKED_CANON");
assert.equal(locked.pairSignalEngine, false);
assert.equal(locked.fusionEngine, false);
assert.equal(locked.youtubeSearchAllowed, false);
assert.equal(locked.countryNewsEngine, true);
const guest = modeExecutionPolicy("STATION_GUEST");
assert.equal(guest.vehicleSignalEngine, true);
assert.equal(guest.personSignalEngine, true);
assert.equal(guest.pairSignalEngine, true);
assert.equal(guest.countryEventVideoEngine, true);
assert.equal(runLockedCanonIdentityValidator({
  character_concept: { canon_driver_name: "Changed Driver" },
  vehicle_transformation: { canon_vehicle_name: "Locked Vehicle" }
}, {
  lockedCanon: {
    canon_driver_name: "Locked Driver",
    canon_vehicle_name: "Locked Vehicle"
  }
}).some(item => item.code === "LOCKED_CANON_DRIVER_CHANGED"), true);

function budgetPool(initialUsed = 0) {
  const state = { used: initialUsed, blocked: 0, pair: 0 };
  async function query(sql) {
    const normalized = sql.trim();
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(normalized) ||
      sql.includes("INSERT INTO youtube_daily_search_budget")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FOR UPDATE")) {
      return { rows: [{ search_calls_used: state.used, automated_safe_limit: 90 }], rowCount: 1 };
    }
    if (sql.includes("blocked_search_calls=blocked_search_calls+1")) {
      state.blocked += 1;
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("search_calls_used=search_calls_used+1")) {
      state.used += 1;
      if (sql.includes("pair_search_calls=pair_search_calls+1")) state.pair += 1;
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected budget SQL: ${sql.slice(0, 90)}`);
  }
  return { state, async connect() { return { query, release() {} }; } };
}

async function run() {
  const pool = budgetPool(89);
  await acquireSearchCredit(pool, "PAIR", { now: new Date("2026-07-16T12:00:00Z") });
  assert.equal(pool.state.used, 90);
  assert.equal(pool.state.pair, 1);
  await assert.rejects(
    acquireSearchCredit(pool, "PAIR"),
    error => error instanceof SearchBudgetExhaustedError && error.code === "SEARCH_BUDGET_EXHAUSTED"
  );
  assert.equal(pool.state.used, 90, "the 91st search must not consume or issue a credit");
  assert.equal(pool.state.blocked, 1);

  let apiCalls = 0;
  const cachePool = {
    async query(sql) {
      if (sql.includes("FROM youtube_search_query_cache")) {
        return { rows: [{ result_video_ids: ["cached-1"] }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO youtube_daily_search_budget")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected cache SQL: ${sql.slice(0, 90)}`);
    }
  };
  const cached = await governedSearchVideos({
    pool: cachePool,
    engine: "PERSON",
    query: "cached query",
    format: "SHORTS",
    searchVideos: async () => { apiCalls += 1; return []; }
  });
  assert.equal(cached.cacheHit, true);
  assert.deepEqual(cached.videoIds, ["cached-1"]);
  assert.equal(apiCalls, 0, "cache hits never call search.list or consume credit");

  const stationState = {
    used: { vehicle: 6, person: 6, pair: 11, country_event: 4, retry: 2 },
    status: "ACTIVE"
  };
  async function stationQuery(sql, values = []) {
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql.trim()) ||
      sql.includes("INSERT INTO station_guest_search_budgets")) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("FROM station_guest_search_budgets")) {
      return { rows: [{ used: stationState.used }], rowCount: 1 };
    }
    if (sql.includes("SET used=")) {
      stationState.used = JSON.parse(values[1]);
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes("SET status='SEARCH_BUDGET_EXHAUSTED'")) {
      stationState.status = "SEARCH_BUDGET_EXHAUSTED";
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected station SQL: ${sql.slice(0, 90)}`);
  }
  const stationPool = {
    async connect() { return { query: stationQuery, release() {} }; }
  };
  await consumeStationSearchCredit(stationPool, "station-1", "pair");
  assert.equal(stationState.used.pair, 12);
  await assert.rejects(
    consumeStationSearchCredit(stationPool, "station-1", "pair"),
    error => error.code === "SEARCH_BUDGET_EXHAUSTED"
  );
  assert.equal(stationState.status, "SEARCH_BUDGET_EXHAUSTED");

  const migration = fs.readFileSync(
    require.resolve("../db/migrations/020_pair_search_quota_resume.sql"),
    "utf8"
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS youtube_daily_search_budget/);
  assert.match(migration, /UNIQUE\(normalized_query, format, provider\)/);
  assert.match(migration, /FOR UPDATE|station_guest_search_budgets/);
  assert.match(migration, /locked_canon_news_candidates/);
  for (const sourcePath of [
    "../lib/person/person-direct-video-engine",
    "../lib/person/vehicle-person-pair-engine",
    "../lib/news/country-event-video-engine"
  ]) {
    const source = fs.readFileSync(require.resolve(sourcePath), "utf8");
    assert.match(source, /search-governor/);
  }
  console.log("SYSTEM-WIDE SEARCH GOVERNOR AND CONTENT MODE TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

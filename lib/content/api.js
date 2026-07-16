const {
  CONTENT_MODES,
  STATION_SEARCH_BUDGET,
  modeExecutionPolicy,
  loadLockedCanonNewsMatrix
} = require("./modes");
const {
  DAILY_SEARCH_LIMIT,
  AUTOMATED_SAFE_LIMIT,
  RESERVED_SEARCH_CREDITS,
  pacificQuotaDate
} = require("../scanner/search-governor");

function response(statusCode, payload) {
  return { statusCode, payload };
}

async function getContentModes() {
  return response(200, {
    data: Object.values(CONTENT_MODES).map(mode => modeExecutionPolicy(mode)),
    station_search_budget: STATION_SEARCH_BUDGET
  });
}

async function getLockedCanonNewsMatrix(pool) {
  const data = await loadLockedCanonNewsMatrix(pool);
  return response(200, {
    data,
    slot_count: data.length,
    roster_complete: data.length === 15,
    youtube_search_calls: 0,
    pair_runs_executed: 0,
    fusion_runs_executed: 0
  });
}

async function getDailySearchBudget(pool, now = new Date()) {
  const quotaDate = pacificQuotaDate(now);
  const result = await pool.query(`
    SELECT *,automated_safe_limit-search_calls_used AS search_calls_remaining
    FROM youtube_daily_search_budget
    WHERE quota_date_pacific=$1::date
  `, [quotaDate]);
  const data = result.rows[0] || {
    quota_date_pacific: quotaDate,
    daily_limit: DAILY_SEARCH_LIMIT,
    automated_safe_limit: AUTOMATED_SAFE_LIMIT,
    reserved_credits: RESERVED_SEARCH_CREDITS,
    search_calls_used: 0,
    search_calls_remaining: AUTOMATED_SAFE_LIMIT,
    vehicle_search_calls: 0,
    person_search_calls: 0,
    pair_search_calls: 0,
    country_event_search_calls: 0,
    manual_reserved_calls: 0,
    cache_hits: 0,
    blocked_search_calls: 0
  };
  return response(200, { data });
}

module.exports = {
  getContentModes,
  getLockedCanonNewsMatrix,
  getDailySearchBudget
};

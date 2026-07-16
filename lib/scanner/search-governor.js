const DAILY_SEARCH_LIMIT = 100;
const AUTOMATED_SAFE_LIMIT = 90;
const RESERVED_SEARCH_CREDITS = 10;

const ENGINE_COLUMNS = Object.freeze({
  VEHICLE: "vehicle_search_calls",
  PERSON: "person_search_calls",
  PAIR: "pair_search_calls",
  COUNTRY_EVENT: "country_event_search_calls"
});

class SearchBudgetExhaustedError extends Error {
  constructor(quotaDatePacific) {
    super(`Automated YouTube search budget exhausted for Pacific quota day ${quotaDatePacific}.`);
    this.name = "SearchBudgetExhaustedError";
    this.code = "SEARCH_BUDGET_EXHAUSTED";
    this.quotaDatePacific = quotaDatePacific;
  }
}

function pacificQuotaDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function normalizeSearchQuery(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function ensureBudgetRow(client, quotaDate) {
  await client.query(`
    INSERT INTO youtube_daily_search_budget(quota_date_pacific)
    VALUES($1::date)
    ON CONFLICT(quota_date_pacific) DO NOTHING
  `, [quotaDate]);
}

async function acquireSearchCredit(pool, engine, {
  now = new Date(),
  stationRunKey = null,
  stationCategory = null
} = {}) {
  const engineColumn = ENGINE_COLUMNS[engine];
  if (!engineColumn) throw new Error(`Unsupported YouTube search engine: ${engine}`);
  const quotaDate = pacificQuotaDate(now);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureBudgetRow(client, quotaDate);
    const locked = await client.query(`
      SELECT * FROM youtube_daily_search_budget
      WHERE quota_date_pacific=$1::date
      FOR UPDATE
    `, [quotaDate]);
    const row = locked.rows[0];
    if (Number(row.search_calls_used) >= Number(row.automated_safe_limit)) {
      await client.query(`
        UPDATE youtube_daily_search_budget
        SET blocked_search_calls=blocked_search_calls+1,last_updated_at=NOW()
        WHERE quota_date_pacific=$1::date
      `, [quotaDate]);
      await client.query("COMMIT");
      throw new SearchBudgetExhaustedError(quotaDate);
    }
    let nextStationUsed = null;
    if (stationRunKey && stationCategory) {
      const { STATION_SEARCH_BUDGET } = require("../content/modes");
      if (!Object.hasOwn(STATION_SEARCH_BUDGET, stationCategory) ||
        stationCategory === "total") {
        throw new Error(`Unsupported station search category: ${stationCategory}`);
      }
      await client.query(`
        INSERT INTO station_guest_search_budgets(station_run_key)
        VALUES($1) ON CONFLICT(station_run_key) DO NOTHING
      `, [stationRunKey]);
      const stationResult = await client.query(`
        SELECT * FROM station_guest_search_budgets
        WHERE station_run_key=$1 FOR UPDATE
      `, [stationRunKey]);
      const used = stationResult.rows[0].used || {};
      const totalUsed = Object.values(used)
        .reduce((sum, value) => sum + Number(value || 0), 0);
      if (totalUsed >= STATION_SEARCH_BUDGET.total ||
        Number(used[stationCategory] || 0) >= STATION_SEARCH_BUDGET[stationCategory]) {
        await client.query(`
          UPDATE station_guest_search_budgets
          SET status='SEARCH_BUDGET_EXHAUSTED',updated_at=NOW()
          WHERE station_run_key=$1
        `, [stationRunKey]);
        await client.query(`
          UPDATE youtube_daily_search_budget
          SET blocked_search_calls=blocked_search_calls+1,last_updated_at=NOW()
          WHERE quota_date_pacific=$1::date
        `, [quotaDate]);
        await client.query("COMMIT");
        throw new SearchBudgetExhaustedError(quotaDate);
      }
      nextStationUsed = {
        ...used,
        [stationCategory]: Number(used[stationCategory] || 0) + 1
      };
    }
    await client.query(`
      UPDATE youtube_daily_search_budget
      SET search_calls_used=search_calls_used+1,
          ${engineColumn}=${engineColumn}+1,
          last_updated_at=NOW()
      WHERE quota_date_pacific=$1::date
    `, [quotaDate]);
    if (nextStationUsed) {
      await client.query(`
        UPDATE station_guest_search_budgets
        SET used=$2::jsonb,updated_at=NOW()
        WHERE station_run_key=$1
      `, [stationRunKey, JSON.stringify(nextStationUsed)]);
    }
    await client.query("COMMIT");
    return { quotaDatePacific: quotaDate, engine };
  } catch (error) {
    if (!(error instanceof SearchBudgetExhaustedError)) {
      try { await client.query("ROLLBACK"); } catch {}
    }
    throw error;
  } finally {
    client.release();
  }
}

async function recordCacheHit(pool, { now = new Date() } = {}) {
  const quotaDate = pacificQuotaDate(now);
  await pool.query(`
    INSERT INTO youtube_daily_search_budget(quota_date_pacific,cache_hits)
    VALUES($1::date,1)
    ON CONFLICT(quota_date_pacific) DO UPDATE SET
      cache_hits=youtube_daily_search_budget.cache_hits+1,
      last_updated_at=NOW()
  `, [quotaDate]);
}

async function readSearchCache(pool, query, format, provider = "YOUTUBE") {
  const result = await pool.query(`
    SELECT result_video_ids
    FROM youtube_search_query_cache
    WHERE normalized_query=$1 AND format=$2 AND provider=$3
      AND expires_at > NOW()
    LIMIT 1
  `, [normalizeSearchQuery(query), format, provider]);
  return result.rowCount ? (result.rows[0].result_video_ids || []) : null;
}

async function writeSearchCache(
  pool,
  query,
  format,
  videoIds,
  { provider = "YOUTUBE", ttlDays = 7 } = {}
) {
  await pool.query(`
    INSERT INTO youtube_search_query_cache(
      normalized_query,format,provider,result_video_ids,searched_at,expires_at,
      search_result_count
    ) VALUES($1,$2,$3,$4::jsonb,NOW(),NOW()+($5::text || ' days')::interval,$6)
    ON CONFLICT(normalized_query,format,provider) DO UPDATE SET
      result_video_ids=EXCLUDED.result_video_ids,searched_at=EXCLUDED.searched_at,
      expires_at=EXCLUDED.expires_at,search_result_count=EXCLUDED.search_result_count,
      error_code=NULL,updated_at=NOW()
  `, [normalizeSearchQuery(query), format, provider, JSON.stringify(videoIds),
    String(ttlDays), videoIds.length]);
}

async function governedSearchVideos({
  pool,
  engine,
  query,
  format,
  apiKey,
  maxResults = 20,
  publishedAfter = null,
  ttlDays = 7,
  stationRunKey = null,
  stationCategory = null,
  searchVideos,
  onRequest
}) {
  const cached = await readSearchCache(pool, query, format);
  if (cached !== null) {
    await recordCacheHit(pool);
    return { videoIds: cached, cacheHit: true, apiCalled: false };
  }
  await acquireSearchCredit(pool, engine, { stationRunKey, stationCategory });
  let videoIds;
  try {
    videoIds = await searchVideos(query, {
      apiKey,
      maxResults,
      publishedAfter,
      onRequest
    });
  } catch (error) {
    const text = `${error?.code || ""} ${error?.message || ""}`.toLowerCase();
    if (text.includes("quotaexceeded") || text.includes("quota exceeded") ||
      text.includes("search queries per day")) {
      const blocked = new SearchBudgetExhaustedError(pacificQuotaDate());
      blocked.providerQuotaExceeded = true;
      throw blocked;
    }
    throw error;
  }
  await writeSearchCache(pool, query, format, videoIds, { ttlDays });
  return { videoIds, cacheHit: false, apiCalled: true };
}

module.exports = {
  DAILY_SEARCH_LIMIT,
  AUTOMATED_SAFE_LIMIT,
  RESERVED_SEARCH_CREDITS,
  ENGINE_COLUMNS,
  SearchBudgetExhaustedError,
  pacificQuotaDate,
  normalizeSearchQuery,
  acquireSearchCredit,
  recordCacheHit,
  readSearchCache,
  writeSearchCache,
  governedSearchVideos
};

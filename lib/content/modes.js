const CONTENT_MODES = Object.freeze({
  LOCKED_CANON: "LOCKED_CANON",
  STATION_GUEST: "STATION_GUEST"
});

const STATION_SEARCH_BUDGET = Object.freeze({
  total: 30,
  vehicle: 6,
  person: 6,
  pair: 12,
  country_event: 4,
  retry: 2
});

function normalizeContentMode(value) {
  const mode = String(value || "STATION_GUEST").toUpperCase();
  if (!Object.values(CONTENT_MODES).includes(mode)) {
    const error = new Error("content_mode must be LOCKED_CANON or STATION_GUEST.");
    error.code = "INVALID_CONTENT_MODE";
    throw error;
  }
  return mode;
}

function modeExecutionPolicy(value) {
  const contentMode = normalizeContentMode(value);
  if (contentMode === CONTENT_MODES.LOCKED_CANON) {
    return {
      contentMode,
      usesLockedRoster: true,
      vehicleSignalEngine: false,
      personSignalEngine: false,
      pairSignalEngine: false,
      countryNewsEngine: true,
      countryEventVideoEngine: false,
      fusionEngine: false,
      youtubeSearchAllowed: false,
      dailySearchCreditsAllowed: 0
    };
  }
  return {
    contentMode,
    usesLockedRoster: false,
    vehicleSignalEngine: true,
    personSignalEngine: true,
    pairSignalEngine: true,
    countryNewsEngine: true,
    countryEventVideoEngine: true,
    fusionEngine: true,
    youtubeSearchAllowed: true,
    dailySearchCreditsAllowed: STATION_SEARCH_BUDGET.total
  };
}

async function loadLockedCanonNewsMatrix(pool) {
  const result = await pool.query(`
    SELECT s.slot_id,s.canon_driver_name,s.canon_vehicle_name,
      s.canon_country_code,n.rank,n.selected,
      cns.id AS country_news_signal_id,cns.title,cns.canonical_title,
      cns.representative_url,cns.representative_source,cns.category,
      cns.published_at
    FROM locked_canon_slots s
    LEFT JOIN locked_canon_news_candidates n ON n.slot_id=s.slot_id
    LEFT JOIN country_news_signals cns ON cns.id=n.country_news_signal_id
    WHERE s.locked=TRUE
    ORDER BY s.slot_id,n.rank
  `);
  const slots = new Map();
  for (const row of result.rows) {
    if (!slots.has(row.slot_id)) {
      slots.set(row.slot_id, {
        slot_id: row.slot_id,
        canon_driver_name: row.canon_driver_name,
        canon_vehicle_name: row.canon_vehicle_name,
        canon_country_code: row.canon_country_code,
        news_candidates: []
      });
    }
    if (row.country_news_signal_id) {
      slots.get(row.slot_id).news_candidates.push({
        rank: row.rank,
        selected: row.selected,
        country_news_signal_id: String(row.country_news_signal_id),
        title: row.title,
        canonical_title: row.canonical_title,
        url: row.representative_url,
        source: row.representative_source,
        category: row.category,
        published_at: row.published_at
      });
    }
  }
  return [...slots.values()];
}

async function consumeStationSearchCredit(pool, stationRunKey, category) {
  if (!Object.hasOwn(STATION_SEARCH_BUDGET, category) || category === "total") {
    throw new Error(`Unsupported station search category: ${category}`);
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      INSERT INTO station_guest_search_budgets(station_run_key)
      VALUES($1) ON CONFLICT(station_run_key) DO NOTHING
    `, [stationRunKey]);
    const result = await client.query(`
      SELECT * FROM station_guest_search_budgets
      WHERE station_run_key=$1 FOR UPDATE
    `, [stationRunKey]);
    const row = result.rows[0];
    const used = row.used || {};
    const totalUsed = Object.values(used).reduce((sum, value) => sum + Number(value || 0), 0);
    if (totalUsed >= STATION_SEARCH_BUDGET.total ||
      Number(used[category] || 0) >= STATION_SEARCH_BUDGET[category]) {
      await client.query(`
        UPDATE station_guest_search_budgets
        SET status='SEARCH_BUDGET_EXHAUSTED',updated_at=NOW()
        WHERE station_run_key=$1
      `, [stationRunKey]);
      await client.query("COMMIT");
      const error = new Error(`Station search budget exhausted for ${category}.`);
      error.code = "SEARCH_BUDGET_EXHAUSTED";
      throw error;
    }
    const nextUsed = { ...used, [category]: Number(used[category] || 0) + 1 };
    await client.query(`
      UPDATE station_guest_search_budgets SET used=$2::jsonb,updated_at=NOW()
      WHERE station_run_key=$1
    `, [stationRunKey, JSON.stringify(nextUsed)]);
    await client.query("COMMIT");
    return nextUsed;
  } catch (error) {
    if (error.code !== "SEARCH_BUDGET_EXHAUSTED") {
      try { await client.query("ROLLBACK"); } catch {}
    }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  CONTENT_MODES,
  STATION_SEARCH_BUDGET,
  normalizeContentMode,
  modeExecutionPolicy,
  loadLockedCanonNewsMatrix,
  consumeStationSearchCredit
};

const assert = require("node:assert/strict");

const { newDb } = require("pg-mem");

const {
  claimNextCountryEventVideoRun,
  executeCountryEventVideoRun
} = require("../lib/news/country-event-video-engine");

const FAKE_API_KEY = "fake-youtube-api-key";

// ---------------------------------------------------------
// Mock YouTube transport: routes global.fetch to canned
// search.list / videos.list responses, matching the shape
// lib/scanner/youtube.js expects.
// ---------------------------------------------------------

function createYoutubeFetchMock({
  searchResponses = [],
  videos = {}
}) {
  const calls = { search: [], videos: [] };
  let inFlight = 0;
  let maxInFlight = 0;
  let searchCallIndex = 0;

  async function fetchMock(url) {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);

    const urlObject = new URL(url.toString());

    // Never log or otherwise surface the API key.
    assert.ok(
      !JSON.stringify(url).includes("LEAKED"),
      "API key must never be logged."
    );

    await new Promise(resolve => setImmediate(resolve));
    inFlight -= 1;

    if (urlObject.pathname.endsWith("/search")) {
      calls.search.push({
        query: urlObject.searchParams.get("q"),
        publishedAfter:
          urlObject.searchParams.get("publishedAfter"),
        order: urlObject.searchParams.get("order"),
        type: urlObject.searchParams.get("type")
      });

      const ids = searchResponses[searchCallIndex] || [];
      searchCallIndex += 1;

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            items: ids.map(id => ({ id: { videoId: id } }))
          };
        }
      };
    }

    if (urlObject.pathname.endsWith("/videos")) {
      const idsParam = urlObject.searchParams.get("id") || "";
      const ids = idsParam.split(",").filter(Boolean);

      calls.videos.push(ids);

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            items: ids
              .map(id => videos[id])
              .filter(Boolean)
              .map(video => ({
                id: video.id,
                snippet: {
                  channelId: video.channelId || "chan1",
                  channelTitle:
                    video.channelTitle || "Some Channel",
                  title: video.title,
                  description: video.description || "",
                  tags: video.tags || [],
                  publishedAt: video.publishedAt,
                  thumbnails: {
                    high: { url: "https://thumb/high.jpg" }
                  },
                  liveBroadcastContent: "none"
                },
                contentDetails: {
                  duration: video.duration || "PT30S"
                },
                statistics: {
                  viewCount: String(video.views ?? 0),
                  likeCount: "0",
                  commentCount: "0"
                },
                status: { privacyStatus: "public" }
              }))
          };
        }
      };
    }

    throw new Error(
      `Unexpected YouTube fetch call: ${urlObject.pathname}`
    );
  }

  return {
    fetchMock,
    calls,
    maxInFlightRef: () => maxInFlight
  };
}

// ---------------------------------------------------------
// pg-mem fixture
// ---------------------------------------------------------

async function buildFixturePool() {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();

  await pool.query(`
    CREATE TABLE countries (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT NOT NULL
    );

    CREATE TABLE signals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      external_id TEXT
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
      signal_id BIGINT,
      external_video_id TEXT NOT NULL,
      video_title TEXT NOT NULL,
      video_url TEXT NOT NULL,
      thumbnail_url TEXT,
      video_views BIGINT NOT NULL DEFAULT 0,
      views_per_hour NUMERIC(18, 4),
      published_at TIMESTAMPTZ,
      channel_id TEXT,
      channel_title TEXT,
      duration_seconds INTEGER,
      description_excerpt TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      search_query TEXT,
      matched_country_term TEXT,
      matched_event_term TEXT,
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      resolver_version TEXT NOT NULL DEFAULT 'country-event-video-search-v1',
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT country_event_video_signals_unique
        UNIQUE (country_news_signal_id, external_video_id)
    );

    CREATE TABLE country_event_video_signal_runs (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      summary JSONB NOT NULL DEFAULT '{}'::jsonb,
      entities_attempted INTEGER NOT NULL DEFAULT 0,
      search_query_count INTEGER NOT NULL DEFAULT 0,
      videos_discovered_count INTEGER NOT NULL DEFAULT 0,
      videos_evaluated_count INTEGER NOT NULL DEFAULT 0,
      videos_matched_count INTEGER NOT NULL DEFAULT 0,
      signals_inserted_count INTEGER NOT NULL DEFAULT 0,
      signals_updated_count INTEGER NOT NULL DEFAULT 0,
      no_match_entity_count INTEGER NOT NULL DEFAULT 0,
      quota_units_estimated INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      locked_by TEXT,
      locked_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  async function insertCountry(code, name) {
    const result = await pool.query(
      `INSERT INTO countries (code, name) VALUES ($1, $2) RETURNING id`,
      [code, name]
    );
    return result.rows[0].id;
  }

  async function insertNewsSignal({
    countryId,
    category,
    keywords,
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

  // Inserts a run row and returns it in the shape
  // executeCountryEventVideoRun expects, bypassing the
  // FOR UPDATE SKIP LOCKED claim transaction entirely --
  // pg-mem cannot parse that clause combination (a documented,
  // pre-existing limitation; every other claimNextXRun in this
  // codebase is tested against a hand-rolled mock pool for the
  // same reason, never pg-mem).
  async function queueRun(payload = {}) {
    const result = await pool.query(
      `INSERT INTO country_event_video_signal_runs (status, request_payload)
       VALUES ('RUNNING', $1::jsonb) RETURNING id, request_payload`,
      [JSON.stringify(payload)]
    );
    return result.rows[0];
  }

  return {
    pool,
    insertCountry,
    insertNewsSignal,
    queueRun
  };
}

// Hand-rolled mock pool for the claim transaction only --
// mirrors the convention used by every other claimNextXRun
// test in this codebase, since pg-mem cannot parse
// FOR UPDATE SKIP LOCKED combined with LIMIT.
function createClaimMockPool({ queuedRuns = [] } = {}) {
  const state = {
    runs: new Map(
      queuedRuns.map(run => [
        run.id,
        { ...run, status: "QUEUED" }
      ])
    )
  };

  async function query(sql, values = []) {
    const normalizedSql = sql.trim();

    if (
      normalizedSql === "BEGIN" ||
      normalizedSql === "COMMIT" ||
      normalizedSql === "ROLLBACK"
    ) {
      return { rows: [], rowCount: 0 };
    }

    if (
      sql.includes("FROM country_event_video_signal_runs") &&
      sql.includes("status = 'QUEUED'")
    ) {
      const queued = [...state.runs.values()].find(
        run => run.status === "QUEUED"
      );

      if (!queued) {
        return { rows: [], rowCount: 0 };
      }

      return {
        rows: [
          {
            id: queued.id,
            request_payload: queued.request_payload
          }
        ],
        rowCount: 1
      };
    }

    if (
      sql.includes("UPDATE country_event_video_signal_runs") &&
      sql.includes("status = 'RUNNING'")
    ) {
      state.runs.get(values[1]).status = "RUNNING";
      return { rows: [], rowCount: 1 };
    }

    throw new Error(
      `Mock claim pool received an unexpected query: ${sql.slice(0, 80)}`
    );
  }

  return {
    state,
    async query(sql, values) {
      return query(sql, values);
    },
    async connect() {
      return {
        async query(sql, values) {
          return query(sql, values);
        },
        release() {}
      };
    }
  };
}

async function run() {
  // -------------------------------------------------------
  // Claim: nothing queued returns null; a queued run is
  // claimed and marked RUNNING.
  // -------------------------------------------------------
  {
    const emptyPool = createClaimMockPool();

    const claimed = await claimNextCountryEventVideoRun(
      emptyPool,
      "worker-1"
    );

    assert.equal(claimed, null);

    const busyPool = createClaimMockPool({
      queuedRuns: [{ id: 1, request_payload: {} }]
    });

    const claimedRun = await claimNextCountryEventVideoRun(
      busyPool,
      "worker-1"
    );

    assert.equal(claimedRun.id, 1);
    assert.equal(
      busyPool.state.runs.get(1).status,
      "RUNNING"
    );
  }

  // -------------------------------------------------------
  // Happy path: sequential search, videos.list batching,
  // relevance validation (title/description/tags), 168h
  // window enforcement, old-video exclusion, and
  // views_per_hour ranking.
  // -------------------------------------------------------
  {
    const {
      pool,
      insertCountry,
      insertNewsSignal,
      queueRun
    } = await buildFixturePool();

    const germany = await insertCountry("DE", "Germany");
    const japan = await insertCountry("JP", "Japan");

    await insertNewsSignal({
      countryId: germany,
      category: "WAR_SECURITY",
      keywords: ["war"],
      title: "Germany increases defense budget amid war fears",
      publishedAt: new Date()
    });

    await insertNewsSignal({
      countryId: japan,
      category: "DISASTER_CLIMATE",
      keywords: ["earthquake"],
      title: "Japan hit by earthquake",
      publishedAt: new Date()
    });

    const queuedRun = await queueRun({
      window_hours: 168,
      format: "ALL",
      max_entities: 10
    });

    const now = new Date();
    const recent = new Date(
      now.getTime() - 10 * 3600000
    ).toISOString();
    const tooOld = new Date(
      now.getTime() - 400 * 3600000
    ).toISOString();

    const mock = createYoutubeFetchMock({
      // Germany is processed first (country_id ASC in the
      // representative-signal query).
      searchResponses: [
        ["de-country-only", "de-old-video", "de-tags-match"],
        ["jp-description-match"]
      ],
      videos: {
        // Country name present, but NO event keyword --
        // must never be accepted on country evidence alone.
        "de-country-only": {
          id: "de-country-only",
          title: "Germany Autobahn Documentary",
          description: "A calm tour of German roads.",
          views: 5000000,
          publishedAt: recent
        },
        // Matches both terms, but published outside the
        // 168h window -- must be rejected as stale.
        "de-old-video": {
          id: "de-old-video",
          title: "Germany War Zone Old Footage",
          description: "",
          views: 9000000,
          publishedAt: tooOld
        },
        // Matches via TAGS rather than the title -- proves
        // title/description/tags relevance, not title-only.
        "de-tags-match": {
          id: "de-tags-match",
          title: "Defense Budget Update",
          description: "Weekly roundup.",
          tags: ["Germany", "war"],
          views: 90000,
          publishedAt: recent
        },
        // Japan: matches via DESCRIPTION.
        "jp-description-match": {
          id: "jp-description-match",
          title: "Rescue Footage",
          description:
            "Japan earthquake rescue teams respond.",
          views: 50000,
          publishedAt: recent
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executeCountryEventVideoRun(
        pool,
        queuedRun,
        { apiKey: FAKE_API_KEY, now }
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.entitiesAttempted, 2);
    assert.equal(result.completedEntityCount, 2);
    assert.equal(
      result.videosMatchedCount,
      2,
      "Germany (tags match) and Japan (description match) must both persist exactly one video."
    );

    // Sequential only: the mock never observed two in-flight
    // requests overlapping.
    assert.equal(
      mock.maxInFlightRef(),
      1,
      "YouTube search/videos.list calls must be strictly sequential."
    );

    // One search call per entity.
    assert.equal(mock.calls.search.length, 2);
    assert.equal(mock.calls.search[0].type, "video");
    assert.equal(mock.calls.search[0].order, "viewCount");
    assert.ok(
      mock.calls.search[0].publishedAfter,
      "Country search must scope publishedAfter to the window."
    );

    const savedRows = await pool.query(
      `SELECT * FROM country_event_video_signals ORDER BY country_id ASC`
    );

    assert.equal(
      savedRows.rowCount,
      2,
      "Germany (tags match) and Japan (description match) must each persist exactly one video."
    );

    const germanyRow = savedRows.rows[0];

    // The country-only candidate and the too-old candidate
    // were both rejected; only the tags-matched, in-window
    // video was persisted.
    assert.equal(germanyRow.external_video_id, "de-tags-match");
    assert.equal(Number(germanyRow.video_views), 90000);
    assert.equal(germanyRow.matched_event_term, "war");

    // signal_id stays nullable when no ingested `signals` row
    // shares the external_video_id.
    assert.equal(germanyRow.signal_id, null);

    const runRow = (
      await pool.query(
        `SELECT * FROM country_event_video_signal_runs`
      )
    ).rows[0];

    assert.equal(runRow.status, "COMPLETED");
    assert.equal(runRow.videos_matched_count, 2);
    assert.ok(runRow.quota_units_estimated > 0);
  }

  // -------------------------------------------------------
  // views_per_hour ranking: two valid candidates for the same
  // event, the higher-velocity one wins even with fewer raw
  // views.
  // -------------------------------------------------------
  {
    const {
      pool,
      insertCountry,
      insertNewsSignal,
      queueRun
    } = await buildFixturePool();

    const italy = await insertCountry("IT", "Italy");

    await insertNewsSignal({
      countryId: italy,
      category: "DISASTER_CLIMATE",
      keywords: ["earthquake"],
      title: "Italy hit by earthquake",
      publishedAt: new Date()
    });

    const queuedRun = await queueRun({});

    const now = new Date();
    const publishedAt = new Date(
      now.getTime() - 100 * 3600000
    ).toISOString();
    const freshPublishedAt = new Date(
      now.getTime() - 1 * 3600000
    ).toISOString();

    const mock = createYoutubeFetchMock({
      searchResponses: [["it-high-views", "it-high-velocity"]],
      videos: {
        "it-high-views": {
          id: "it-high-views",
          title: "Italy Earthquake Aftermath Footage",
          views: 400000,
          publishedAt
        },
        "it-high-velocity": {
          id: "it-high-velocity",
          title: "Italy Earthquake Rescue Live",
          views: 90000,
          publishedAt: freshPublishedAt
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executeCountryEventVideoRun(
        pool,
        queuedRun,
        { apiKey: FAKE_API_KEY, now }
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.status, "COMPLETED");

    const savedRow = (
      await pool.query(
        `SELECT * FROM country_event_video_signals`
      )
    ).rows[0];

    assert.equal(
      savedRow.external_video_id,
      "it-high-velocity",
      "The higher views_per_hour candidate must win, not the higher raw-views one."
    );
  }

  // -------------------------------------------------------
  // No YouTube search result matches: no_match is recorded,
  // no row is persisted, and the run still COMPLETES.
  // -------------------------------------------------------
  {
    const {
      pool,
      insertCountry,
      insertNewsSignal,
      queueRun
    } = await buildFixturePool();

    const france = await insertCountry("FR", "France");

    await insertNewsSignal({
      countryId: france,
      category: "SANCTIONS_TRADE",
      keywords: ["tariff"],
      title: "France pushes new tariff policy",
      publishedAt: new Date()
    });

    const queuedRun = await queueRun({});

    const mock = createYoutubeFetchMock({
      searchResponses: [["fr-unrelated"]],
      videos: {
        "fr-unrelated": {
          id: "fr-unrelated",
          title: "Random Vlog",
          views: 1000,
          publishedAt: new Date().toISOString()
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executeCountryEventVideoRun(
        pool,
        queuedRun,
        { apiKey: FAKE_API_KEY }
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.noMatchEntityCount, 1);
    assert.equal(result.videosMatchedCount, 0);

    const savedRows = await pool.query(
      `SELECT * FROM country_event_video_signals`
    );

    assert.equal(savedRows.rowCount, 0);
  }

  // -------------------------------------------------------
  // Existing `signals` row: when the matched external video
  // ID is already an ingested signal, signal_id is populated
  // (never left null when it could be resolved).
  // -------------------------------------------------------
  {
    const {
      pool,
      insertCountry,
      insertNewsSignal,
      queueRun
    } = await buildFixturePool();

    const spain = await insertCountry("ES", "Spain");

    await insertNewsSignal({
      countryId: spain,
      category: "ENERGY",
      keywords: ["energy"],
      title: "Spain energy crisis deepens",
      publishedAt: new Date()
    });

    const existingSignal = await pool.query(
      `INSERT INTO signals (external_id) VALUES ('es-existing') RETURNING id`
    );

    const queuedRun = await queueRun({});

    const mock = createYoutubeFetchMock({
      searchResponses: [["es-existing"]],
      videos: {
        "es-existing": {
          id: "es-existing",
          title: "Spain Energy Crisis Explained",
          views: 20000,
          publishedAt: new Date().toISOString()
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    try {
      await executeCountryEventVideoRun(pool, queuedRun, {
        apiKey: FAKE_API_KEY
      });
    } finally {
      global.fetch = originalFetch;
    }

    const savedRow = (
      await pool.query(
        `SELECT * FROM country_event_video_signals`
      )
    ).rows[0];

    assert.equal(
      String(savedRow.signal_id),
      String(existingSignal.rows[0].id)
    );
  }

  console.log(
    "COUNTRY EVENT VIDEO WORKER TESTS PASSED"
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

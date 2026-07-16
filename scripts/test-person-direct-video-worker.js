const assert = require("node:assert/strict");

const { newDb } = require("pg-mem");

const {
  claimNextPersonDirectVideoRun,
  executePersonDirectVideoRun
} = require("../lib/person/person-direct-video-engine");

const FAKE_API_KEY = "fake-youtube-api-key";

// ---------------------------------------------------------
// Mock YouTube transport (see test-country-event-video-worker.js
// for the shared shape rationale).
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
                  publishedAt:
                    video.publishedAt ||
                    "2020-01-01T00:00:00Z",
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
    CREATE TABLE people (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      slug TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
      role_category TEXT NOT NULL DEFAULT 'OTHER',
      active BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE vehicle_person_links (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      person_id BIGINT NOT NULL,
      vehicle_brand TEXT,
      vehicle_series TEXT,
      vehicle_model TEXT,
      relation_type TEXT NOT NULL DEFAULT 'OTHER',
      link_confidence NUMERIC(5, 4)
    );

    CREATE TABLE signals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      external_id TEXT
    );

    CREATE TABLE person_direct_video_signals (
      id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      person_id BIGINT NOT NULL,
      signal_id BIGINT,
      external_video_id TEXT NOT NULL,
      video_title TEXT NOT NULL,
      video_url TEXT NOT NULL,
      thumbnail_url TEXT,
      video_views BIGINT NOT NULL DEFAULT 0,
      published_at TIMESTAMPTZ,
      channel_id TEXT,
      channel_title TEXT,
      duration_seconds INTEGER,
      description_excerpt TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
      search_query TEXT,
      matched_alias TEXT NOT NULL,
      direct_mention_field TEXT NOT NULL,
      evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      resolver_version TEXT NOT NULL DEFAULT 'person-direct-video-search-v1',
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT person_direct_video_signals_unique
        UNIQUE (person_id, external_video_id)
    );

    CREATE TABLE person_direct_video_signal_runs (
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

  async function insertPerson(slug, canonicalName, aliases = []) {
    const result = await pool.query(
      `INSERT INTO people (slug, canonical_name, aliases)
       VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [slug, canonicalName, JSON.stringify(aliases)]
    );
    return result.rows[0].id;
  }

  async function insertLink({
    personId,
    vehicleBrand = null,
    vehicleSeries = null,
    vehicleModel = null,
    linkConfidence = 0.9
  }) {
    await pool.query(
      `INSERT INTO vehicle_person_links
        (person_id, vehicle_brand, vehicle_series, vehicle_model, link_confidence)
       VALUES ($1, $2, $3, $4, $5)`,
      [personId, vehicleBrand, vehicleSeries, vehicleModel, linkConfidence]
    );
  }

  // Inserts a run row and returns it in the shape
  // executePersonDirectVideoRun expects, bypassing the
  // FOR UPDATE SKIP LOCKED claim transaction entirely (see
  // test-country-event-video-worker.js for the pg-mem
  // limitation this works around).
  async function queueRun(payload = {}) {
    const result = await pool.query(
      `INSERT INTO person_direct_video_signal_runs (status, request_payload)
       VALUES ('RUNNING', $1::jsonb) RETURNING id, request_payload`,
      [JSON.stringify(payload)]
    );
    return result.rows[0];
  }

  return {
    pool,
    insertPerson,
    insertLink,
    queueRun
  };
}

// Hand-rolled mock pool for the claim transaction only.
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
      sql.includes("FROM person_direct_video_signal_runs") &&
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
      sql.includes("UPDATE person_direct_video_signal_runs") &&
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

    const claimed = await claimNextPersonDirectVideoRun(
      emptyPool,
      "worker-1"
    );

    assert.equal(claimed, null);

    const busyPool = createClaimMockPool({
      queuedRuns: [{ id: 1, request_payload: {} }]
    });

    const claimedRun = await claimNextPersonDirectVideoRun(
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
  // Happy path: per-person sequential search (ALL_TIME, no
  // publishedAfter), TITLE / TAGS / DESCRIPTION acceptance,
  // CHANNEL_TITLE-only rejection, and views-desc ranking.
  // -------------------------------------------------------
  {
    const {
      pool,
      insertPerson,
      insertLink,
      queueRun
    } = await buildFixturePool();

    const maxDriver = await insertPerson(
      "max-driver",
      "Max Driver",
      ["Maxy"]
    );
    await insertLink({
      personId: maxDriver,
      vehicleBrand: "Nissan",
      vehicleModel: "GT-R"
    });

    const samHooker = await insertPerson(
      "sam-hooker",
      "Sam Hooker",
      ["Hook"]
    );

    const ellaRacer = await insertPerson(
      "ella-racer",
      "Ella Racer"
    );

    const queuedRun = await queueRun({ max_entities: 10 });

    const mock = createYoutubeFetchMock({
      // One search call per person, in insertion (id ASC)
      // order: Max Driver, Sam Hooker, Ella Racer.
      searchResponses: [
        ["md-title-match", "md-channel-only"],
        ["sh-tags-match"],
        ["er-description-match"]
      ],
      videos: {
        // Higher views but matches only via CHANNEL_TITLE --
        // must never be accepted as a Direct Mention.
        "md-channel-only": {
          id: "md-channel-only",
          title: "Onboard Lap Compilation",
          description: "Weekly compilation.",
          channelTitle: "Max Driver Official",
          views: 900000
        },
        // Lower views, but the TITLE genuinely mentions the
        // person -- this must win.
        "md-title-match": {
          id: "md-title-match",
          title: "Max Driver Sends It At Nurburgring",
          description: "",
          channelTitle: "Random Uploads",
          views: 50000
        },
        "sh-tags-match": {
          id: "sh-tags-match",
          title: "Onboard Footage",
          tags: ["Sam Hooker", "racing"],
          views: 300000
        },
        "er-description-match": {
          id: "er-description-match",
          title: "Drift Day Highlights",
          description: "Featuring Ella Racer on track.",
          views: 150000
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executePersonDirectVideoRun(
        pool,
        queuedRun,
        { apiKey: FAKE_API_KEY }
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.status, "COMPLETED");
    assert.equal(result.entitiesAttempted, 3);
    assert.equal(result.completedEntityCount, 3);
    assert.equal(result.videosMatchedCount, 3);

    // Sequential only: one person's search+videos.list calls
    // never overlap with another's.
    assert.equal(
      mock.maxInFlightRef(),
      1,
      "YouTube search/videos.list calls must be strictly sequential."
    );

    // ALL_TIME: no publishedAfter cutoff on the search call.
    assert.equal(mock.calls.search.length, 3);
    assert.equal(mock.calls.search[0].publishedAfter, null);
    assert.equal(mock.calls.search[0].order, "viewCount");

    const savedRows = await pool.query(
      `SELECT * FROM person_direct_video_signals ORDER BY person_id ASC`
    );

    assert.equal(savedRows.rowCount, 3);

    const maxRow = savedRows.rows.find(
      row => row.person_id === maxDriver
    );

    assert.equal(
      maxRow.external_video_id,
      "md-title-match",
      "The CHANNEL_TITLE-only candidate must be rejected even though it has more views."
    );
    assert.equal(maxRow.direct_mention_field, "TITLE");

    const samRow = savedRows.rows.find(
      row => row.person_id === samHooker
    );

    assert.equal(samRow.direct_mention_field, "TAGS");

    const ellaRow = savedRows.rows.find(
      row => row.person_id === ellaRacer
    );

    assert.equal(ellaRow.direct_mention_field, "DESCRIPTION");

    // Per-person search query: canonical name + strongest
    // vehicle association, never a global candidate scan.
    assert.ok(
      mock.calls.search[0].query.includes("Max Driver")
    );

    const runRow = (
      await pool.query(
        `SELECT * FROM person_direct_video_signal_runs`
      )
    ).rows[0];

    assert.equal(runRow.status, "COMPLETED");
    assert.equal(runRow.videos_matched_count, 3);
    assert.ok(runRow.quota_units_estimated > 0);
  }

  // -------------------------------------------------------
  // CHANNEL_TITLE-only, no other candidate matches: NO_MATCH
  // is recorded, no row persisted.
  // -------------------------------------------------------
  {
    const { pool, insertPerson, queueRun } =
      await buildFixturePool();

    const nora = await insertPerson(
      "nora-nomatch",
      "Nora NoMatch"
    );

    const queuedRun = await queueRun({});

    const mock = createYoutubeFetchMock({
      searchResponses: [["nora-channel-only"]],
      videos: {
        "nora-channel-only": {
          id: "nora-channel-only",
          title: "Random clip",
          description: "",
          channelTitle: "Nora NoMatch Vlogs",
          views: 10000
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executePersonDirectVideoRun(
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
      `SELECT * FROM person_direct_video_signals`
    );

    assert.equal(savedRows.rowCount, 0);
  }

  // -------------------------------------------------------
  // Existing `signals` row: when the matched external video
  // ID is already an ingested signal, signal_id is populated.
  // -------------------------------------------------------
  {
    const { pool, insertPerson, queueRun } =
      await buildFixturePool();

    const vic = await insertPerson(
      "vic-shared",
      "Vic Shared",
      ["Vic"]
    );

    const existingSignal = await pool.query(
      `INSERT INTO signals (external_id) VALUES ('vic-existing') RETURNING id`
    );

    const queuedRun = await queueRun({});

    const mock = createYoutubeFetchMock({
      searchResponses: [["vic-existing"]],
      videos: {
        "vic-existing": {
          id: "vic-existing",
          title: "Vic Shared Drives the New RS3",
          views: 900000
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    try {
      await executePersonDirectVideoRun(pool, queuedRun, {
        apiKey: FAKE_API_KEY
      });
    } finally {
      global.fetch = originalFetch;
    }

    const savedRow = (
      await pool.query(
        `SELECT * FROM person_direct_video_signals`
      )
    ).rows[0];

    assert.equal(
      String(savedRow.signal_id),
      String(existingSignal.rows[0].id)
    );
  }

  // -------------------------------------------------------
  // format=SHORTS must save the Short, not the higher-viewed
  // Long-form video, when both are direct-mention candidates.
  // -------------------------------------------------------
  {
    const { pool, insertPerson, queueRun } =
      await buildFixturePool();

    await insertPerson("sam-hooker", "Sam Hooker", ["Hook"]);

    const queuedRun = await queueRun({
      history_scope: "ALL_TIME",
      format: "SHORTS"
    });

    const mock = createYoutubeFetchMock({
      searchResponses: [["sh-long", "sh-short"]],
      videos: {
        "sh-long": {
          id: "sh-long",
          title: "Sam Hooker Full Onboard Lap",
          views: 20000000,
          duration: "PT10M"
        },
        "sh-short": {
          id: "sh-short",
          title: "Sam Hooker Sends It",
          views: 8000000,
          duration: "PT30S"
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executePersonDirectVideoRun(
        pool,
        queuedRun,
        { apiKey: FAKE_API_KEY }
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.videosMatchedCount, 1);

    const savedRow = (
      await pool.query(
        `SELECT * FROM person_direct_video_signals`
      )
    ).rows[0];

    assert.equal(
      savedRow.external_video_id,
      "sh-short",
      "SHORTS run must persist the Short, never the higher-viewed Long-form video."
    );
    assert.equal(Number(savedRow.video_views), 8000000);
  }

  // -------------------------------------------------------
  // format=ALL must save the higher-viewed Long-form video
  // over a lower-viewed Short.
  // -------------------------------------------------------
  {
    const { pool, insertPerson, queueRun } =
      await buildFixturePool();

    await insertPerson("ada-driver", "Ada Driver");

    const queuedRun = await queueRun({
      history_scope: "ALL_TIME",
      format: "ALL"
    });

    const mock = createYoutubeFetchMock({
      searchResponses: [["ad-long", "ad-short"]],
      videos: {
        "ad-long": {
          id: "ad-long",
          title: "Ada Driver Full Onboard Lap",
          views: 20000000,
          duration: "PT10M"
        },
        "ad-short": {
          id: "ad-short",
          title: "Ada Driver Sends It",
          views: 8000000,
          duration: "PT30S"
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executePersonDirectVideoRun(
        pool,
        queuedRun,
        { apiKey: FAKE_API_KEY }
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.videosMatchedCount, 1);

    const savedRow = (
      await pool.query(
        `SELECT * FROM person_direct_video_signals`
      )
    ).rows[0];

    assert.equal(
      savedRow.external_video_id,
      "ad-long",
      "ALL run must persist the higher-viewed Long-form video."
    );
    assert.equal(Number(savedRow.video_views), 20000000);
  }

  // -------------------------------------------------------
  // history_scope filtering: ONE_YEAR excludes a two-year-old
  // video (no other candidate matches -> NO_MATCH).
  // -------------------------------------------------------
  {
    const { pool, insertPerson, queueRun } =
      await buildFixturePool();

    await insertPerson("nia-old", "Nia Old");

    const queuedRun = await queueRun({
      history_scope: "ONE_YEAR"
    });

    const now = new Date("2026-07-16T00:00:00Z");
    const twoYearsAgo = new Date(
      now.getTime() - 2 * 365 * 24 * 3600000
    ).toISOString();

    const mock = createYoutubeFetchMock({
      searchResponses: [["no-two-years-ago"]],
      videos: {
        "no-two-years-ago": {
          id: "no-two-years-ago",
          title: "Nia Old Classic Onboard",
          views: 500000,
          publishedAt: twoYearsAgo
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executePersonDirectVideoRun(
        pool,
        queuedRun,
        { apiKey: FAKE_API_KEY, now }
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.noMatchEntityCount, 1);
    assert.equal(result.videosMatchedCount, 0);

    const savedRows = await pool.query(
      `SELECT * FROM person_direct_video_signals`
    );

    assert.equal(
      savedRows.rowCount,
      0,
      "ONE_YEAR must exclude a two-year-old video."
    );
  }

  // -------------------------------------------------------
  // history_scope filtering: TEN_YEARS accepts a five-year-old
  // video and excludes a fifteen-year-old one.
  // -------------------------------------------------------
  {
    const { pool, insertPerson, queueRun } =
      await buildFixturePool();

    await insertPerson("ten-year-driver", "Ten Year Driver");

    const queuedRun = await queueRun({
      history_scope: "TEN_YEARS",
      format: "ALL"
    });

    const now = new Date("2026-07-16T00:00:00Z");
    const fiveYearsAgo = new Date(
      now.getTime() - 5 * 365 * 24 * 3600000
    ).toISOString();
    const fifteenYearsAgo = new Date(
      now.getTime() - 15 * 365 * 24 * 3600000
    ).toISOString();

    const mock = createYoutubeFetchMock({
      searchResponses: [
        ["ty-fifteen-years-ago", "ty-five-years-ago"]
      ],
      videos: {
        // Higher views but too old for TEN_YEARS -- must be
        // rejected even though it would otherwise win on views.
        "ty-fifteen-years-ago": {
          id: "ty-fifteen-years-ago",
          title: "Ten Year Driver Vintage Footage",
          views: 9000000,
          publishedAt: fifteenYearsAgo,
          duration: "PT10M"
        },
        "ty-five-years-ago": {
          id: "ty-five-years-ago",
          title: "Ten Year Driver Classic Lap",
          views: 100000,
          publishedAt: fiveYearsAgo,
          duration: "PT10M"
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executePersonDirectVideoRun(
        pool,
        queuedRun,
        { apiKey: FAKE_API_KEY, now }
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.videosMatchedCount, 1);

    const savedRow = (
      await pool.query(
        `SELECT * FROM person_direct_video_signals`
      )
    ).rows[0];

    assert.equal(
      savedRow.external_video_id,
      "ty-five-years-ago",
      "TEN_YEARS must accept the five-year-old video and reject the fifteen-year-old one."
    );
  }

  // -------------------------------------------------------
  // history_scope filtering: ALL_TIME accepts a fifteen-year-
  // old video.
  // -------------------------------------------------------
  {
    const { pool, insertPerson, queueRun } =
      await buildFixturePool();

    await insertPerson("all-time-driver", "All Time Driver");

    const queuedRun = await queueRun({
      history_scope: "ALL_TIME",
      format: "ALL"
    });

    const now = new Date("2026-07-16T00:00:00Z");
    const fifteenYearsAgo = new Date(
      now.getTime() - 15 * 365 * 24 * 3600000
    ).toISOString();

    const mock = createYoutubeFetchMock({
      searchResponses: [["at-fifteen-years-ago"]],
      videos: {
        "at-fifteen-years-ago": {
          id: "at-fifteen-years-ago",
          title: "All Time Driver Archive Footage",
          views: 250000,
          publishedAt: fifteenYearsAgo,
          duration: "PT10M"
        }
      }
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executePersonDirectVideoRun(
        pool,
        queuedRun,
        { apiKey: FAKE_API_KEY, now }
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.videosMatchedCount, 1);

    const savedRow = (
      await pool.query(
        `SELECT * FROM person_direct_video_signals`
      )
    ).rows[0];

    assert.equal(
      savedRow.external_video_id,
      "at-fifteen-years-ago",
      "ALL_TIME must accept a fifteen-year-old video."
    );
  }

  // -------------------------------------------------------
  // More than 20 active people: the 21st+ person is still
  // processed, and the default max_entities is 50 (never 20).
  // -------------------------------------------------------
  {
    const { pool, insertPerson, queueRun } =
      await buildFixturePool();

    const personCount = 21;
    const searchResponses = [];
    const videos = {};

    for (let index = 1; index <= personCount; index += 1) {
      const slug = `bulk-driver-${index}`;
      const name = `Bulk Driver ${index}`;
      const videoId = `bulk-${index}-match`;

      await insertPerson(slug, name);

      searchResponses.push([videoId]);
      videos[videoId] = {
        id: videoId,
        title: `${name} Onboard Highlights`,
        views: 1000 + index
      };
    }

    // No max_entities supplied -- must default to 50, not 20,
    // so all 21 people are attempted.
    const queuedRun = await queueRun({});

    const mock = createYoutubeFetchMock({
      searchResponses,
      videos
    });

    const originalFetch = global.fetch;
    global.fetch = mock.fetchMock;

    let result;

    try {
      result = await executePersonDirectVideoRun(
        pool,
        queuedRun,
        { apiKey: FAKE_API_KEY }
      );
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(result.entitiesAttempted, personCount);
    assert.equal(result.videosMatchedCount, personCount);

    const savedRows = await pool.query(
      `SELECT * FROM person_direct_video_signals WHERE external_video_id = 'bulk-21-match'`
    );

    assert.equal(
      savedRows.rowCount,
      1,
      "The 21st person must still be processed, not truncated at 20."
    );
  }

  console.log(
    "PERSON DIRECT VIDEO WORKER TESTS PASSED"
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

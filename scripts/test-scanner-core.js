const assert = require("node:assert/strict");

const {
  VIRAL_THRESHOLDS,
  classifyShortFormat,
  classifyViralTier,
  deriveSignalMetrics,
  getDurationBucket,
  parseIso8601Duration
} = require("../lib/scanner/metrics");

const {
  extractChannelLookup,
  fetchAllUploadVideoIds
} = require("../lib/scanner/youtube");

const { executeRun } = require("../lib/scanner/engine");

// ---------------------------------------------------------
// ISO 8601 duration parsing
// ---------------------------------------------------------

assert.equal(
  parseIso8601Duration("PT9S"),
  9
);

assert.equal(
  parseIso8601Duration("PT1M20S"),
  80
);

assert.equal(
  parseIso8601Duration("PT1H2M3S"),
  3723
);

// ---------------------------------------------------------
// Duration buckets
// ---------------------------------------------------------

assert.equal(
  getDurationBucket(9),
  "UNDER_10"
);

assert.equal(
  getDurationBucket(10),
  "10_TO_20"
);

assert.equal(
  getDurationBucket(20),
  "10_TO_20"
);

assert.equal(
  getDurationBucket(40),
  "20_TO_40"
);

assert.equal(
  getDurationBucket(41),
  "41_TO_60"
);

assert.equal(
  getDurationBucket(60),
  "41_TO_60"
);

assert.equal(
  getDurationBucket(61),
  "61_TO_180"
);

assert.equal(
  getDurationBucket(180),
  "61_TO_180"
);

assert.equal(
  getDurationBucket(181),
  "OVER_180"
);

// ---------------------------------------------------------
// Shorts classification
// ---------------------------------------------------------

assert.deepEqual(
  classifyShortFormat(0),
  {
    isShort: false,
    shortFormat: "NOT_SHORT",
    shortRejectionReason: "ZERO_DURATION"
  }
);

assert.deepEqual(
  classifyShortFormat(1),
  {
    isShort: true,
    shortFormat: "CLASSIC_SHORT",
    shortRejectionReason: null
  }
);

assert.deepEqual(
  classifyShortFormat(60),
  {
    isShort: true,
    shortFormat: "CLASSIC_SHORT",
    shortRejectionReason: null
  }
);

assert.deepEqual(
  classifyShortFormat(61),
  {
    isShort: true,
    shortFormat: "EXTENDED_SHORT",
    shortRejectionReason: null
  }
);

assert.deepEqual(
  classifyShortFormat(180),
  {
    isShort: true,
    shortFormat: "EXTENDED_SHORT",
    shortRejectionReason: null
  }
);

assert.deepEqual(
  classifyShortFormat(181),
  {
    isShort: false,
    shortFormat: "NOT_SHORT",
    shortRejectionReason: "OVER_180_SECONDS"
  }
);

assert.deepEqual(
  classifyShortFormat(null),
  {
    isShort: false,
    shortFormat: "NOT_SHORT",
    shortRejectionReason: "MISSING_DURATION"
  }
);

assert.deepEqual(
  classifyShortFormat(undefined),
  {
    isShort: false,
    shortFormat: "NOT_SHORT",
    shortRejectionReason: "MISSING_DURATION"
  }
);

// ---------------------------------------------------------
// Channel lookup
// ---------------------------------------------------------

assert.deepEqual(
  extractChannelLookup(
    "https://www.youtube.com/@carwow"
  ),
  {
    type: "handle",
    value: "carwow"
  }
);

assert.deepEqual(
  extractChannelLookup(
    "https://www.youtube.com/channel/UC123"
  ),
  {
    type: "id",
    value: "UC123"
  }
);

// ---------------------------------------------------------
// Metrics
// ---------------------------------------------------------

const firstScan = deriveSignalMetrics({
  views: 24000,
  publishedAt:
    "2026-07-10T00:00:00.000Z",
  now:
    "2026-07-11T00:00:00.000Z"
});

assert.equal(
  firstScan.ageHours,
  24
);

assert.equal(
  firstScan.ageDays,
  1
);

assert.equal(
  firstScan.viewsPerDay,
  24000
);

assert.equal(
  firstScan.viewsPerHour,
  1000
);

// First scan uses cumulative views per hour.
assert.equal(
  firstScan.growthVelocity,
  1000
);

const repeatScan = deriveSignalMetrics({
  views: 30000,
  publishedAt:
    "2026-07-10T00:00:00.000Z",
  previousViews: 24000,
  previousCapturedAt:
    "2026-07-10T18:00:00.000Z",
  now:
    "2026-07-11T00:00:00.000Z"
});

assert.equal(
  repeatScan.growthVelocity,
  1000
);

// Age is floored at 1 hour.
const freshScan = deriveSignalMetrics({
  views: 600,
  publishedAt:
    "2026-07-10T23:30:00.000Z",
  now:
    "2026-07-11T00:00:00.000Z"
});

assert.equal(
  freshScan.ageHours,
  1
);

// ---------------------------------------------------------
// Viral tiers + qualification
// ---------------------------------------------------------

assert.equal(
  VIRAL_THRESHOLDS.PROVEN.minViews,
  1_000_000
);

const megaShort = classifyViralTier({
  isShort: true,
  views: 3_000_000,
  viewsPerDay: 500_000,
  ageDays: 6
});

assert.deepEqual(
  megaShort,
  {
    viralTier: "PROVEN",
    qualified: true
  }
);

assert.deepEqual(
  classifyViralTier({
    isShort: true,
    views: 1_000_000,
    viewsPerDay: 20_000,
    ageDays: 50
  }),
  {
    viralTier: "PROVEN",
    qualified: true
  }
);

const risingShort = classifyViralTier({
  isShort: true,
  views: 100_000,
  viewsPerDay: 50_000,
  ageDays: 2
});

assert.deepEqual(
  risingShort,
  {
    viralTier: "RISING",
    qualified: true
  }
);

assert.deepEqual(
  classifyViralTier({
    isShort: true,
    views: 25_000,
    viewsPerDay: 10_000,
    ageDays: 2
  }),
  {
    viralTier: "WATCH",
    qualified: false
  }
);

// High-view long-form video never qualifies.
assert.deepEqual(
  classifyViralTier({
    isShort: false,
    views: 5_000_000,
    viewsPerDay: 1_000_000,
    ageDays: 2
  }),
  {
    viralTier: "UNQUALIFIED",
    qualified: false
  }
);

// Low-view fresh Short stays below WATCH thresholds.
assert.deepEqual(
  classifyViralTier({
    isShort: true,
    views: 1_000,
    viewsPerDay: 2_000,
    ageDays: 0.5
  }),
  {
    viralTier: "UNQUALIFIED",
    qualified: false
  }
);

// RISING window expires after 14 days.
assert.deepEqual(
  classifyViralTier({
    isShort: true,
    views: 150_000,
    viewsPerDay: 60_000,
    ageDays: 20
  }),
  {
    viralTier: "UNQUALIFIED",
    qualified: false
  }
);

// ---------------------------------------------------------
// Actual Views First ordering
// ---------------------------------------------------------

const provenSignal = {
  views: 3_000_000,
  tier: megaShort.viralTier
};

const risingSignal = {
  views: 100_000,
  tier: risingShort.viralTier
};

const ranked = [
  risingSignal,
  provenSignal
].sort((a, b) => b.views - a.views);

assert.equal(
  ranked[0],
  provenSignal,
  "A 3,000,000-view PROVEN Short must rank above a 100,000-view RISING Short."
);

// ---------------------------------------------------------
// Historical pagination: fetchAllUploadVideoIds
// ---------------------------------------------------------

function createSequencedPlaylistFetch(pages) {
  const calls = [];
  let callCount = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  async function fetchMock(url) {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);

    calls.push(url.toString());

    const page = pages[callCount];
    callCount += 1;

    if (!page) {
      throw new Error(
        "Unexpected extra playlistItems call"
      );
    }

    // A microtask delay so a buggy Promise.all-style caller
    // would overlap two in-flight requests and get caught by
    // the maxInFlight assertion below.
    await new Promise(resolve =>
      setImmediate(resolve)
    );

    inFlight -= 1;

    return {
      ok: true,
      status: 200,
      async json() {
        return {
          items: page.videoIds.map(videoId => ({
            contentDetails: { videoId }
          })),
          nextPageToken: page.nextPageToken
        };
      }
    };
  }

  return {
    fetchMock,
    calls,
    maxInFlightRef: () => maxInFlight
  };
}

async function runPaginationTests() {
  const originalFetch = global.fetch;

  try {
    // Three pages, with a duplicate video id repeated across
    // pages (v2), must dedup and stop once nextPageToken runs
    // out.
    const threePages = [
      { videoIds: ["v1", "v2"], nextPageToken: "TOKEN2" },
      { videoIds: ["v2", "v3"], nextPageToken: "TOKEN3" },
      { videoIds: ["v4"], nextPageToken: undefined }
    ];

    const fullScan = createSequencedPlaylistFetch(
      threePages
    );

    global.fetch = fullScan.fetchMock;

    const fullResult = await fetchAllUploadVideoIds(
      "UPLOADS_PLAYLIST",
      { apiKey: "test-key", maxPages: 10 }
    );

    assert.deepEqual(
      fullResult.videoIds,
      ["v1", "v2", "v3", "v4"],
      "Pagination must dedup repeated video IDs across pages."
    );

    assert.equal(
      fullResult.pagesScanned,
      3,
      "Pagination must stop once nextPageToken is exhausted."
    );

    assert.equal(
      fullResult.truncated,
      false,
      "A fully-walked playlist must not be marked truncated."
    );

    assert.equal(
      fullScan.calls.length,
      3
    );

    assert.ok(
      !fullScan.calls[0].includes("pageToken="),
      "The first page must not send a pageToken."
    );

    assert.ok(
      fullScan.calls[1].includes("pageToken=TOKEN2"),
      "The second page must carry the first page's nextPageToken."
    );

    assert.ok(
      fullScan.calls[2].includes("pageToken=TOKEN3"),
      "The third page must carry the second page's nextPageToken."
    );

    assert.ok(
      fullScan.calls.every(call =>
        call.includes("maxResults=50")
      ),
      "Historical pagination must request 50 items per page."
    );

    assert.equal(
      fullScan.maxInFlightRef(),
      1,
      "Historical pagination must issue playlistItems requests sequentially, never in parallel."
    );

    // maxPages cap: a source with more history than the cap
    // must be reported as truncated, and must never claim to
    // have scanned pages beyond the cap.
    const cappedScan = createSequencedPlaylistFetch(
      threePages
    );

    global.fetch = cappedScan.fetchMock;

    const cappedResult = await fetchAllUploadVideoIds(
      "UPLOADS_PLAYLIST",
      { apiKey: "test-key", maxPages: 2 }
    );

    assert.deepEqual(
      cappedResult.videoIds,
      ["v1", "v2", "v3"]
    );

    assert.equal(cappedResult.pagesScanned, 2);

    assert.equal(
      cappedResult.truncated,
      true,
      "Hitting the page cap before nextPageToken runs out must be reported as truncated."
    );
  } finally {
    global.fetch = originalFetch;
  }
}

// ---------------------------------------------------------
// Historical scanner engine test (executeRun): a fake
// pool/queryable that mirrors the exact SQL shapes engine.js
// issues, and a fake YouTube fetch. This lets the REAL,
// unmodified executeRun run end to end without a live
// Postgres, proving:
//   - HISTORICAL mode ignores max_age_days entirely
//   - CURRENT mode's age cutoff is unchanged (regression)
//   - pagination is integrated (pages_scanned, truncation)
//   - history_complete is computed correctly
// ---------------------------------------------------------

function createFakeEnginePool(sources) {
  const signalsStore = new Map();
  let nextSignalId = 1;
  const calls = [];

  async function query(sql, params = []) {
    calls.push({ sql, params });

    if (sql.includes("FROM sources") && sql.includes("enabled = TRUE")) {
      return { rows: sources, rowCount: sources.length };
    }

    if (sql.includes("FROM countries")) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("FROM vehicles") && sql.includes("enabled = TRUE")) {
      return { rows: [], rowCount: 0 };
    }

    if (sql.includes("UPDATE sources")) {
      // markSourceRunning / markSourceSuccess / markSourceFailed --
      // none of them are read back in this test.
      return { rows: [], rowCount: 1 };
    }

    if (
      sql.includes("FROM signals sig") &&
      sql.includes("LEFT JOIN LATERAL")
    ) {
      const key = `${params[0]}:${params[1]}`;
      const existing = signalsStore.get(key);

      if (!existing) {
        return { rows: [], rowCount: 0 };
      }

      return {
        rows: [
          {
            id: existing.id,
            entity_locked: false,
            previous_views: existing.views,
            previous_captured_at: existing.publishedAt
          }
        ],
        rowCount: 1
      };
    }

    if (sql.trim().startsWith("INSERT INTO signals (")) {
      const key = `${params[0]}:${params[1]}`;
      const existing = signalsStore.get(key);
      const id = existing ? existing.id : nextSignalId++;

      signalsStore.set(key, {
        id,
        sourceId: params[0],
        externalId: params[1],
        title: params[2],
        publishedAt: params[4],
        views: params[6]
      });

      return { rows: [{ id }], rowCount: 1 };
    }

    if (sql.includes("INSERT INTO signal_metric_snapshots")) {
      return { rows: [], rowCount: 1 };
    }

    if (sql.includes("UPDATE scanner_runs")) {
      // finalizeRun always sets error_message; updateRunProgress
      // never does -- that's the only structural difference
      // between the two UPDATE shapes.
      const isFinalize = sql.includes("error_message = $");
      const summaryIndex = isFinalize
        ? params.length - 3
        : params.length - 2;

      return {
        rows: [],
        rowCount: 1,
        __summary: JSON.parse(params[summaryIndex])
      };
    }

    throw new Error(
      `Fake engine pool received an unexpected query:\n${sql}`
    );
  }

  return {
    query,
    calls,
    signalsStore,
    async getLastSummary() {
      for (let index = calls.length - 1; index >= 0; index -= 1) {
        if (calls[index].sql.includes("UPDATE scanner_runs")) {
          const isFinalize = calls[index].sql.includes(
            "error_message = $"
          );
          const summaryIndex = isFinalize
            ? calls[index].params.length - 3
            : calls[index].params.length - 2;

          return JSON.parse(
            calls[index].params[summaryIndex]
          );
        }
      }

      return null;
    }
  };
}

function isoDaysAgo(days) {
  return new Date(
    Date.now() - days * 86400000
  ).toISOString();
}

function jsonFetchResponse(payload) {
  return {
    ok: true,
    status: 200,
    async json() {
      return payload;
    }
  };
}

// Builds a fetch mock covering all three YouTube resources
// (channels, playlistItems, videos) used by executeRun, with
// a configurable set of playlist pages so both single-page
// (CURRENT) and multi-page (HISTORICAL) sources can be tested.
function createEngineYouTubeFetch({
  playlistPages,
  videosById
}) {
  let playlistCallIndex = 0;
  let inFlight = 0;
  let maxInFlight = 0;

  async function fetchMock(url) {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);

    const parsed = new URL(url);

    await new Promise(resolve => setImmediate(resolve));

    inFlight -= 1;

    if (parsed.pathname.endsWith("/channels")) {
      return jsonFetchResponse({
        items: [
          {
            id: "UCTEST",
            snippet: { title: "Test Channel" },
            contentDetails: {
              relatedPlaylists: { uploads: "UUTEST" }
            }
          }
        ]
      });
    }

    if (parsed.pathname.endsWith("/playlistItems")) {
      const page = playlistPages[playlistCallIndex];
      playlistCallIndex += 1;

      if (!page) {
        throw new Error(
          "Unexpected extra playlistItems call"
        );
      }

      return jsonFetchResponse({
        items: page.videoIds.map(videoId => ({
          contentDetails: { videoId }
        })),
        nextPageToken: page.nextPageToken
      });
    }

    if (parsed.pathname.endsWith("/videos")) {
      const ids = (parsed.searchParams.get("id") || "")
        .split(",")
        .filter(Boolean);

      return jsonFetchResponse({
        items: ids
          .map(id => videosById[id])
          .filter(Boolean)
      });
    }

    throw new Error(
      `Unexpected fetch call: ${parsed.pathname}`
    );
  }

  return { fetchMock, maxInFlightRef: () => maxInFlight };
}

function buildVideoItem({
  id,
  title,
  publishedAt,
  views
}) {
  return {
    id,
    snippet: {
      channelId: "UCTEST",
      channelTitle: "Test Channel",
      title,
      description: "",
      tags: [],
      publishedAt,
      thumbnails: {},
      liveBroadcastContent: "none"
    },
    contentDetails: { duration: "PT15S" },
    statistics: {
      viewCount: String(views),
      likeCount: "0",
      commentCount: "0"
    },
    status: { privacyStatus: "public" }
  };
}

const engineSourceFixture = {
  id: "1",
  name: "Test Channel Source",
  url: "https://www.youtube.com/channel/UCTEST",
  priority: 3,
  youtube_channel_id: null,
  youtube_uploads_playlist_id: null
};

async function runHistoricalEngineTests() {
  const originalFetch = global.fetch;

  try {
    // -----------------------------------------------------
    // HISTORICAL mode: a 10-year-old upload must be saved
    // (no max_age_days cutoff), pagination must be walked
    // across both pages, and history_complete must be true
    // when the page cap is never hit.
    // -----------------------------------------------------

    const historicalYouTube = createEngineYouTubeFetch({
      playlistPages: [
        { videoIds: ["histOld"], nextPageToken: "PAGE2" },
        { videoIds: ["histNew"], nextPageToken: null }
      ],
      videosById: {
        histOld: buildVideoItem({
          id: "histOld",
          title: "Historic Old Video",
          publishedAt: isoDaysAgo(3650),
          views: 5000000
        }),
        histNew: buildVideoItem({
          id: "histNew",
          title: "Historic New Video",
          publishedAt: isoDaysAgo(1),
          views: 1000
        })
      }
    });

    global.fetch = historicalYouTube.fetchMock;

    const historicalPool = createFakeEnginePool([
      engineSourceFixture
    ]);

    const historicalResult = await executeRun(
      historicalPool,
      {
        id: 1,
        request_payload: {
          scan_mode: "HISTORICAL",
          max_pages_per_source: 10
        }
      },
      { apiKey: "TEST_KEY" }
    );

    assert.equal(historicalResult.status, "COMPLETED");

    assert.ok(
      historicalPool.signalsStore.has("1:histOld"),
      "HISTORICAL mode must save a 10-year-old upload -- it must never apply the 30-day cutoff."
    );

    assert.ok(
      historicalPool.signalsStore.has("1:histNew")
    );

    const historicalSummary =
      await historicalPool.getLastSummary();

    assert.equal(historicalSummary.scan_mode, "HISTORICAL");
    assert.equal(historicalSummary.pages_scanned, 2);
    assert.equal(historicalSummary.videos_discovered, 2);
    assert.equal(historicalSummary.videos_processed, 2);
    assert.equal(historicalSummary.history_complete, true);
    assert.deepEqual(
      historicalSummary.truncated_sources,
      []
    );
    assert.ok(historicalSummary.oldest_video_published_at);
    assert.ok(historicalSummary.newest_video_published_at);

    assert.equal(
      historicalYouTube.maxInFlightRef(),
      1,
      "The engine must never issue overlapping YouTube requests for a single source."
    );

    // -----------------------------------------------------
    // HISTORICAL mode, page cap hit: history_complete must
    // flip to false and the source must be listed as truncated.
    // -----------------------------------------------------

    const truncatedYouTube = createEngineYouTubeFetch({
      playlistPages: [
        { videoIds: ["histOld"], nextPageToken: "PAGE2" },
        { videoIds: ["histNew"], nextPageToken: null }
      ],
      videosById: {
        histOld: buildVideoItem({
          id: "histOld",
          title: "Historic Old Video",
          publishedAt: isoDaysAgo(3650),
          views: 5000000
        }),
        histNew: buildVideoItem({
          id: "histNew",
          title: "Historic New Video",
          publishedAt: isoDaysAgo(1),
          views: 1000
        })
      }
    });

    global.fetch = truncatedYouTube.fetchMock;

    const truncatedPool = createFakeEnginePool([
      engineSourceFixture
    ]);

    await executeRun(
      truncatedPool,
      {
        id: 2,
        request_payload: {
          scan_mode: "HISTORICAL",
          max_pages_per_source: 1
        }
      },
      { apiKey: "TEST_KEY" }
    );

    const truncatedSummary =
      await truncatedPool.getLastSummary();

    assert.equal(truncatedSummary.pages_scanned, 1);
    assert.equal(truncatedSummary.history_complete, false);
    assert.deepEqual(
      truncatedSummary.truncated_sources,
      ["Test Channel Source"]
    );

    // -----------------------------------------------------
    // CURRENT mode regression: the 400-day-old video must
    // still be rejected by the existing age cutoff, and the
    // recent video must still be saved. Historical-only
    // summary fields must be absent.
    // -----------------------------------------------------

    const currentYouTube = createEngineYouTubeFetch({
      playlistPages: [
        {
          videoIds: ["curOld", "curNew"],
          nextPageToken: null
        }
      ],
      videosById: {
        curOld: buildVideoItem({
          id: "curOld",
          title: "Current Old Video",
          publishedAt: isoDaysAgo(400),
          views: 100000
        }),
        curNew: buildVideoItem({
          id: "curNew",
          title: "Current New Video",
          publishedAt: isoDaysAgo(1),
          views: 50000
        })
      }
    });

    global.fetch = currentYouTube.fetchMock;

    const currentPool = createFakeEnginePool([
      engineSourceFixture
    ]);

    const currentResult = await executeRun(
      currentPool,
      {
        id: 3,
        request_payload: {
          scan_mode: "CURRENT",
          max_age_days: 30,
          max_results_per_source: 10
        }
      },
      { apiKey: "TEST_KEY" }
    );

    assert.equal(currentResult.status, "COMPLETED");

    assert.ok(
      !currentPool.signalsStore.has("1:curOld"),
      "CURRENT mode must still reject uploads older than max_age_days -- this behavior must not regress."
    );

    assert.ok(
      currentPool.signalsStore.has("1:curNew"),
      "CURRENT mode must still save uploads within max_age_days."
    );

    const currentSummary = await currentPool.getLastSummary();

    assert.equal(currentSummary.scan_mode, "CURRENT");
    assert.ok(
      !("pages_scanned" in currentSummary),
      "CURRENT mode summary must never carry HISTORICAL-only fields."
    );
    assert.ok(!("history_complete" in currentSummary));
  } finally {
    global.fetch = originalFetch;
  }
}

async function main() {
  await runPaginationTests();
  await runHistoricalEngineTests();

  console.log(
    "TASK 3.3B SCANNER CORE TESTS PASSED"
  );
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});

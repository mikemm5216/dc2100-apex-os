const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  NO_ACTIVE_VEHICLE_COUNTRIES_ERROR,
  processNextCountryNewsRun
} = require("../lib/news/engine");

const realProvider = require(
  "../lib/news/providers/google-news-rss"
);

const FIXTURE_NOW = new Date(
  "2026-07-12T00:00:00Z"
);

const fixtureXml = fs.readFileSync(
  path.join(
    __dirname,
    "fixtures",
    "google-news-rss-sample.xml"
  ),
  "utf8"
);

const singleFixtureXml = fs.readFileSync(
  path.join(
    __dirname,
    "fixtures",
    "google-news-rss-single-item.xml"
  ),
  "utf8"
);

// ---------------------------------------------------------
// Stateful in-memory mock database
// ---------------------------------------------------------

function createMockDb({ countries, queuedRuns }) {
  const state = {
    runs: new Map(
      queuedRuns.map(run => [
        run.id,
        {
          ...run,
          status: "QUEUED",
          updates: []
        }
      ])
    ),
    clusters: new Map(),
    mentions: new Map(),
    nextClusterId: 1,
    nextMentionId: 1,
    countries
  };

  async function query(sql, values = []) {
    // Claim: select queued run.
    if (
      sql.includes("FROM country_news_runs") &&
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

    // Claim: mark running.
    if (
      sql.includes("UPDATE country_news_runs") &&
      sql.includes("status = 'RUNNING'")
    ) {
      state.runs.get(values[1]).status = "RUNNING";
      return { rows: [], rowCount: 1 };
    }

    // Country selection.
    if (sql.includes("FROM signals sig")) {
      const codes = values[1];

      const rows = state.countries.filter(
        country =>
          codes === null ||
          codes.includes(country.country_code)
      );

      return {
        rows: rows.slice(0, values[2]),
        rowCount: rows.length
      };
    }

    // Existing clusters for a country.
    if (
      sql.includes("FROM country_news_signals") &&
      sql.includes("last_seen_at >=")
    ) {
      const rows = [...state.clusters.values()]
        .filter(
          cluster =>
            cluster.country_id === values[0]
        )
        .map(cluster => ({
          id: cluster.id,
          story_hash: cluster.story_hash,
          canonical_title: cluster.canonical_title,
          published_at: cluster.published_at
        }));

      return { rows, rowCount: rows.length };
    }

    // Cluster upsert.
    if (
      sql.includes("INSERT INTO country_news_signals")
    ) {
      const key = `${values[0]}::${values[1]}`;

      const existing = state.clusters.get(key);

      if (existing) {
        return {
          rows: [
            { id: existing.id, inserted: false }
          ],
          rowCount: 1
        };
      }

      const cluster = {
        id: state.nextClusterId,
        country_id: values[0],
        story_hash: values[1],
        canonical_title: values[2],
        published_at: values[7]
      };

      state.nextClusterId += 1;
      state.clusters.set(key, cluster);

      return {
        rows: [{ id: cluster.id, inserted: true }],
        rowCount: 1
      };
    }

    // Mention upsert.
    if (
      sql.includes(
        "INSERT INTO country_news_mentions"
      )
    ) {
      const externalKey = values[2];

      const existing =
        state.mentions.get(externalKey);

      if (existing) {
        existing.last_seen = true;

        return {
          rows: [
            { id: existing.id, inserted: false }
          ],
          rowCount: 1
        };
      }

      const mention = {
        id: state.nextMentionId,
        news_signal_id: values[0],
        external_key: externalKey,
        query_key: values[3],
        feed_rank: values[5],
        title: values[6],
        normalized_title: values[7],
        url: values[8],
        source_name: values[10],
        publisher_domain: values[12],
        published_at: values[13],
        snippet: values[14],
        raw_metadata: JSON.parse(values[15])
      };

      state.nextMentionId += 1;
      state.mentions.set(externalKey, mention);

      return {
        rows: [{ id: mention.id, inserted: true }],
        rowCount: 1
      };
    }

    // Cluster mention load.
    if (
      sql.includes("FROM country_news_mentions") &&
      sql.includes("WHERE news_signal_id = $1")
    ) {
      const rows = [...state.mentions.values()]
        .filter(
          mention =>
            mention.news_signal_id === values[0]
        );

      return { rows, rowCount: rows.length };
    }

    // Cluster finalize update.
    if (
      sql.includes("UPDATE country_news_signals")
    ) {
      const clusterId = values[values.length - 1];

      for (const cluster of state.clusters.values()) {
        if (cluster.id === clusterId) {
          cluster.traffic_tier = values[10];
          cluster.traffic_score = values[11];
          cluster.transformation_tier = values[17];
        }
      }

      return { rows: [], rowCount: 1 };
    }

    // Run finalize (has status bind) or progress update.
    if (sql.includes("UPDATE country_news_runs")) {
      if (sql.includes("status = $1")) {
        const run = state.runs.get(
          values[values.length - 1]
        );

        run.status = values[0];
        run.finalCounters = {
          country_count: values[1],
          completed_country_count: values[2],
          failed_country_count: values[3],
          query_count: values[4],
          succeeded_query_count: values[5],
          item_count: values[6],
          mention_inserted_count: values[7],
          mention_updated_count: values[8],
          cluster_inserted_count: values[9],
          cluster_updated_count: values[10],
          summary: JSON.parse(values[11]),
          error_message: values[12]
        };

        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("status = 'FAILED'")) {
        const run = state.runs.get(values[1]);
        run.status = "FAILED";
        run.error_message = values[0];

        return { rows: [], rowCount: 1 };
      }

      // Progress update.
      const run = state.runs.get(
        values[values.length - 1]
      );

      run.updates.push(JSON.parse(values[10]));

      return { rows: [], rowCount: 1 };
    }

    throw new Error(
      `Mock database received an unexpected query: ${sql.slice(0, 80)}`
    );
  }

  const pool = {
    query,

    async connect() {
      return {
        async query(sql, values) {
          if (
            sql === "BEGIN" ||
            sql === "COMMIT" ||
            sql === "ROLLBACK"
          ) {
            return { rows: [], rowCount: 0 };
          }

          return query(sql, values);
        },

        release() {}
      };
    }
  };

  return { pool, state };
}

function createMockProvider({ failCountries = [] }) {
  return {
    ...realProvider,

    async fetchQuery({ queryKey, queryText, maxItems }) {
      const failed = failCountries.some(name =>
        queryText.includes(name)
      );

      if (failed) {
        const error = new Error(
          `Simulated provider failure for ${queryText}.`
        );

        error.code = "RSS_HTTP_ERROR";
        throw error;
      }

      const xml = queryText.includes("Germany")
        ? singleFixtureXml
        : fixtureXml;

      const items = realProvider.parseRssItems(xml, {
        queryKey,
        queryText
      });

      return {
        provider: realProvider.PROVIDER_ID,
        queryKey,
        queryText,
        items: items.slice(0, maxItems)
      };
    }
  };
}

const JP = {
  country_id: 1,
  country_code: "JP",
  country_name: "Japan",
  vehicle_signal_count: 12,
  qualified_vehicle_signal_count: 4,
  vehicle_views_total: "9000000",
  vehicle_views_max: "4000000",
  brands: ["Toyota"],
  models: ["Supra"]
};

const DE = {
  country_id: 2,
  country_code: "DE",
  country_name: "Germany",
  vehicle_signal_count: 8,
  qualified_vehicle_signal_count: 2,
  vehicle_views_total: "5000000",
  vehicle_views_max: "2500000",
  brands: ["Porsche"],
  models: ["911"]
};

async function run() {
  // -------------------------------------------------------
  // Claim one queued run; second poll returns null.
  // -------------------------------------------------------

  const happy = createMockDb({
    countries: [JP, DE],
    queuedRuns: [
      {
        id: 1,
        request_payload: {
          max_countries: 2,
          max_queries_per_country: 2,
          max_items_per_query: 10,
          max_age_hours: 72
        }
      }
    ]
  });

  const startedRuns = [];
  const completedCountries = [];

  const happyResult =
    await processNextCountryNewsRun(happy.pool, {
      workerId: "test-worker",
      provider: createMockProvider({}),
      now: FIXTURE_NOW,
      onRunStarted(run) {
        startedRuns.push(run.id);
      },
      onCountryCompleted(country) {
        completedCountries.push(
          country.country_code
        );
      }
    });

  assert.equal(happyResult.status, "COMPLETED");
  assert.deepEqual(startedRuns, [1]);
  assert.deepEqual(completedCountries, ["JP", "DE"]);

  assert.equal(happyResult.countryCount, 2);
  assert.equal(happyResult.completedCountryCount, 2);
  assert.equal(happyResult.failedCountryCount, 0);
  assert.equal(happyResult.queryCount, 4);
  assert.equal(happyResult.succeededQueryCount, 4);
  assert.ok(happyResult.itemCount > 0);
  assert.ok(happyResult.mentionInsertedCount > 0);
  assert.ok(happyResult.clusterInsertedCount > 0);

  // Counters persisted on the run row.
  const happyRun = happy.state.runs.get(1);

  assert.equal(happyRun.status, "COMPLETED");
  assert.equal(
    happyRun.finalCounters.completed_country_count,
    2
  );
  assert.equal(
    happyRun.finalCounters.mention_inserted_count,
    happyResult.mentionInsertedCount
  );

  // Structured summary generated.
  const summary = happyRun.finalCounters.summary;

  assert.equal(summary.selected_countries.length, 2);
  assert.equal(
    summary.selected_countries[0].country_code,
    "JP"
  );
  assert.ok(
    Array.isArray(summary.country_results)
  );
  assert.equal(
    summary.provider,
    realProvider.PROVIDER_ID
  );
  assert.equal(
    summary.resolver_version,
    "country-news-rules-v1"
  );
  assert.equal(summary.max_age_hours, 72);
  assert.ok("breakout_count" in summary);
  assert.ok("high_transformation_count" in summary);

  // Queue drained: nothing left to claim.
  const drained = await processNextCountryNewsRun(
    happy.pool,
    {
      workerId: "test-worker",
      provider: createMockProvider({}),
      now: FIXTURE_NOW
    }
  );

  assert.equal(drained, null);

  // -------------------------------------------------------
  // Rerun idempotency: same fixture twice never duplicates
  // mentions or clusters; existing stories update instead.
  // -------------------------------------------------------

  happy.state.runs.set(2, {
    id: 2,
    status: "QUEUED",
    request_payload: {
      max_countries: 2,
      max_queries_per_country: 2,
      max_items_per_query: 10,
      max_age_hours: 72
    },
    updates: []
  });

  const mentionCountBefore =
    happy.state.mentions.size;
  const clusterCountBefore =
    happy.state.clusters.size;

  const rerunResult =
    await processNextCountryNewsRun(happy.pool, {
      workerId: "test-worker",
      provider: createMockProvider({}),
      now: FIXTURE_NOW
    });

  assert.equal(rerunResult.status, "COMPLETED");
  assert.equal(rerunResult.mentionInsertedCount, 0);
  assert.ok(rerunResult.mentionUpdatedCount > 0);
  assert.equal(rerunResult.clusterInsertedCount, 0);
  assert.ok(rerunResult.clusterUpdatedCount > 0);

  assert.equal(
    happy.state.mentions.size,
    mentionCountBefore,
    "A rerun must not create duplicate mentions."
  );

  assert.equal(
    happy.state.clusters.size,
    clusterCountBefore,
    "A rerun must not create duplicate clusters."
  );

  // -------------------------------------------------------
  // Country failure does not stop the next country.
  // -------------------------------------------------------

  const partial = createMockDb({
    countries: [JP, DE],
    queuedRuns: [
      {
        id: 1,
        request_payload: {
          max_countries: 2,
          max_queries_per_country: 2,
          max_items_per_query: 10,
          max_age_hours: 72
        }
      }
    ]
  });

  const partialResult =
    await processNextCountryNewsRun(partial.pool, {
      workerId: "test-worker",
      provider: createMockProvider({
        failCountries: ["Japan"]
      }),
      now: FIXTURE_NOW
    });

  assert.equal(
    partialResult.status,
    "COMPLETED",
    "One successful country keeps the run COMPLETED."
  );

  assert.equal(
    partialResult.completedCountryCount,
    1
  );
  assert.equal(partialResult.failedCountryCount, 1);

  assert.ok(
    partialResult.errors.some(
      item =>
        item.scope === "query" &&
        item.country_code === "JP"
    ),
    "Query failures must be recorded as structured errors."
  );

  assert.ok(
    partialResult.errors.some(
      item =>
        item.scope === "country" &&
        item.country_code === "JP"
    ),
    "Country failures must be recorded as structured errors."
  );

  // -------------------------------------------------------
  // All countries failed => run FAILED.
  // -------------------------------------------------------

  const failing = createMockDb({
    countries: [JP, DE],
    queuedRuns: [
      {
        id: 1,
        request_payload: { max_countries: 2 }
      }
    ]
  });

  const failingResult =
    await processNextCountryNewsRun(failing.pool, {
      workerId: "test-worker",
      provider: createMockProvider({
        failCountries: ["Japan", "Germany"]
      }),
      now: FIXTURE_NOW
    });

  assert.equal(failingResult.status, "FAILED");
  assert.equal(
    failingResult.completedCountryCount,
    0
  );
  assert.equal(failingResult.failedCountryCount, 2);
  assert.equal(
    failing.state.runs.get(1).status,
    "FAILED"
  );

  // -------------------------------------------------------
  // No active vehicle countries => FAILED with the
  // documented error code.
  // -------------------------------------------------------

  const empty = createMockDb({
    countries: [],
    queuedRuns: [
      {
        id: 1,
        request_payload: {}
      }
    ]
  });

  const emptyResult =
    await processNextCountryNewsRun(empty.pool, {
      workerId: "test-worker",
      provider: createMockProvider({}),
      now: FIXTURE_NOW
    });

  assert.equal(emptyResult.status, "FAILED");
  assert.equal(
    emptyResult.errorCode,
    NO_ACTIVE_VEHICLE_COUNTRIES_ERROR
  );

  assert.equal(
    empty.state.runs.get(1).error_message,
    NO_ACTIVE_VEHICLE_COUNTRIES_ERROR
  );

  console.log(
    "TASK 3.3D COUNTRY NEWS WORKER TESTS PASSED"
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR,
  processNextPersonRadarRun
} = require("../lib/person/engine");

const realProvider = require(
  "../lib/news/providers/google-news-rss"
);

const FIXTURE_NOW = new Date(
  "2026-07-12T00:00:00Z"
);

const personFixtureXml = fs.readFileSync(
  path.join(
    __dirname,
    "fixtures",
    "person-news-rss-sample.xml"
  ),
  "utf8"
);

// ---------------------------------------------------------
// Active vehicle anchors (recent resolved Shorts)
// ---------------------------------------------------------

const ANCHORS = [
  {
    id: "1",
    title: "Lei Jun launches Xiaomi SU7 Ultra",
    channel_title: "Xiaomi",
    views: "8000000",
    qualified: true,
    vehicle_brand: "Xiaomi",
    vehicle_series: "SU7",
    vehicle_model: "SU7 Ultra",
    vehicle_action: "REVEAL",
    resolved_vehicle_id: null,
    vehicle_country_code: "CN"
  },
  {
    id: "2",
    title: "Tesla Roadster acceleration test",
    channel_title: "EV Channel",
    views: "3000000",
    qualified: true,
    vehicle_brand: "Tesla",
    vehicle_series: null,
    vehicle_model: null,
    vehicle_action: "ACCELERATION",
    resolved_vehicle_id: null,
    vehicle_country_code: "US"
  }
];

// ---------------------------------------------------------
// Stateful in-memory mock database
// ---------------------------------------------------------

function createMockDb({ anchors, queuedRuns }) {
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
    people: new Map(),
    links: new Map(),
    signals: new Map(),
    mentions: new Map(),
    nextPersonId: 1,
    nextSignalId: 1,
    nextMentionId: 1,
    anchors
  };

  async function query(sql, values = []) {
    // Claim: select queued run.
    if (
      sql.includes("FROM person_radar_runs") &&
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
      sql.includes("UPDATE person_radar_runs") &&
      sql.includes("status = 'RUNNING'")
    ) {
      state.runs.get(values[1]).status = "RUNNING";
      return { rows: [], rowCount: 1 };
    }

    // Active vehicle anchors.
    if (sql.includes("FROM signals sig")) {
      return {
        rows: state.anchors,
        rowCount: state.anchors.length
      };
    }

    // Country lookup.
    if (sql.includes("FROM countries")) {
      return {
        rows: [
          { id: 10, code: "CN" },
          { id: 11, code: "US" },
          { id: 12, code: "JP" },
          { id: 13, code: "GB" }
        ],
        rowCount: 4
      };
    }

    // People upsert.
    if (sql.includes("INSERT INTO people")) {
      const slug = values[0];

      let person = state.people.get(slug);

      if (!person) {
        person = {
          id: state.nextPersonId,
          slug,
          active: true
        };

        state.nextPersonId += 1;
        state.people.set(slug, person);
      }

      return {
        rows: [
          {
            id: person.id,
            slug: person.slug,
            active: person.active
          }
        ],
        rowCount: 1
      };
    }

    // Vehicle-person link upsert.
    if (
      sql.includes(
        "INSERT INTO vehicle_person_links"
      )
    ) {
      const key = [
        values[0],
        values[2] || "",
        values[3] || "",
        values[4] || "",
        values[5]
      ].join("::");

      const existing = state.links.get(key);

      if (existing && existing.locked) {
        // Locked links are never overwritten.
        return { rows: [], rowCount: 0 };
      }

      state.links.set(key, {
        person_id: values[0],
        vehicle_brand: values[2],
        vehicle_series: values[3],
        vehicle_model: values[4],
        relation_type: values[5],
        link_confidence: values[6],
        link_method: values[7],
        locked: existing ? existing.locked : false
      });

      return { rows: [], rowCount: 1 };
    }

    // Person traffic signal shell upsert.
    if (
      sql.includes(
        "INSERT INTO person_traffic_signals"
      )
    ) {
      const personId = values[0];

      const existing = state.signals.get(personId);

      if (existing) {
        return {
          rows: [
            { id: existing.id, inserted: false }
          ],
          rowCount: 1
        };
      }

      const signal = {
        id: state.nextSignalId,
        person_id: personId
      };

      state.nextSignalId += 1;
      state.signals.set(personId, signal);

      return {
        rows: [{ id: signal.id, inserted: true }],
        rowCount: 1
      };
    }

    // Person mention upsert.
    if (
      sql.includes(
        "INSERT INTO person_traffic_mentions"
      )
    ) {
      const personId = values[1];
      const externalKey = values[2];
      const key = `${personId}::${externalKey}`;

      const existing = state.mentions.get(key);

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
        person_traffic_signal_id: values[0],
        person_id: personId,
        external_key: externalKey,
        query_key: values[3],
        feed_rank: values[5],
        title: values[6],
        url: values[8],
        source_name: values[10],
        publisher_domain: values[12],
        published_at: values[13],
        snippet: values[14],
        person_match_method: values[15],
        person_confidence: values[16],
        raw_metadata: JSON.parse(values[17])
      };

      state.nextMentionId += 1;
      state.mentions.set(key, mention);

      return {
        rows: [{ id: mention.id, inserted: true }],
        rowCount: 1
      };
    }

    // Load mentions for one person signal.
    if (
      sql.includes(
        "FROM person_traffic_mentions"
      ) &&
      sql.includes(
        "WHERE person_traffic_signal_id = $1"
      )
    ) {
      const rows = [
        ...state.mentions.values()
      ].filter(
        mention =>
          mention.person_traffic_signal_id ===
          values[0]
      );

      return { rows, rowCount: rows.length };
    }

    // Finalize person signal.
    if (
      sql.includes(
        "UPDATE person_traffic_signals"
      )
    ) {
      const signalId = values[values.length - 1];

      for (const signal of state.signals.values()) {
        if (signal.id === signalId) {
          signal.traffic_tier = values[0];
          signal.traffic_score = values[1];
          signal.vehicle_attention_score = values[2];
          signal.news_coverage_score = values[3];
          signal.vehicle_views_total = values[7];
          signal.news_mention_count = values[9];
          signal.publisher_count = values[10];
          signal.transformation_tier = values[15];
          signal.representative_headline =
            values[17];
        }
      }

      return { rows: [], rowCount: 1 };
    }

    // Run finalize / failure / progress updates.
    if (sql.includes("UPDATE person_radar_runs")) {
      if (sql.includes("status = $1")) {
        const run = state.runs.get(
          values[values.length - 1]
        );

        run.status = values[0];
        run.finalCounters = {
          person_count: values[1],
          completed_person_count: values[2],
          failed_person_count: values[3],
          query_count: values[4],
          succeeded_query_count: values[5],
          item_count: values[6],
          mention_inserted_count: values[7],
          mention_updated_count: values[8],
          signal_inserted_count: values[9],
          signal_updated_count: values[10],
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

function createMockProvider({
  failPeople = [],
  emptyResults = false
} = {}) {
  return {
    ...realProvider,

    async fetchQuery({ queryKey, queryText, maxItems }) {
      const failed = failPeople.some(name =>
        queryText.includes(name)
      );

      if (failed) {
        const error = new Error(
          `Simulated provider failure for ${queryText}.`
        );

        error.code = "RSS_HTTP_ERROR";
        throw error;
      }

      if (emptyResults) {
        return {
          provider: realProvider.PROVIDER_ID,
          queryKey,
          queryText,
          items: []
        };
      }

      const items = realProvider.parseRssItems(
        personFixtureXml,
        { queryKey, queryText }
      );

      return {
        provider: realProvider.PROVIDER_ID,
        queryKey,
        queryText,
        items: items.slice(0, maxItems)
      };
    }
  };
}

const RUN_PAYLOAD = {
  max_people: 5,
  vehicle_window_days: 14,
  max_queries_per_person: 2,
  max_items_per_query: 10,
  max_age_hours: 72
};

async function run() {
  // -------------------------------------------------------
  // Claim one queued run; happy path.
  // -------------------------------------------------------

  const happy = createMockDb({
    anchors: ANCHORS,
    queuedRuns: [
      { id: 1, request_payload: RUN_PAYLOAD }
    ]
  });

  const startedRuns = [];
  const completedPeople = [];

  const happyResult =
    await processNextPersonRadarRun(happy.pool, {
      workerId: "test-worker",
      provider: createMockProvider(),
      now: FIXTURE_NOW,
      onRunStarted(run) {
        startedRuns.push(run.id);
      },
      onPersonCompleted(person) {
        completedPeople.push(person.slug);
      }
    });

  assert.equal(happyResult.status, "COMPLETED");
  assert.deepEqual(startedRuns, [1]);

  // Lei Jun (direct mention, 8M views) is processed
  // before Elon Musk (brand association, 3M views).
  assert.deepEqual(completedPeople, [
    "lei-jun",
    "elon-musk",
    "mat-watson"
  ]);

  assert.equal(happyResult.personCount, 3);
  assert.equal(happyResult.completedPersonCount, 3);
  assert.equal(happyResult.failedPersonCount, 0);
  assert.equal(happyResult.queryCount, 6);
  assert.equal(happyResult.succeededQueryCount, 6);
  assert.ok(happyResult.itemCount > 0);
  assert.ok(happyResult.mentionInsertedCount > 0);
  assert.equal(happyResult.signalInsertedCount, 3);

  // Vehicle-person links persisted.
  assert.ok(happy.state.links.size >= 2);

  // Person signals persisted with separated evidence.
  const leiJunId =
    happy.state.people.get("lei-jun").id;

  const leiJunSignal =
    happy.state.signals.get(leiJunId);

  assert.ok(leiJunSignal);
  assert.equal(
    leiJunSignal.vehicle_views_total,
    8000000,
    "Actual vehicle views must be kept as raw numbers."
  );
  assert.ok(leiJunSignal.news_mention_count > 0);
  assert.ok(leiJunSignal.traffic_tier);
  assert.ok(leiJunSignal.transformation_tier);
  assert.ok(
    leiJunSignal.representative_headline,
    "Verified mentions must produce a headline."
  );

  // Counters persisted on the run row.
  const happyRun = happy.state.runs.get(1);

  assert.equal(happyRun.status, "COMPLETED");
  assert.equal(
    happyRun.finalCounters.completed_person_count,
    3
  );
  assert.equal(
    happyRun.finalCounters.mention_inserted_count,
    happyResult.mentionInsertedCount
  );

  // Structured summary generated.
  const summary = happyRun.finalCounters.summary;

  assert.equal(summary.selected_people.length, 3);
  assert.equal(
    summary.selected_people[0].person_slug,
    "lei-jun"
  );
  assert.ok(Array.isArray(summary.person_results));
  assert.equal(
    summary.provider,
    realProvider.PROVIDER_ID
  );
  assert.equal(
    summary.resolver_version,
    "vehicle-person-rules-v1"
  );
  assert.equal(summary.vehicle_window_days, 14);
  assert.equal(summary.max_age_hours, 72);
  assert.ok("breakout_count" in summary);
  assert.ok("high_transformation_count" in summary);
  assert.ok(
    "direct_mention_person_count" in summary
  );
  assert.equal(
    summary.direct_mention_person_count,
    1
  );
  assert.equal(
    summary.brand_association_person_count,
    2
  );

  // Fair queue handling: a drained queue returns null
  // immediately, so the worker loop can serve the other
  // queues without blocking.
  const drained = await processNextPersonRadarRun(
    happy.pool,
    {
      workerId: "test-worker",
      provider: createMockProvider(),
      now: FIXTURE_NOW
    }
  );

  assert.equal(drained, null);

  // -------------------------------------------------------
  // Rerun idempotency: same fixture twice never
  // duplicates mentions or signals.
  // -------------------------------------------------------

  happy.state.runs.set(2, {
    id: 2,
    status: "QUEUED",
    request_payload: RUN_PAYLOAD,
    updates: []
  });

  const mentionCountBefore =
    happy.state.mentions.size;
  const signalCountBefore = happy.state.signals.size;

  const rerunResult =
    await processNextPersonRadarRun(happy.pool, {
      workerId: "test-worker",
      provider: createMockProvider(),
      now: FIXTURE_NOW
    });

  assert.equal(rerunResult.status, "COMPLETED");
  assert.equal(rerunResult.mentionInsertedCount, 0);
  assert.ok(rerunResult.mentionUpdatedCount > 0);
  assert.equal(rerunResult.signalInsertedCount, 0);
  assert.equal(rerunResult.signalUpdatedCount, 3);

  assert.equal(
    happy.state.mentions.size,
    mentionCountBefore,
    "A rerun must not create duplicate mentions."
  );

  assert.equal(
    happy.state.signals.size,
    signalCountBefore,
    "A rerun must not create duplicate signals."
  );

  // The same article linked two different people with
  // verified alias evidence (Lei Jun + Elon Musk are both
  // named in the dual-fixture headline).
  const dualKeyMentions = [
    ...happy.state.mentions.values()
  ].filter(
    mention =>
      mention.url.includes(
        "fixture-person-dual-1"
      ) &&
      mention.person_match_method === "TITLE_ALIAS"
  );

  assert.equal(
    dualKeyMentions.length,
    2,
    "The same article must link both mentioned people."
  );

  assert.equal(
    new Set(
      dualKeyMentions.map(
        mention => mention.external_key
      )
    ).size,
    1,
    "Both people share the same person-neutral key."
  );

  // -------------------------------------------------------
  // Person failure does not stop the next person.
  // -------------------------------------------------------

  const partial = createMockDb({
    anchors: ANCHORS,
    queuedRuns: [
      { id: 1, request_payload: RUN_PAYLOAD }
    ]
  });

  const partialResult =
    await processNextPersonRadarRun(partial.pool, {
      workerId: "test-worker",
      provider: createMockProvider({
        failPeople: ["Lei Jun"]
      }),
      now: FIXTURE_NOW
    });

  assert.equal(
    partialResult.status,
    "COMPLETED",
    "One successful person keeps the run COMPLETED."
  );

  assert.equal(
    partialResult.completedPersonCount,
    2
  );
  assert.equal(partialResult.failedPersonCount, 1);

  assert.ok(
    partialResult.errors.some(
      item =>
        item.scope === "query" &&
        item.person_slug === "lei-jun"
    ),
    "Query failures must be recorded as structured errors."
  );

  assert.ok(
    partialResult.errors.some(
      item =>
        item.scope === "person" &&
        item.person_slug === "lei-jun"
    ),
    "Person failures must be recorded as structured errors."
  );

  // -------------------------------------------------------
  // All people failed => run FAILED.
  // -------------------------------------------------------

  const failing = createMockDb({
    anchors: ANCHORS,
    queuedRuns: [
      { id: 1, request_payload: RUN_PAYLOAD }
    ]
  });

  const failingResult =
    await processNextPersonRadarRun(failing.pool, {
      workerId: "test-worker",
      provider: createMockProvider({
        failPeople: [
          "Lei Jun",
          "Elon Musk",
          "Mat Watson"
        ]
      }),
      now: FIXTURE_NOW
    });

  assert.equal(failingResult.status, "FAILED");
  assert.equal(
    failingResult.completedPersonCount,
    0
  );
  assert.equal(failingResult.failedPersonCount, 3);
  assert.equal(
    failing.state.runs.get(1).status,
    "FAILED"
  );

  // -------------------------------------------------------
  // No active vehicle anchors => FAILED with the
  // documented error code. No person signal may exist
  // without a vehicle anchor.
  // -------------------------------------------------------

  const empty = createMockDb({
    anchors: [],
    queuedRuns: [
      { id: 1, request_payload: {} }
    ]
  });

  const emptyResult =
    await processNextPersonRadarRun(empty.pool, {
      workerId: "test-worker",
      provider: createMockProvider(),
      now: FIXTURE_NOW
    });

  assert.equal(emptyResult.status, "FAILED");
  assert.equal(
    emptyResult.errorCode,
    NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR
  );
  assert.equal(
    empty.state.runs.get(1).error_message,
    NO_ACTIVE_VEHICLE_LINKED_PEOPLE_ERROR
  );
  assert.equal(
    empty.state.signals.size,
    0,
    "No vehicle anchor means no person signal."
  );

  // -------------------------------------------------------
  // No RSS news but vehicle attention exists => the run
  // still COMPLETES with a vehicle-only signal.
  // -------------------------------------------------------

  const noNews = createMockDb({
    anchors: ANCHORS,
    queuedRuns: [
      { id: 1, request_payload: RUN_PAYLOAD }
    ]
  });

  const noNewsResult =
    await processNextPersonRadarRun(noNews.pool, {
      workerId: "test-worker",
      provider: createMockProvider({
        emptyResults: true
      }),
      now: FIXTURE_NOW
    });

  assert.equal(noNewsResult.status, "COMPLETED");
  assert.equal(noNewsResult.completedPersonCount, 3);
  assert.equal(noNewsResult.mentionInsertedCount, 0);

  const noNewsLeiJunId =
    noNews.state.people.get("lei-jun").id;

  const noNewsSignal = noNews.state.signals.get(
    noNewsLeiJunId
  );

  assert.ok(
    noNewsSignal,
    "Vehicle-only person signal must still exist."
  );
  assert.equal(noNewsSignal.news_mention_count, 0);
  assert.equal(noNewsSignal.news_coverage_score, 0);
  assert.equal(
    noNewsSignal.representative_headline,
    null
  );
  assert.ok(
    Number(noNewsSignal.traffic_score) > 0,
    "Vehicle attention alone must still produce a score."
  );

  console.log(
    "TASK 3.3E PERSON WORKER TESTS PASSED"
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

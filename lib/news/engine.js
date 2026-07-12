// =========================================================
// COUNTRY NEWS ENGINE — Task 3.3D
//
// Claims queued country-news runs, selects active vehicle
// countries from recent Shorts, fetches public news feed
// metadata, clusters same-story mentions, and persists
// proxy traffic evidence plus transformation potential.
//
// Vehicle views ONLY drive country selection priority;
// they never enter the news traffic score.
// =========================================================

const { createHash } = require("node:crypto");

const {
  buildCountryQueries,
  normalizeNewsRunPayload
} = require("./country-query-catalog");

const {
  normalizeHeadline
} = require("./normalization");

const {
  CLUSTERING_RULES,
  clusterMentions
} = require("./clustering");

const {
  deriveClusterTrafficEvidence
} = require("./metrics");

const {
  NEWS_RESOLVER_VERSION,
  calculateTransformationPotential,
  classifyCategory,
  extractConflictArchetypes,
  extractCrisisKeywords,
  resolveCountryEvidence
} = require("./classification");

const defaultProvider = require(
  "./providers/google-news-rss"
);

// Recent Vehicle Shorts window that decides which
// countries are active.
const VEHICLE_WINDOW_DAYS = 14;

const NO_ACTIVE_VEHICLE_COUNTRIES_ERROR =
  "NO_ACTIVE_VEHICLE_COUNTRIES";

function sha256(value) {
  return createHash("sha256")
    .update(String(value))
    .digest("hex");
}

function buildExternalKey(countryCode, item) {
  const identity = item.guid || item.url;

  return `gnews:${countryCode}:${sha256(identity)}`;
}

// =========================================================
// RUN QUEUE
// =========================================================

async function claimNextNewsRun(pool, workerId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const queuedResult = await client.query(
      `
        SELECT
          id,
          request_payload
        FROM country_news_runs
        WHERE status = 'QUEUED'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `
    );

    if (queuedResult.rowCount === 0) {
      await client.query("COMMIT");
      return null;
    }

    const run = queuedResult.rows[0];

    await client.query(
      `
        UPDATE country_news_runs
        SET
          status = 'RUNNING',
          locked_by = $1,
          locked_at = NOW(),
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW()
        WHERE id = $2
      `,
      [workerId, run.id]
    );

    await client.query("COMMIT");

    return run;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failure.
    }

    throw error;
  } finally {
    client.release();
  }
}

// =========================================================
// COUNTRY SELECTION
// =========================================================

async function selectActiveCountries(pool, options) {
  const result = await pool.query(
    `
      SELECT
        c.id AS country_id,
        c.code AS country_code,
        c.name AS country_name,

        COUNT(*)::int AS vehicle_signal_count,

        COUNT(*) FILTER (
          WHERE sig.qualified
        )::int AS qualified_vehicle_signal_count,

        COALESCE(SUM(sig.views), 0)::bigint
          AS vehicle_views_total,

        COALESCE(MAX(sig.views), 0)::bigint
          AS vehicle_views_max,

        ARRAY_REMOVE(
          ARRAY_AGG(DISTINCT sig.vehicle_brand),
          NULL
        ) AS brands,

        ARRAY_REMOVE(
          ARRAY_AGG(DISTINCT sig.vehicle_model),
          NULL
        ) AS models

      FROM signals sig

      JOIN countries c
        ON c.id = sig.resolved_country_id

      WHERE sig.is_short = TRUE
        AND sig.resolved_country_id IS NOT NULL
        AND sig.published_at >=
          NOW() - make_interval(days => $1::int)
        AND (
          $2::text[] IS NULL OR
          c.code = ANY($2::text[])
        )

      GROUP BY c.id, c.code, c.name

      ORDER BY
        vehicle_views_total DESC,
        vehicle_signal_count DESC,
        c.code ASC

      LIMIT $3
    `,
    [
      VEHICLE_WINDOW_DAYS,
      options.countryCodes,
      options.maxCountries
    ]
  );

  return result.rows;
}

// =========================================================
// MENTION PREPARATION
// =========================================================

function isExpired(item, maxAgeHours, now) {
  if (!item.publishedAt) {
    // Items without a publish date cannot be age-checked;
    // they are kept but contribute no recency evidence.
    return false;
  }

  const publishedTime = new Date(
    item.publishedAt
  ).getTime();

  if (Number.isNaN(publishedTime)) {
    return false;
  }

  const ageMs = now.getTime() - publishedTime;

  return (
    ageMs < 0 ||
    ageMs > maxAgeHours * 3600000
  );
}

// Deduplicates raw feed items into unique mentions.
// Duplicate query results never inflate mention_count;
// query keys merge instead.
function buildMentionCandidates(
  countryCode,
  items,
  { maxAgeHours, now }
) {
  const byExternalKey = new Map();
  const byUrl = new Map();
  const byTitleAndPublisher = new Map();

  let expiredCount = 0;

  for (const item of items) {
    if (isExpired(item, maxAgeHours, now)) {
      expiredCount += 1;
      continue;
    }

    const normalizedTitle = normalizeHeadline(
      item.title,
      item.sourceName
    );

    if (!normalizedTitle) {
      continue;
    }

    const externalKey = buildExternalKey(
      countryCode,
      item
    );

    const titleKey = `${normalizedTitle}::${
      item.publisherDomain || ""
    }`;

    const existing =
      byExternalKey.get(externalKey) ||
      byUrl.get(item.url) ||
      byTitleAndPublisher.get(titleKey);

    if (existing) {
      if (item.queryKey) {
        existing.queryKeys.add(item.queryKey);
      }

      if (
        Number.isFinite(item.feedRank) &&
        (existing.feedRank === null ||
          item.feedRank < existing.feedRank)
      ) {
        existing.feedRank = item.feedRank;
      }

      continue;
    }

    const mention = {
      externalKey,
      queryKeys: new Set(
        item.queryKey ? [item.queryKey] : []
      ),
      queryKey: item.queryKey || "GENERAL",
      queryText: item.queryText || "",
      feedRank: Number.isFinite(item.feedRank)
        ? item.feedRank
        : null,
      title: item.title,
      normalizedTitle,
      url: item.url,
      guid: item.guid,
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      publisherDomain: item.publisherDomain,
      publishedAt: item.publishedAt,
      snippet: item.snippet
    };

    byExternalKey.set(externalKey, mention);
    byUrl.set(item.url, mention);
    byTitleAndPublisher.set(titleKey, mention);
  }

  return {
    mentions: [...byExternalKey.values()],
    expiredCount
  };
}

// =========================================================
// PERSISTENCE
// =========================================================

async function loadExistingClusters(pool, countryId) {
  const result = await pool.query(
    `
      SELECT
        id,
        story_hash,
        canonical_title,
        published_at
      FROM country_news_signals
      WHERE country_id = $1
        AND last_seen_at >=
          NOW() - make_interval(days => $2::int)
      ORDER BY last_seen_at DESC, id DESC
    `,
    [
      countryId,
      CLUSTERING_RULES.EXISTING_CLUSTER_WINDOW_DAYS
    ]
  );

  return result.rows.map(row => ({
    id: row.id,
    storyHash: row.story_hash,
    canonicalTitle: row.canonical_title,
    publishedAt: row.published_at
  }));
}

function pickRepresentativeMention(mentions) {
  return [...mentions].sort((a, b) => {
    const timeA = a.publishedAt
      ? new Date(a.publishedAt).getTime()
      : 0;

    const timeB = b.publishedAt
      ? new Date(b.publishedAt).getTime()
      : 0;

    if (timeA !== timeB) {
      return timeB - timeA;
    }

    const rankA = a.feedRank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.feedRank ?? Number.MAX_SAFE_INTEGER;

    return rankA - rankB;
  })[0];
}

async function upsertClusterShell(
  pool,
  {
    countryId,
    storyHash,
    canonicalTitle,
    representative,
    provider
  }
) {
  const result = await pool.query(
    `
      INSERT INTO country_news_signals (
        country_id,
        story_hash,
        canonical_title,
        title,
        representative_url,
        representative_source,
        representative_domain,
        published_at,
        provider,
        resolver_version
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
      )
      ON CONFLICT (country_id, story_hash)
      DO UPDATE
      SET
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING
        id,
        (xmax = 0) AS inserted
    `,
    [
      countryId,
      storyHash,
      canonicalTitle,
      representative.title,
      representative.url,
      representative.sourceName,
      representative.publisherDomain,
      representative.publishedAt,
      provider,
      NEWS_RESOLVER_VERSION
    ]
  );

  return result.rows[0];
}

async function upsertMention(
  pool,
  {
    newsSignalId,
    countryId,
    mention
  }
) {
  const queryKeys = [...mention.queryKeys].sort();

  const result = await pool.query(
    `
      INSERT INTO country_news_mentions (
        news_signal_id,
        country_id,
        external_key,
        query_key,
        query_text,
        feed_rank,
        title,
        normalized_title,
        url,
        guid,
        source_name,
        source_url,
        publisher_domain,
        published_at,
        snippet,
        raw_metadata
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15, $16::jsonb
      )
      ON CONFLICT (external_key)
      DO UPDATE
      SET
        feed_rank = LEAST(
          country_news_mentions.feed_rank,
          EXCLUDED.feed_rank
        ),
        title = EXCLUDED.title,
        normalized_title = EXCLUDED.normalized_title,
        snippet = EXCLUDED.snippet,
        raw_metadata = jsonb_set(
          country_news_mentions.raw_metadata,
          '{query_keys}',
          (
            SELECT COALESCE(
              jsonb_agg(DISTINCT value ORDER BY value),
              '[]'::jsonb
            )
            FROM jsonb_array_elements_text(
              COALESCE(
                country_news_mentions.raw_metadata
                  -> 'query_keys',
                '[]'::jsonb
              ) ||
              COALESCE(
                EXCLUDED.raw_metadata -> 'query_keys',
                '[]'::jsonb
              )
            ) AS merged(value)
          )
        ),
        last_seen_at = NOW(),
        updated_at = NOW()
      RETURNING
        id,
        (xmax = 0) AS inserted
    `,
    [
      newsSignalId,
      countryId,
      mention.externalKey,
      mention.queryKey,
      mention.queryText,
      mention.feedRank,
      mention.title,
      mention.normalizedTitle,
      mention.url,
      mention.guid,
      mention.sourceName,
      mention.sourceUrl,
      mention.publisherDomain,
      mention.publishedAt,
      mention.snippet,
      JSON.stringify({ query_keys: queryKeys })
    ]
  );

  return result.rows[0];
}

async function loadClusterMentions(pool, newsSignalId) {
  const result = await pool.query(
    `
      SELECT
        external_key,
        query_key,
        feed_rank,
        title,
        normalized_title,
        url,
        source_name,
        publisher_domain,
        published_at,
        snippet,
        raw_metadata
      FROM country_news_mentions
      WHERE news_signal_id = $1
      ORDER BY published_at DESC NULLS LAST, id ASC
    `,
    [newsSignalId]
  );

  return result.rows.map(row => ({
    externalKey: row.external_key,
    queryKey: row.query_key,
    queryKeys: Array.isArray(
      row.raw_metadata?.query_keys
    )
      ? row.raw_metadata.query_keys
      : [row.query_key],
    feedRank: row.feed_rank,
    title: row.title,
    normalizedTitle: row.normalized_title,
    url: row.url,
    sourceName: row.source_name,
    publisherDomain: row.publisher_domain,
    publishedAt: row.published_at,
    snippet: row.snippet
  }));
}

// Deterministic country evidence across a cluster: the
// strongest per-mention match wins.
function resolveClusterCountryEvidence(
  countryCode,
  mentions
) {
  let best = null;

  for (const mention of mentions) {
    const evidence = resolveCountryEvidence({
      countryCode,
      title: mention.title,
      snippet: mention.snippet
    });

    if (
      !best ||
      evidence.confidence > best.confidence
    ) {
      best = evidence;
    }
  }

  return (
    best ||
    resolveCountryEvidence({
      countryCode,
      title: "",
      snippet: ""
    })
  );
}

function resolveClusterArchetypes(mentions) {
  const archetypes = [];
  const evidence = {};

  for (const mention of mentions) {
    const extracted = extractConflictArchetypes({
      title: mention.title,
      snippet: mention.snippet
    });

    for (const archetype of extracted.archetypes) {
      if (!archetypes.includes(archetype)) {
        archetypes.push(archetype);
      }

      evidence[archetype] = [
        ...new Set([
          ...(evidence[archetype] || []),
          ...extracted.evidence[archetype]
        ])
      ].sort();
    }
  }

  return { archetypes, evidence };
}

function resolveClusterKeywords(mentions) {
  const keywords = new Set();

  for (const mention of mentions) {
    for (const keyword of extractCrisisKeywords({
      title: mention.title,
      snippet: mention.snippet
    })) {
      keywords.add(keyword);
    }
  }

  return [...keywords].sort();
}

async function finalizeCluster(
  pool,
  {
    newsSignalId,
    countryCode,
    now
  }
) {
  const mentions = await loadClusterMentions(
    pool,
    newsSignalId
  );

  const representative =
    pickRepresentativeMention(mentions);

  const traffic = deriveClusterTrafficEvidence(
    mentions,
    { now }
  );

  const queryKeys = [
    ...new Set(
      mentions.flatMap(mention => mention.queryKeys)
    )
  ].sort();

  const countryEvidence = resolveClusterCountryEvidence(
    countryCode,
    mentions
  );

  const category = classifyCategory({
    title: representative.title,
    snippet: representative.snippet,
    queryKeys
  });

  const archetypeInfo =
    resolveClusterArchetypes(mentions);

  const keywords = resolveClusterKeywords(mentions);

  const transformation =
    calculateTransformationPotential({
      conflictArchetypes: archetypeInfo.archetypes,
      crisisKeywords: keywords,
      category: category.category,
      countryConfidence: countryEvidence.confidence,
      trafficScore: traffic.trafficScore
    });

  await pool.query(
    `
      UPDATE country_news_signals
      SET
        title = $1,
        representative_url = $2,
        representative_source = $3,
        representative_domain = $4,

        category = $5,
        category_confidence = $6,
        category_evidence = $7::jsonb,

        country_match_method = $8,
        country_confidence = $9,
        country_evidence = $10::jsonb,

        traffic_tier = $11,
        traffic_score = $12,
        mention_count = $13,
        publisher_count = $14,
        query_count = $15,
        feed_rank_score = $16,
        age_hours = $17,

        transformation_tier = $18,
        transformation_potential = $19,

        conflict_archetypes = $20::jsonb,
        keywords = $21::jsonb,

        published_at = $22,
        last_seen_at = NOW(),

        provider = $23,
        resolver_version = $24,
        raw_metadata = $25::jsonb,

        updated_at = NOW()
      WHERE id = $26
    `,
    [
      representative.title,
      representative.url,
      representative.sourceName,
      representative.publisherDomain,

      category.category,
      category.confidence,
      JSON.stringify(category.evidence),

      countryEvidence.matchMethod,
      countryEvidence.confidence,
      JSON.stringify(countryEvidence.evidence),

      traffic.trafficTier,
      traffic.trafficScore,
      traffic.mentionCount,
      traffic.publisherCount,
      traffic.queryCount,
      traffic.feedRankScore,
      traffic.ageHours,

      transformation.transformationTier,
      transformation.transformationPotential,

      JSON.stringify(archetypeInfo.archetypes),
      JSON.stringify(keywords),

      representative.publishedAt,

      defaultProvider.PROVIDER_ID,
      NEWS_RESOLVER_VERSION,
      JSON.stringify({
        query_keys: queryKeys,
        best_feed_rank: traffic.bestFeedRank,
        archetype_evidence: archetypeInfo.evidence
      }),

      newsSignalId
    ]
  );

  return {
    trafficTier: traffic.trafficTier,
    transformationTier:
      transformation.transformationTier
  };
}

// =========================================================
// RUN EXECUTION
// =========================================================

function createRunState(options) {
  return {
    countryCount: 0,
    completedCountryCount: 0,
    failedCountryCount: 0,
    queryCount: 0,
    succeededQueryCount: 0,
    itemCount: 0,
    mentionInsertedCount: 0,
    mentionUpdatedCount: 0,
    clusterInsertedCount: 0,
    clusterUpdatedCount: 0,

    breakoutCount: 0,
    activeCount: 0,
    watchCount: 0,
    lowSignalCount: 0,

    highTransformationCount: 0,
    mediumTransformationCount: 0,
    lowTransformationCount: 0,

    selectedCountries: [],
    countryResults: [],
    errors: [],

    options
  };
}

function buildRunSummary(state) {
  return {
    selected_countries: state.selectedCountries,
    country_results: state.countryResults,
    errors: state.errors,

    breakout_count: state.breakoutCount,
    active_count: state.activeCount,
    watch_count: state.watchCount,
    low_signal_count: state.lowSignalCount,

    high_transformation_count:
      state.highTransformationCount,
    medium_transformation_count:
      state.mediumTransformationCount,
    low_transformation_count:
      state.lowTransformationCount,

    provider: defaultProvider.PROVIDER_ID,
    resolver_version: NEWS_RESOLVER_VERSION,
    vehicle_window_days: VEHICLE_WINDOW_DAYS,
    max_age_hours: state.options.maxAgeHours,
    max_items_per_query:
      state.options.maxItemsPerQuery,
    max_queries_per_country:
      state.options.maxQueriesPerCountry
  };
}

async function updateRunProgress(pool, runId, state) {
  await pool.query(
    `
      UPDATE country_news_runs
      SET
        country_count = $1,
        completed_country_count = $2,
        failed_country_count = $3,
        query_count = $4,
        succeeded_query_count = $5,
        item_count = $6,
        mention_inserted_count = $7,
        mention_updated_count = $8,
        cluster_inserted_count = $9,
        cluster_updated_count = $10,
        summary = $11::jsonb,
        updated_at = NOW()
      WHERE id = $12
    `,
    [
      state.countryCount,
      state.completedCountryCount,
      state.failedCountryCount,
      state.queryCount,
      state.succeededQueryCount,
      state.itemCount,
      state.mentionInsertedCount,
      state.mentionUpdatedCount,
      state.clusterInsertedCount,
      state.clusterUpdatedCount,
      JSON.stringify(buildRunSummary(state)),
      runId
    ]
  );
}

async function finalizeRun(pool, runId, state) {
  const completed =
    state.completedCountryCount > 0;

  const status = completed ? "COMPLETED" : "FAILED";

  const errorMessage = completed
    ? null
    : (
        state.errors
          .slice(0, 3)
          .map(item =>
            `${item.country_code || item.scope}: ${item.message}`
          )
          .join(" | ") ||
        "No countries were processed successfully."
      );

  await pool.query(
    `
      UPDATE country_news_runs
      SET
        status = $1,
        country_count = $2,
        completed_country_count = $3,
        failed_country_count = $4,
        query_count = $5,
        succeeded_query_count = $6,
        item_count = $7,
        mention_inserted_count = $8,
        mention_updated_count = $9,
        cluster_inserted_count = $10,
        cluster_updated_count = $11,
        summary = $12::jsonb,
        error_message = $13,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $14
    `,
    [
      status,
      state.countryCount,
      state.completedCountryCount,
      state.failedCountryCount,
      state.queryCount,
      state.succeededQueryCount,
      state.itemCount,
      state.mentionInsertedCount,
      state.mentionUpdatedCount,
      state.clusterInsertedCount,
      state.clusterUpdatedCount,
      JSON.stringify(buildRunSummary(state)),
      errorMessage,
      runId
    ]
  );

  return {
    runId: String(runId),
    status,
    ...state
  };
}

async function failNewsRun(pool, runId, error) {
  await pool.query(
    `
      UPDATE country_news_runs
      SET
        status = 'FAILED',
        error_message = $1,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `,
    [
      String(
        error?.message ||
        "Unknown country news failure"
      ).slice(0, 2000),
      runId
    ]
  );
}

async function processCountry(
  pool,
  country,
  state,
  { provider, now }
) {
  const options = state.options;

  const queries = buildCountryQueries(country, {
    maxQueriesPerCountry: options.maxQueriesPerCountry
  });

  state.queryCount += queries.length;

  const items = [];
  let succeededQueries = 0;

  const results = await provider.mapWithConcurrency(
    queries,
    defaultProvider.PROVIDER_LIMITS.CONCURRENCY,
    query =>
      provider.fetchQuery({
        queryKey: query.queryKey,
        queryText: query.queryText,
        maxItems: options.maxItemsPerQuery
      })
  );

  results.forEach((result, index) => {
    if (result.ok) {
      succeededQueries += 1;
      items.push(...result.value.items);
      return;
    }

    state.errors.push({
      scope: "query",
      country_code: country.country_code,
      query_key: queries[index].queryKey,
      code: result.error?.code || null,
      message: String(
        result.error?.message ||
        "Unknown query failure"
      ).slice(0, 500)
    });
  });

  state.succeededQueryCount += succeededQueries;

  if (queries.length > 0 && succeededQueries === 0) {
    throw new Error(
      `All ${queries.length} news queries failed for ${country.country_code}.`
    );
  }

  state.itemCount += items.length;

  const { mentions } = buildMentionCandidates(
    country.country_code,
    items,
    {
      maxAgeHours: options.maxAgeHours,
      now
    }
  );

  const existingClusters = await loadExistingClusters(
    pool,
    country.country_id
  );

  const { clusters } = clusterMentions(
    country.country_code,
    mentions,
    existingClusters
  );

  const countryResult = {
    country_code: country.country_code,
    query_count: queries.length,
    succeeded_query_count: succeededQueries,
    item_count: items.length,
    mention_count: mentions.length,
    cluster_count: clusters.length,
    status: "COMPLETED"
  };

  for (const cluster of clusters) {
    const representative =
      pickRepresentativeMention(cluster.mentions);

    const shell = await upsertClusterShell(pool, {
      countryId: country.country_id,
      storyHash: cluster.storyHash,
      canonicalTitle: cluster.canonicalTitle,
      representative,
      provider: defaultProvider.PROVIDER_ID
    });

    if (shell.inserted) {
      state.clusterInsertedCount += 1;
    } else {
      state.clusterUpdatedCount += 1;
    }

    for (const mention of cluster.mentions) {
      const saved = await upsertMention(pool, {
        newsSignalId: shell.id,
        countryId: country.country_id,
        mention
      });

      if (saved.inserted) {
        state.mentionInsertedCount += 1;
      } else {
        state.mentionUpdatedCount += 1;
      }
    }

    const outcome = await finalizeCluster(pool, {
      newsSignalId: shell.id,
      countryCode: country.country_code,
      now
    });

    if (outcome.trafficTier === "BREAKOUT") {
      state.breakoutCount += 1;
    } else if (outcome.trafficTier === "ACTIVE") {
      state.activeCount += 1;
    } else if (outcome.trafficTier === "WATCH") {
      state.watchCount += 1;
    } else {
      state.lowSignalCount += 1;
    }

    if (outcome.transformationTier === "HIGH") {
      state.highTransformationCount += 1;
    } else if (
      outcome.transformationTier === "MEDIUM"
    ) {
      state.mediumTransformationCount += 1;
    } else {
      state.lowTransformationCount += 1;
    }
  }

  state.countryResults.push(countryResult);
}

async function executeNewsRun(
  pool,
  run,
  {
    provider = defaultProvider,
    now = new Date(),
    onCountryCompleted = null
  } = {}
) {
  const options = normalizeNewsRunPayload(
    run.request_payload
  );

  const state = createRunState(options);

  const countries = await selectActiveCountries(
    pool,
    options
  );

  if (countries.length === 0) {
    const error = new Error(
      NO_ACTIVE_VEHICLE_COUNTRIES_ERROR
    );

    error.code = NO_ACTIVE_VEHICLE_COUNTRIES_ERROR;

    await failNewsRun(pool, run.id, error);

    return {
      runId: String(run.id),
      status: "FAILED",
      errorCode: NO_ACTIVE_VEHICLE_COUNTRIES_ERROR,
      ...state
    };
  }

  state.countryCount = countries.length;

  state.selectedCountries = countries.map(country => ({
    country_id: String(country.country_id),
    country_code: country.country_code,
    country_name: country.country_name,
    vehicle_signal_count:
      country.vehicle_signal_count,
    qualified_vehicle_signal_count:
      country.qualified_vehicle_signal_count,
    vehicle_views_total: String(
      country.vehicle_views_total
    ),
    vehicle_views_max: String(
      country.vehicle_views_max
    ),
    brands: country.brands || [],
    models: country.models || []
  }));

  await updateRunProgress(pool, run.id, state);

  for (const country of countries) {
    try {
      await processCountry(pool, country, state, {
        provider,
        now
      });

      state.completedCountryCount += 1;

      if (onCountryCompleted) {
        onCountryCompleted(country, state);
      }
    } catch (error) {
      state.failedCountryCount += 1;

      state.countryResults.push({
        country_code: country.country_code,
        status: "FAILED",
        message: String(
          error?.message ||
          "Unknown country failure"
        ).slice(0, 500)
      });

      state.errors.push({
        scope: "country",
        country_code: country.country_code,
        code: error?.code || null,
        message: String(
          error?.message ||
          "Unknown country failure"
        ).slice(0, 500)
      });
    }

    await updateRunProgress(pool, run.id, state);
  }

  return finalizeRun(pool, run.id, state);
}

async function processNextCountryNewsRun(
  pool,
  {
    workerId,
    provider = defaultProvider,
    now = new Date(),
    onRunStarted = null,
    onCountryCompleted = null
  } = {}
) {
  const run = await claimNextNewsRun(pool, workerId);

  if (!run) {
    return null;
  }

  if (onRunStarted) {
    onRunStarted(run);
  }

  try {
    return await executeNewsRun(pool, run, {
      provider,
      now,
      onCountryCompleted
    });
  } catch (error) {
    await failNewsRun(pool, run.id, error);
    throw error;
  }
}

module.exports = {
  NO_ACTIVE_VEHICLE_COUNTRIES_ERROR,
  VEHICLE_WINDOW_DAYS,
  buildExternalKey,
  buildMentionCandidates,
  claimNextNewsRun,
  executeNewsRun,
  processNextCountryNewsRun,
  selectActiveCountries
};

// =========================================================
// NEWS TRAFFIC EVIDENCE — Task 3.3D
//
// News Traffic Score is a coverage-and-recency PROXY.
// Public news feeds do not expose article view counts, so
// this module never claims actual views. Vehicle Shorts
// views only decide which countries get scanned; they
// never enter this score.
// =========================================================

const NEWS_TRAFFIC_TIERS = {
  BREAKOUT: "BREAKOUT",
  ACTIVE: "ACTIVE",
  WATCH: "WATCH",
  LOW_SIGNAL: "LOW_SIGNAL"
};

const TRAFFIC_WEIGHTS = {
  // Cross-publisher coverage: max 40.
  PUBLISHER_POINTS: [0, 10, 22, 30, 36, 40],

  // Unique feed mentions: max 20.
  MENTION_MAX: 20,
  MENTION_POINTS_EACH: 2,

  // Query group coverage: max 15.
  QUERY_MAX: 15,
  QUERY_POINTS_EACH: 3,

  // Recency: max 20, linear decay to zero at the horizon.
  RECENCY_MAX: 20,
  RECENCY_HORIZON_HOURS: 168,

  // Feed rank is a weak signal: max 5.
  FEED_RANK_MAX: 5
};

const TRAFFIC_TIER_THRESHOLDS = {
  BREAKOUT: {
    minScore: 75,
    minPublishers: 3
  },
  ACTIVE: {
    minScore: 50,
    minPublishers: 2
  },
  WATCH: {
    minScore: 25
  }
};

function round(value, decimals) {
  const multiplier = 10 ** decimals;

  return Math.round(value * multiplier) / multiplier;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function publisherCoverageScore(publisherCount) {
  const count = clamp(
    Math.floor(Number(publisherCount) || 0),
    0,
    TRAFFIC_WEIGHTS.PUBLISHER_POINTS.length - 1
  );

  return TRAFFIC_WEIGHTS.PUBLISHER_POINTS[count];
}

function mentionScore(mentionCount) {
  const count = Math.max(
    0,
    Math.floor(Number(mentionCount) || 0)
  );

  return Math.min(
    TRAFFIC_WEIGHTS.MENTION_MAX,
    count * TRAFFIC_WEIGHTS.MENTION_POINTS_EACH
  );
}

function queryCoverageScore(queryCount) {
  const count = Math.max(
    0,
    Math.floor(Number(queryCount) || 0)
  );

  return Math.min(
    TRAFFIC_WEIGHTS.QUERY_MAX,
    count * TRAFFIC_WEIGHTS.QUERY_POINTS_EACH
  );
}

function recencyScore(ageHours) {
  const age = Number(ageHours);

  if (!Number.isFinite(age) || age < 0) {
    return 0;
  }

  return (
    TRAFFIC_WEIGHTS.RECENCY_MAX *
    Math.max(
      0,
      1 - age / TRAFFIC_WEIGHTS.RECENCY_HORIZON_HOURS
    )
  );
}

// bestFeedRank is the lowest (strongest) 1-based feed
// position across the cluster's mentions.
function feedRankEvidenceScore(bestFeedRank) {
  const rank = Number(bestFeedRank);

  if (!Number.isFinite(rank) || rank < 1) {
    return 0;
  }

  if (rank <= 3) {
    return TRAFFIC_WEIGHTS.FEED_RANK_MAX;
  }

  if (rank <= 10) {
    return 3;
  }

  if (rank <= 20) {
    return 1;
  }

  return 0;
}

function calculateTrafficScore({
  mentionCount,
  publisherCount,
  queryCount,
  ageHours,
  bestFeedRank
}) {
  const score =
    publisherCoverageScore(publisherCount) +
    mentionScore(mentionCount) +
    queryCoverageScore(queryCount) +
    recencyScore(ageHours) +
    feedRankEvidenceScore(bestFeedRank);

  return round(clamp(score, 0, 100), 2);
}

function classifyTrafficTier({
  trafficScore,
  publisherCount
}) {
  const score = Number(trafficScore) || 0;
  const publishers = Number(publisherCount) || 0;

  if (
    score >= TRAFFIC_TIER_THRESHOLDS.BREAKOUT.minScore &&
    publishers >=
      TRAFFIC_TIER_THRESHOLDS.BREAKOUT.minPublishers
  ) {
    return NEWS_TRAFFIC_TIERS.BREAKOUT;
  }

  if (
    score >= TRAFFIC_TIER_THRESHOLDS.ACTIVE.minScore &&
    publishers >=
      TRAFFIC_TIER_THRESHOLDS.ACTIVE.minPublishers
  ) {
    return NEWS_TRAFFIC_TIERS.ACTIVE;
  }

  if (score >= TRAFFIC_TIER_THRESHOLDS.WATCH.minScore) {
    return NEWS_TRAFFIC_TIERS.WATCH;
  }

  return NEWS_TRAFFIC_TIERS.LOW_SIGNAL;
}

// Aggregates the persisted mention rows of one cluster
// into traffic evidence. Mentions must already be
// deduplicated by external key.
function deriveClusterTrafficEvidence(
  mentions,
  { now = new Date() } = {}
) {
  const publishers = new Set();
  const queryKeys = new Set();

  let bestFeedRank = null;
  let latestPublishedAt = null;

  for (const mention of mentions) {
    const publisher =
      mention.publisherDomain ||
      mention.publisher_domain ||
      mention.sourceName ||
      mention.source_name;

    if (publisher) {
      publishers.add(
        String(publisher).toLowerCase().trim()
      );
    }

    const mentionQueryKeys = Array.isArray(
      mention.queryKeys
    )
      ? mention.queryKeys
      : mention.query_key
        ? [mention.query_key]
        : mention.queryKey
          ? [mention.queryKey]
          : [];

    for (const key of mentionQueryKeys) {
      queryKeys.add(String(key));
    }

    const feedRank = Number(
      mention.feedRank ?? mention.feed_rank
    );

    if (
      Number.isFinite(feedRank) &&
      feedRank >= 1 &&
      (bestFeedRank === null || feedRank < bestFeedRank)
    ) {
      bestFeedRank = feedRank;
    }

    const publishedAt =
      mention.publishedAt ?? mention.published_at;

    if (publishedAt) {
      const time = new Date(publishedAt).getTime();

      if (
        !Number.isNaN(time) &&
        (latestPublishedAt === null ||
          time > latestPublishedAt)
      ) {
        latestPublishedAt = time;
      }
    }
  }

  const mentionCount = mentions.length;
  const publisherCount = publishers.size;
  const queryCount = queryKeys.size;

  const ageHours =
    latestPublishedAt === null
      ? null
      : Math.max(
          0,
          (new Date(now).getTime() - latestPublishedAt) /
            3600000
        );

  const trafficScore = calculateTrafficScore({
    mentionCount,
    publisherCount,
    queryCount,
    ageHours:
      ageHours === null
        ? TRAFFIC_WEIGHTS.RECENCY_HORIZON_HOURS
        : ageHours,
    bestFeedRank
  });

  return {
    mentionCount,
    publisherCount,
    queryCount,
    bestFeedRank,
    feedRankScore: round(
      feedRankEvidenceScore(bestFeedRank),
      2
    ),
    ageHours:
      ageHours === null ? null : round(ageHours, 2),
    trafficScore,
    trafficTier: classifyTrafficTier({
      trafficScore,
      publisherCount
    })
  };
}

module.exports = {
  NEWS_TRAFFIC_TIERS,
  TRAFFIC_TIER_THRESHOLDS,
  TRAFFIC_WEIGHTS,
  calculateTrafficScore,
  classifyTrafficTier,
  deriveClusterTrafficEvidence,
  feedRankEvidenceScore,
  mentionScore,
  publisherCoverageScore,
  queryCoverageScore,
  recencyScore
};

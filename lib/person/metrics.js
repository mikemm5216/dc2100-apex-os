// =========================================================
// PERSON TRAFFIC METRICS — Task 3.3E
//
// Two clearly separated evidence sides:
//
//   Vehicle Attention — REAL YouTube Short view counts
//   from linked vehicle signals. Raw view numbers are
//   always kept and reported separately.
//
//   News Coverage — a coverage-and-recency PROXY built
//   from public feed metadata. It is never a view count.
//
// The composite Person Traffic Score combines both and is
// always labeled COMPOSITE. No rule may depend on a
// person's nationality or political stance.
// =========================================================

const PERSON_TRAFFIC_TIERS = {
  BREAKOUT: "BREAKOUT",
  ACTIVE: "ACTIVE",
  WATCH: "WATCH",
  LOW_SIGNAL: "LOW_SIGNAL"
};

const VEHICLE_ATTENTION_WEIGHTS = {
  // Log-scaled REAL vehicle views: max 55. log10(views)
  // reaches the cap around 10M total views.
  VIEWS_MAX: 55,
  VIEWS_LOG_CAP: 7,

  // Qualified vehicle signals: max 20.
  QUALIFIED_MAX: 20,
  QUALIFIED_POINTS_EACH: 5,

  // Direct person mentions inside vehicle Shorts: max 15.
  DIRECT_MENTION_MAX: 15,
  DIRECT_MENTION_POINTS_EACH: 5,

  // Vehicle signal breadth: max 10.
  BREADTH_MAX: 10,
  BREADTH_POINTS_EACH: 2
};

const NEWS_COVERAGE_WEIGHTS = {
  // Cross-publisher coverage: max 40.
  PUBLISHER_POINTS: [0, 10, 22, 30, 36, 40],

  // Unique feed mentions: max 25.
  MENTION_MAX: 25,
  MENTION_POINTS_EACH: 2.5,

  // Query group coverage: max 15.
  QUERY_MAX: 15,
  QUERY_POINTS_EACH: 5,

  // Recency: max 15, linear decay to the horizon.
  RECENCY_MAX: 15,
  RECENCY_HORIZON_HOURS: 168,

  // Feed rank is a weak signal: max 5.
  FEED_RANK_MAX: 5
};

const COMPOSITE_WEIGHTS = {
  VEHICLE: 0.65,
  NEWS: 0.35
};

const PERSON_TIER_THRESHOLDS = {
  BREAKOUT: {
    minScore: 75,
    minVehicleViews: 1000000,
    minPublishers: 3
  },
  ACTIVE: { minScore: 50 },
  WATCH: { minScore: 25 }
};

function round(value, decimals) {
  const multiplier = 10 ** decimals;

  return Math.round(value * multiplier) / multiplier;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nonnegative(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : 0;
}

// =========================================================
// VEHICLE ATTENTION (real views)
// =========================================================

function vehicleViewsScore(vehicleViewsTotal) {
  const views = nonnegative(vehicleViewsTotal);

  if (views < 1) {
    return 0;
  }

  return (
    VEHICLE_ATTENTION_WEIGHTS.VIEWS_MAX *
    Math.min(
      1,
      Math.log10(views + 1) /
        VEHICLE_ATTENTION_WEIGHTS.VIEWS_LOG_CAP
    )
  );
}

function calculateVehicleAttentionScore({
  vehicleViewsTotal,
  qualifiedVehicleSignalCount,
  directVehicleMentionCount,
  vehicleSignalCount
}) {
  const score =
    vehicleViewsScore(vehicleViewsTotal) +
    Math.min(
      VEHICLE_ATTENTION_WEIGHTS.QUALIFIED_MAX,
      Math.floor(
        nonnegative(qualifiedVehicleSignalCount)
      ) * VEHICLE_ATTENTION_WEIGHTS.QUALIFIED_POINTS_EACH
    ) +
    Math.min(
      VEHICLE_ATTENTION_WEIGHTS.DIRECT_MENTION_MAX,
      Math.floor(
        nonnegative(directVehicleMentionCount)
      ) *
        VEHICLE_ATTENTION_WEIGHTS
          .DIRECT_MENTION_POINTS_EACH
    ) +
    Math.min(
      VEHICLE_ATTENTION_WEIGHTS.BREADTH_MAX,
      Math.floor(nonnegative(vehicleSignalCount)) *
        VEHICLE_ATTENTION_WEIGHTS.BREADTH_POINTS_EACH
    );

  return round(clamp(score, 0, 100), 2);
}

// =========================================================
// NEWS COVERAGE (proxy)
// =========================================================

function publisherCoverageScore(publisherCount) {
  const count = clamp(
    Math.floor(nonnegative(publisherCount)),
    0,
    NEWS_COVERAGE_WEIGHTS.PUBLISHER_POINTS.length - 1
  );

  return NEWS_COVERAGE_WEIGHTS.PUBLISHER_POINTS[count];
}

function newsRecencyScore(ageHours) {
  const age = Number(ageHours);

  if (!Number.isFinite(age) || age < 0) {
    return 0;
  }

  return (
    NEWS_COVERAGE_WEIGHTS.RECENCY_MAX *
    Math.max(
      0,
      1 -
        age /
          NEWS_COVERAGE_WEIGHTS.RECENCY_HORIZON_HOURS
    )
  );
}

function feedRankEvidenceScore(bestFeedRank) {
  const rank = Number(bestFeedRank);

  if (!Number.isFinite(rank) || rank < 1) {
    return 0;
  }

  if (rank <= 3) {
    return NEWS_COVERAGE_WEIGHTS.FEED_RANK_MAX;
  }

  if (rank <= 10) {
    return 3;
  }

  if (rank <= 20) {
    return 1;
  }

  return 0;
}

function calculateNewsCoverageScore({
  newsMentionCount,
  publisherCount,
  queryCount,
  ageHours,
  bestFeedRank
}) {
  const score =
    publisherCoverageScore(publisherCount) +
    Math.min(
      NEWS_COVERAGE_WEIGHTS.MENTION_MAX,
      Math.floor(nonnegative(newsMentionCount)) *
        NEWS_COVERAGE_WEIGHTS.MENTION_POINTS_EACH
    ) +
    Math.min(
      NEWS_COVERAGE_WEIGHTS.QUERY_MAX,
      Math.floor(nonnegative(queryCount)) *
        NEWS_COVERAGE_WEIGHTS.QUERY_POINTS_EACH
    ) +
    newsRecencyScore(ageHours) +
    feedRankEvidenceScore(bestFeedRank);

  return round(clamp(score, 0, 100), 2);
}

// Aggregates persisted person mentions into news coverage
// evidence. Mentions must already be deduplicated per
// person by external key.
function derivePersonNewsEvidence(
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
      (bestFeedRank === null ||
        feedRank < bestFeedRank)
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

  const newsMentionCount = mentions.length;
  const publisherCount = publishers.size;
  const queryCount = queryKeys.size;

  const ageHours =
    latestPublishedAt === null
      ? null
      : Math.max(
          0,
          (new Date(now).getTime() -
            latestPublishedAt) /
            3600000
        );

  const newsCoverageScore =
    newsMentionCount === 0
      ? 0
      : calculateNewsCoverageScore({
          newsMentionCount,
          publisherCount,
          queryCount,
          ageHours:
            ageHours === null
              ? NEWS_COVERAGE_WEIGHTS
                  .RECENCY_HORIZON_HOURS
              : ageHours,
          bestFeedRank
        });

  return {
    newsMentionCount,
    publisherCount,
    queryCount,
    bestFeedRank,
    feedRankScore: round(
      feedRankEvidenceScore(bestFeedRank),
      2
    ),
    ageHours:
      ageHours === null ? null : round(ageHours, 2),
    newsCoverageScore
  };
}

// =========================================================
// COMPOSITE SCORE + TIER
// =========================================================

function calculatePersonTrafficScore({
  vehicleAttentionScore,
  newsCoverageScore
}) {
  const score =
    clamp(nonnegative(vehicleAttentionScore), 0, 100) *
      COMPOSITE_WEIGHTS.VEHICLE +
    clamp(nonnegative(newsCoverageScore), 0, 100) *
      COMPOSITE_WEIGHTS.NEWS;

  return round(clamp(score, 0, 100), 2);
}

function classifyPersonTrafficTier({
  trafficScore,
  vehicleViewsTotal,
  publisherCount
}) {
  const score = nonnegative(trafficScore);
  const views = nonnegative(vehicleViewsTotal);
  const publishers = nonnegative(publisherCount);

  if (
    score >=
      PERSON_TIER_THRESHOLDS.BREAKOUT.minScore &&
    (views >=
      PERSON_TIER_THRESHOLDS.BREAKOUT
        .minVehicleViews ||
      publishers >=
        PERSON_TIER_THRESHOLDS.BREAKOUT.minPublishers)
  ) {
    return PERSON_TRAFFIC_TIERS.BREAKOUT;
  }

  if (
    score >= PERSON_TIER_THRESHOLDS.ACTIVE.minScore
  ) {
    return PERSON_TRAFFIC_TIERS.ACTIVE;
  }

  if (score >= PERSON_TIER_THRESHOLDS.WATCH.minScore) {
    return PERSON_TRAFFIC_TIERS.WATCH;
  }

  return PERSON_TRAFFIC_TIERS.LOW_SIGNAL;
}

// =========================================================
// ATTENTION ARCHETYPES
// =========================================================

const PERSON_ATTENTION_ARCHETYPES = [
  "LEADERSHIP_POWER",
  "PERFORMANCE_RIVALRY",
  "TECHNOLOGY_VISION",
  "LEGAL_REGULATORY",
  "ACCIDENT_SAFETY",
  "RECORD_ACHIEVEMENT",
  "OWNERSHIP_LUXURY",
  "CULTURE_FANDOM",
  "CONTROVERSY",
  "OTHER"
];

// Keyword tables. Evidence must come from vehicle titles,
// vehicle actions, or news headlines / snippets. Names and
// nationalities never produce an archetype.
const ARCHETYPE_RULES = [
  ["LEADERSHIP_POWER", [
    "ceo", "chief executive", "chairman", "resigns",
    "steps down", "takes over", "succession",
    "leadership", "board", "founder", "president of"
  ]],
  ["PERFORMANCE_RIVALRY", [
    "vs", "versus", "beats", "faster than", "rivalry",
    "drag race", "track battle", "race", "challenge",
    "head to head", "showdown", "battle"
  ]],
  ["TECHNOLOGY_VISION", [
    "electric", "ev", "battery", "autonomous",
    "self-driving", "software", "ai", "innovation",
    "technology", "prototype", "next-generation",
    "unveils", "reveal", "future"
  ]],
  ["LEGAL_REGULATORY", [
    "lawsuit", "sued", "court", "regulator",
    "investigation", "recall", "fined", "ban",
    "probe", "settlement", "antitrust"
  ]],
  ["ACCIDENT_SAFETY", [
    "crash", "accident", "collision", "injury",
    "safety", "fire", "wreck", "fatal"
  ]],
  ["RECORD_ACHIEVEMENT", [
    "record", "fastest", "world first", "milestone",
    "wins", "champion", "award", "victory",
    "podium", "sets a new"
  ]],
  ["OWNERSHIP_LUXURY", [
    "collection", "garage", "auction", "one of one",
    "million dollar", "buys", "owns", "rarest",
    "most expensive"
  ]],
  ["CULTURE_FANDOM", [
    "fans", "tribute", "viral", "iconic", "legend",
    "community", "meme", "cult following"
  ]],
  ["CONTROVERSY", [
    "controversy", "backlash", "slams", "criticized",
    "scandal", "feud", "outrage", "under fire"
  ]]
];

// Vehicle actions that map deterministically onto an
// archetype when present on a linked vehicle signal.
const ACTION_ARCHETYPES = {
  CRASH: "ACCIDENT_SAFETY",
  RACING: "PERFORMANCE_RIVALRY",
  DRAG_RACING: "PERFORMANCE_RIVALRY",
  DRIFTING: "PERFORMANCE_RIVALRY",
  COMPARISON: "PERFORMANCE_RIVALRY",
  REVEAL: "TECHNOLOGY_VISION",
  RESTORATION: "CULTURE_FANDOM"
};

function normalizeArchetypeText(value) {
  return ` ${String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()} `;
}

function containsTerm(paddedText, term) {
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${term.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    )}(?:$|[^\\p{L}\\p{N}])`,
    "u"
  );

  return pattern.test(paddedText);
}

function extractAttentionArchetypes({
  vehicleTitles = [],
  vehicleActions = [],
  headlines = [],
  snippets = []
} = {}) {
  const texts = [
    ...vehicleTitles,
    ...headlines,
    ...snippets
  ]
    .filter(Boolean)
    .map(normalizeArchetypeText);

  const archetypes = [];
  const evidence = {};

  function add(archetype, term) {
    if (!archetypes.includes(archetype)) {
      archetypes.push(archetype);
    }

    evidence[archetype] = [
      ...new Set([
        ...(evidence[archetype] || []),
        term
      ])
    ].sort();
  }

  for (const [archetype, terms] of ARCHETYPE_RULES) {
    for (const term of terms) {
      if (
        texts.some(text => containsTerm(text, term))
      ) {
        add(archetype, term);
      }
    }
  }

  for (const action of vehicleActions) {
    const archetype =
      ACTION_ARCHETYPES[String(action || "")];

    if (archetype) {
      add(archetype, `action:${action}`);
    }
  }

  // Stable output order follows the fixed allowlist.
  archetypes.sort(
    (a, b) =>
      PERSON_ATTENTION_ARCHETYPES.indexOf(a) -
      PERSON_ATTENTION_ARCHETYPES.indexOf(b)
  );

  return { archetypes, evidence };
}

// =========================================================
// TRANSFORMATION POTENTIAL (score only, no story)
// =========================================================

const TRANSFORMATION_WEIGHTS = {
  ARCHETYPE_POINTS_EACH: 10,
  ARCHETYPE_MAX: 30,

  // Story-relevant archetypes carry an extra bonus.
  KEY_ARCHETYPE_POINTS_EACH: 5,
  KEY_ARCHETYPE_MAX: 20,

  DIRECT_MENTION_BONUS: 15,
  LINK_CONFIDENCE_MAX: 15,
  TRAFFIC_MAX: 20
};

const KEY_ARCHETYPES = new Set([
  "PERFORMANCE_RIVALRY",
  "TECHNOLOGY_VISION",
  "LEADERSHIP_POWER",
  "RECORD_ACHIEVEMENT",
  "CONTROVERSY"
]);

const PERSON_TRANSFORMATION_TIERS = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW"
};

const TRANSFORMATION_THRESHOLDS = {
  HIGH: 70,
  MEDIUM: 40
};

function calculatePersonTransformationPotential({
  trafficScore,
  linkConfidence,
  directMention,
  attentionArchetypes = []
}) {
  const archetypeScore = Math.min(
    TRANSFORMATION_WEIGHTS.ARCHETYPE_MAX,
    attentionArchetypes.length *
      TRANSFORMATION_WEIGHTS.ARCHETYPE_POINTS_EACH
  );

  const keyArchetypeScore = Math.min(
    TRANSFORMATION_WEIGHTS.KEY_ARCHETYPE_MAX,
    attentionArchetypes.filter(archetype =>
      KEY_ARCHETYPES.has(archetype)
    ).length *
      TRANSFORMATION_WEIGHTS.KEY_ARCHETYPE_POINTS_EACH
  );

  const directScore = directMention
    ? TRANSFORMATION_WEIGHTS.DIRECT_MENTION_BONUS
    : 0;

  const confidenceScore =
    clamp(nonnegative(linkConfidence), 0, 1) *
    TRANSFORMATION_WEIGHTS.LINK_CONFIDENCE_MAX;

  const trafficComponent =
    (clamp(nonnegative(trafficScore), 0, 100) / 100) *
    TRANSFORMATION_WEIGHTS.TRAFFIC_MAX;

  const total = round(
    clamp(
      archetypeScore +
        keyArchetypeScore +
        directScore +
        confidenceScore +
        trafficComponent,
      0,
      100
    ),
    2
  );

  let tier = PERSON_TRANSFORMATION_TIERS.LOW;

  if (total >= TRANSFORMATION_THRESHOLDS.HIGH) {
    tier = PERSON_TRANSFORMATION_TIERS.HIGH;
  } else if (
    total >= TRANSFORMATION_THRESHOLDS.MEDIUM
  ) {
    tier = PERSON_TRANSFORMATION_TIERS.MEDIUM;
  }

  return {
    transformationPotential: total,
    transformationTier: tier
  };
}

module.exports = {
  ACTION_ARCHETYPES,
  ARCHETYPE_RULES,
  COMPOSITE_WEIGHTS,
  KEY_ARCHETYPES,
  NEWS_COVERAGE_WEIGHTS,
  PERSON_ATTENTION_ARCHETYPES,
  PERSON_TIER_THRESHOLDS,
  PERSON_TRAFFIC_TIERS,
  PERSON_TRANSFORMATION_TIERS,
  TRANSFORMATION_THRESHOLDS,
  TRANSFORMATION_WEIGHTS,
  VEHICLE_ATTENTION_WEIGHTS,
  calculateNewsCoverageScore,
  calculatePersonTrafficScore,
  calculatePersonTransformationPotential,
  calculateVehicleAttentionScore,
  classifyPersonTrafficTier,
  derivePersonNewsEvidence,
  extractAttentionArchetypes,
  feedRankEvidenceScore,
  newsRecencyScore,
  publisherCoverageScore,
  vehicleViewsScore
};

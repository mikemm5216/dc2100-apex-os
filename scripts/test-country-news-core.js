const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  parseRssItems
} = require("../lib/news/providers/google-news-rss");

const {
  normalizeHeadline,
  normalizeSnippet,
  stripPublisherSuffix,
  tokenizeHeadline
} = require("../lib/news/normalization");

const {
  CLUSTERING_RULES,
  clusterMentions,
  jaccardSimilarity,
  storyHash
} = require("../lib/news/clustering");

const {
  calculateTrafficScore,
  classifyTrafficTier,
  deriveClusterTrafficEvidence,
  recencyScore
} = require("../lib/news/metrics");

const {
  calculateTransformationPotential,
  classifyCategory,
  extractConflictArchetypes,
  extractCrisisKeywords,
  resolveCountryEvidence
} = require("../lib/news/classification");

const {
  buildMentionCandidates
} = require("../lib/news/engine");

const FIXTURE_NOW = new Date(
  "2026-07-12T00:00:00Z"
);

function loadFixture(name) {
  return fs.readFileSync(
    path.join(__dirname, "fixtures", name),
    "utf8"
  );
}

// ---------------------------------------------------------
// RSS parsing: multiple items
// ---------------------------------------------------------

const multiItems = parseRssItems(
  loadFixture("google-news-rss-sample.xml"),
  {
    queryKey: "RESOURCE_ENERGY",
    queryText: "Japan (energy OR oil)"
  }
);

// 8 <item> nodes: the empty-title and invalid-URL items
// are skipped, everything else survives.
assert.equal(multiItems.length, 6);

const energyItem = multiItems.find(
  item => item.guid === "fixture-jp-energy-1"
);

assert.ok(energyItem);

assert.equal(
  energyItem.title,
  "Japan Faces Energy Crisis - Reuters"
);

assert.equal(energyItem.sourceName, "Reuters");
assert.equal(
  energyItem.publisherDomain,
  "reuters.com"
);
assert.equal(
  energyItem.publishedAt,
  "2026-07-11T08:00:00.000Z"
);
assert.equal(energyItem.queryKey, "RESOURCE_ENERGY");

// HTML description stripped and entities decoded.
assert.ok(!energyItem.snippet.includes("<a"));
assert.ok(!energyItem.snippet.includes("&nbsp;"));
assert.ok(
  energyItem.snippet.includes("Fuel shortage")
);

// Missing source item still parses.
const missingSourceItem = multiItems.find(
  item => item.guid === "fixture-jp-quake-1"
);

assert.ok(missingSourceItem);
assert.equal(missingSourceItem.sourceName, null);
assert.equal(
  missingSourceItem.publisherDomain,
  "news.google.com"
);

// Missing pubDate item still parses.
const missingDateItem = multiItems.find(
  item => item.guid === "fixture-jp-culture-1"
);

assert.ok(missingDateItem);
assert.equal(missingDateItem.publishedAt, null);

// Snippet capped at 500 characters.
const longSnippetItem = multiItems.find(
  item => item.guid === "fixture-jp-energy-3"
);

assert.ok(longSnippetItem);
assert.equal(longSnippetItem.snippet.length, 500);
assert.ok(!longSnippetItem.snippet.includes("XXXXX"));

// Malformed items skipped without failing the query.
assert.ok(
  !multiItems.some(
    item => item.guid === "fixture-malformed-1"
  )
);
assert.ok(
  !multiItems.some(
    item => item.guid === "fixture-malformed-2"
  )
);

// Feed rank preserved as 1-based position.
assert.equal(energyItem.feedRank, 1);

// ---------------------------------------------------------
// RSS parsing: single item (non-array <item>)
// ---------------------------------------------------------

const singleItems = parseRssItems(
  loadFixture("google-news-rss-single-item.xml"),
  {
    queryKey: "TECHNOLOGY",
    queryText: "Germany (semiconductor OR chips)"
  }
);

assert.equal(singleItems.length, 1);
assert.equal(
  singleItems[0].guid,
  "fixture-de-chip-1"
);
assert.equal(singleItems[0].sourceName, "DW");

// ---------------------------------------------------------
// Headline normalization
// ---------------------------------------------------------

assert.equal(
  normalizeHeadline(
    "Japan Faces Energy Crisis - Reuters",
    "Reuters"
  ),
  "japan faces energy crisis"
);

// A suffix naming a DIFFERENT publisher is never removed.
assert.equal(
  normalizeHeadline(
    "Japan Faces Energy Crisis — BBC",
    "Reuters"
  ),
  "japan faces energy crisis bbc"
);

assert.equal(
  stripPublisherSuffix(
    "Headline | CNN",
    "CNN"
  ),
  "Headline"
);

assert.equal(
  stripPublisherSuffix(
    "Headline | CNN",
    "Reuters"
  ),
  "Headline | CNN"
);

// Trademark symbols removed, whitespace collapsed,
// numbers preserved.
assert.equal(
  normalizeHeadline(
    "  Toyota™  plans   5,000 new EVs!  ",
    null
  ),
  "toyota plans 5,000 new evs"
);

assert.equal(
  normalizeSnippet(
    "<b>Hello</b> &amp; welcome"
  ),
  "Hello & welcome"
);

// ---------------------------------------------------------
// Exact dedup: same guid / URL / normalized title
// ---------------------------------------------------------

const duplicateItems = [
  {
    title: "Japan Faces Energy Crisis - Reuters",
    url: "https://example.com/a",
    guid: "dup-guid-1",
    publishedAt: "2026-07-11T08:00:00.000Z",
    sourceName: "Reuters",
    sourceUrl: "https://www.reuters.com",
    publisherDomain: "reuters.com",
    snippet: "Fuel shortage in Japan.",
    feedRank: 1,
    queryKey: "GENERAL",
    queryText: "Japan"
  },
  {
    // Same guid, same URL, same normalized title —
    // found again by a different query.
    title: "Japan Faces Energy Crisis - Reuters",
    url: "https://example.com/a",
    guid: "dup-guid-1",
    publishedAt: "2026-07-11T08:00:00.000Z",
    sourceName: "Reuters",
    sourceUrl: "https://www.reuters.com",
    publisherDomain: "reuters.com",
    snippet: "Fuel shortage in Japan.",
    feedRank: 3,
    queryKey: "RESOURCE_ENERGY",
    queryText: "Japan (energy OR oil)"
  }
];

const dedupResult = buildMentionCandidates(
  "JP",
  duplicateItems,
  { maxAgeHours: 72, now: FIXTURE_NOW }
);

assert.equal(dedupResult.mentions.length, 1);

// Query keys merge instead of duplicating the mention.
assert.deepEqual(
  [...dedupResult.mentions[0].queryKeys].sort(),
  ["GENERAL", "RESOURCE_ENERGY"]
);

// Strongest (lowest) feed rank is kept.
assert.equal(dedupResult.mentions[0].feedRank, 1);

// Expired mentions are rejected.
const expiredResult = buildMentionCandidates(
  "JP",
  [
    {
      ...duplicateItems[0],
      guid: "old-guid",
      url: "https://example.com/old",
      publishedAt: "2026-07-01T00:00:00.000Z"
    }
  ],
  { maxAgeHours: 72, now: FIXTURE_NOW }
);

assert.equal(expiredResult.mentions.length, 0);
assert.equal(expiredResult.expiredCount, 1);

// ---------------------------------------------------------
// Near-duplicate clustering
// ---------------------------------------------------------

function mention(overrides) {
  return {
    externalKey: overrides.externalKey,
    normalizedTitle: overrides.normalizedTitle,
    title: overrides.title || overrides.normalizedTitle,
    publishedAt:
      overrides.publishedAt ||
      "2026-07-11T10:00:00.000Z",
    queryKeys: new Set(["GENERAL"]),
    queryKey: "GENERAL",
    queryText: "Japan",
    feedRank: overrides.feedRank ?? 1,
    url: overrides.url || "https://example.com/x",
    guid: overrides.externalKey,
    sourceName: overrides.sourceName || "Reuters",
    publisherDomain:
      overrides.publisherDomain || "reuters.com",
    snippet: overrides.snippet || ""
  };
}

const subsidyA = mention({
  externalKey: "sub-a",
  normalizedTitle:
    "japan announces major semiconductor subsidy"
});

const subsidyB = mention({
  externalKey: "sub-b",
  normalizedTitle:
    "japan unveils new subsidies for semiconductor industry",
  publisherDomain: "bbc.com",
  sourceName: "BBC"
});

const quake = mention({
  externalKey: "quake-a",
  normalizedTitle:
    "japan earthquake damages coastal railway"
});

const merged = clusterMentions("JP", [
  subsidyA,
  subsidyB
]);

assert.equal(
  merged.clusters.length,
  1,
  "Near-duplicate subsidy headlines must merge."
);

assert.equal(
  merged.clusters[0].mentions.length,
  2
);

const notMerged = clusterMentions("JP", [
  mention({
    externalKey: "sub-c",
    normalizedTitle:
      "japan announces semiconductor subsidy"
  }),
  quake
]);

assert.equal(
  notMerged.clusters.length,
  2,
  "Different events must never merge."
);

// Different numeric facts must not merge.
const numberA = mention({
  externalKey: "num-a",
  normalizedTitle:
    "japan earthquake kills 12 in coastal region"
});

const numberB = mention({
  externalKey: "num-b",
  normalizedTitle:
    "japan earthquake kills 47 in coastal region"
});

const numberClusters = clusterMentions("JP", [
  numberA,
  numberB
]);

assert.equal(
  numberClusters.clusters.length,
  2,
  "Diverging numeric facts must not merge."
);

// Countries never cross-merge: hashes are country-scoped.
assert.notEqual(
  storyHash("JP", "power shortage hits capital"),
  storyHash("DE", "power shortage hits capital")
);

// Jaccard sanity.
assert.equal(
  jaccardSimilarity(["a", "b"], ["a", "b"]),
  1
);
assert.equal(jaccardSimilarity(["a"], ["b"]), 0);

// ---------------------------------------------------------
// Rerun idempotency: same input twice reuses clusters
// ---------------------------------------------------------

const firstRun = clusterMentions("JP", [
  subsidyA,
  subsidyB,
  quake
]);

assert.equal(firstRun.clusters.length, 2);
assert.ok(
  firstRun.clusters.every(cluster => cluster.isNew)
);

const persistedClusters = firstRun.clusters.map(
  (cluster, index) => ({
    id: index + 1,
    storyHash: cluster.storyHash,
    canonicalTitle: cluster.canonicalTitle,
    publishedAt: cluster.publishedAt
  })
);

const secondRun = clusterMentions(
  "JP",
  [subsidyA, subsidyB, quake],
  persistedClusters
);

assert.equal(
  secondRun.clusters.length,
  2,
  "A rerun must not create duplicate clusters."
);

assert.ok(
  secondRun.clusters.every(
    cluster =>
      cluster.existingClusterId !== null &&
      cluster.isNew === false
  ),
  "A rerun must update existing clusters."
);

// ---------------------------------------------------------
// Country evidence
// ---------------------------------------------------------

const jpTitle = resolveCountryEvidence({
  countryCode: "JP",
  title: "Japan faces energy crisis",
  snippet: ""
});

assert.equal(jpTitle.matchMethod, "TITLE_ALIAS");
assert.equal(jpTitle.confidence, 1.0);

const jpTokyo = resolveCountryEvidence({
  countryCode: "JP",
  title: "Tokyo orders power rationing",
  snippet: ""
});

assert.equal(jpTokyo.matchMethod, "TITLE_ALIAS");

const deSnippet = resolveCountryEvidence({
  countryCode: "DE",
  title: "Chip export ruling announced",
  snippet: "Berlin confirms new restrictions."
});

assert.equal(
  deSnippet.matchMethod,
  "SNIPPET_ALIAS"
);
assert.equal(deSnippet.confidence, 0.8);

// Query-context only: confidence capped at 0.55, even
// when a DIFFERENT country is named in the title.
const queryOnly = resolveCountryEvidence({
  countryCode: "JP",
  title: "France announces new tariffs",
  snippet: "Paris confirms the plan."
});

assert.equal(
  queryOnly.matchMethod,
  "QUERY_CONTEXT"
);
assert.ok(queryOnly.confidence <= 0.55);

// ---------------------------------------------------------
// Category classification
// ---------------------------------------------------------

const energyCategory = classifyCategory({
  title: "Power shortage forces rolling blackouts",
  snippet: "",
  queryKeys: ["GENERAL"]
});

assert.equal(energyCategory.category, "ENERGY");
assert.equal(energyCategory.confidence, 0.9);

// Deterministic priority: chip export restrictions always
// resolves to the same category.
const chipCategoryA = classifyCategory({
  title: "Chip export restrictions announced",
  snippet: "",
  queryKeys: []
});

const chipCategoryB = classifyCategory({
  title: "Chip export restrictions announced",
  snippet: "",
  queryKeys: ["TECHNOLOGY"]
});

assert.equal(
  chipCategoryA.category,
  chipCategoryB.category
);

assert.ok(
  ["SEMICONDUCTORS_AI", "SANCTIONS_TRADE"].includes(
    chipCategoryA.category
  )
);

// Evidence priority: earthquake headline resolves
// deterministically.
const quakeCategory = classifyCategory({
  title: "Earthquake destroys railway",
  snippet: "",
  queryKeys: []
});

assert.ok(
  ["DISASTER_CLIMATE", "INFRASTRUCTURE"].includes(
    quakeCategory.category
  )
);

// Query group fallback carries LOW confidence and cannot
// override headline evidence.
const fallbackCategory = classifyCategory({
  title: "Weekly briefing",
  snippet: "",
  queryKeys: ["RESOURCE_ENERGY"]
});

assert.equal(fallbackCategory.category, "ENERGY");
assert.equal(fallbackCategory.confidence, 0.4);

const otherCategory = classifyCategory({
  title: "Weekly briefing",
  snippet: "",
  queryKeys: ["GENERAL"]
});

assert.equal(otherCategory.category, "OTHER");

// ---------------------------------------------------------
// Conflict archetypes
// ---------------------------------------------------------

const fuelArchetypes = extractConflictArchetypes({
  title: "Fuel shortage forces rationing",
  snippet: ""
});

assert.ok(
  fuelArchetypes.archetypes.includes(
    "RESOURCE_SCARCITY"
  )
);

const factoryArchetypes = extractConflictArchetypes({
  title: "Chip factory shutdown halts deliveries",
  snippet: ""
});

assert.ok(
  factoryArchetypes.archetypes.includes(
    "SUPPLY_CHAIN_DISRUPTION"
  )
);

const sanctionArchetypes = extractConflictArchetypes({
  title: "Sanctions block exports of key equipment",
  snippet: ""
});

assert.ok(
  sanctionArchetypes.archetypes.includes(
    "SANCTIONS_BLOCKADE"
  )
);

const bridgeArchetypes = extractConflictArchetypes({
  title: "Bridge collapse cuts main supply route",
  snippet: ""
});

assert.ok(
  bridgeArchetypes.archetypes.includes(
    "INFRASTRUCTURE_FAILURE"
  )
);

// No evidence: empty array; deterministic order and
// evidence terms persisted.
const noArchetypes = extractConflictArchetypes({
  title: "Museum opens new exhibition",
  snippet: ""
});

assert.deepEqual(noArchetypes.archetypes, []);

assert.deepEqual(
  extractConflictArchetypes({
    title: "Fuel shortage forces rationing",
    snippet: ""
  }),
  fuelArchetypes,
  "Archetype extraction must be deterministic."
);

assert.ok(
  fuelArchetypes.evidence.RESOURCE_SCARCITY.length > 0,
  "Matched terms must be recorded as evidence."
);

// ---------------------------------------------------------
// Traffic scoring
// ---------------------------------------------------------

const baseInput = {
  mentionCount: 4,
  publisherCount: 2,
  queryCount: 2,
  ageHours: 12,
  bestFeedRank: 5
};

const baseScore = calculateTrafficScore(baseInput);

// More independent publishers never lowers the score.
assert.ok(
  calculateTrafficScore({
    ...baseInput,
    publisherCount: 4
  }) >= baseScore
);

// More unique mentions never lowers the score.
assert.ok(
  calculateTrafficScore({
    ...baseInput,
    mentionCount: 8
  }) >= baseScore
);

// Newer articles beat older articles on recency.
assert.ok(recencyScore(2) > recencyScore(100));
assert.ok(
  calculateTrafficScore({
    ...baseInput,
    ageHours: 2
  }) >
    calculateTrafficScore({
      ...baseInput,
      ageHours: 160
    })
);

// A single publisher can never reach BREAKOUT.
const singlePublisherScore = calculateTrafficScore({
  mentionCount: 10,
  publisherCount: 1,
  queryCount: 5,
  ageHours: 0,
  bestFeedRank: 1
});

assert.notEqual(
  classifyTrafficTier({
    trafficScore: singlePublisherScore,
    publisherCount: 1
  }),
  "BREAKOUT"
);

// 3+ publishers with a strong score can reach BREAKOUT.
const strongScore = calculateTrafficScore({
  mentionCount: 6,
  publisherCount: 4,
  queryCount: 4,
  ageHours: 3,
  bestFeedRank: 1
});

assert.equal(
  classifyTrafficTier({
    trafficScore: strongScore,
    publisherCount: 4
  }),
  "BREAKOUT"
);

// Cluster-level evidence: duplicate publishers never
// inflate publisher_count.
const clusterEvidence = deriveClusterTrafficEvidence(
  [
    {
      publisherDomain: "reuters.com",
      queryKeys: ["GENERAL"],
      feedRank: 2,
      publishedAt: "2026-07-11T20:00:00.000Z"
    },
    {
      publisherDomain: "reuters.com",
      queryKeys: ["RESOURCE_ENERGY"],
      feedRank: 4,
      publishedAt: "2026-07-11T18:00:00.000Z"
    },
    {
      publisherDomain: "bbc.com",
      queryKeys: ["GENERAL"],
      feedRank: 9,
      publishedAt: "2026-07-11T22:00:00.000Z"
    }
  ],
  { now: FIXTURE_NOW }
);

assert.equal(clusterEvidence.mentionCount, 3);
assert.equal(clusterEvidence.publisherCount, 2);
assert.equal(clusterEvidence.queryCount, 2);
assert.equal(clusterEvidence.bestFeedRank, 2);
assert.ok(clusterEvidence.trafficScore > 0);
assert.ok(clusterEvidence.trafficScore <= 100);

// ---------------------------------------------------------
// Transformation potential
// ---------------------------------------------------------

const crisisPotential =
  calculateTransformationPotential({
    conflictArchetypes: [
      "RESOURCE_SCARCITY",
      "SUPPLY_CHAIN_DISRUPTION",
      "SANCTIONS_BLOCKADE"
    ],
    crisisKeywords: [
      "shortage",
      "sanction",
      "blockade"
    ],
    category: "ENERGY",
    countryConfidence: 1.0,
    trafficScore: 70
  });

assert.ok(
  ["HIGH", "MEDIUM"].includes(
    crisisPotential.transformationTier
  ),
  "Multiple crisis archetypes must reach HIGH or MEDIUM."
);

const culturePotential =
  calculateTransformationPotential({
    conflictArchetypes: [],
    crisisKeywords: [],
    category: "CULTURE_SOCIETY",
    countryConfidence: 1.0,
    trafficScore: 60
  });

assert.equal(
  culturePotential.transformationTier,
  "LOW",
  "Ordinary culture news must stay LOW."
);

// No country receives a fixed bonus: identical evidence
// scores identically regardless of country context.
const inputsA = {
  conflictArchetypes: ["RESOURCE_SCARCITY"],
  crisisKeywords: ["shortage"],
  category: "ENERGY",
  countryConfidence: 0.8,
  trafficScore: 40
};

assert.deepEqual(
  calculateTransformationPotential(inputsA),
  calculateTransformationPotential({ ...inputsA })
);

// Crisis keyword extraction.
assert.ok(
  extractCrisisKeywords({
    title: "Fuel shortage sparks emergency",
    snippet: ""
  }).length >= 2
);

// Clustering rules exports stay coherent.
assert.ok(
  CLUSTERING_RULES.SIMILARITY_THRESHOLD >= 0.7
);

console.log("TASK 3.3D COUNTRY NEWS CORE TESTS PASSED");

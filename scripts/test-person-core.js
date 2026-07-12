const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  CATALOG_VERSION,
  PERSON_CATALOG,
  validatePersonCatalog
} = require("../lib/person/person-catalog");

const {
  aliasMatchesNormalizedText,
  normalizePersonText
} = require("../lib/person/normalization");

const {
  buildPersonQueries,
  normalizePersonRunPayload
} = require("../lib/person/query-builder");

const {
  COMPOSITE_WEIGHTS,
  calculateNewsCoverageScore,
  calculatePersonTrafficScore,
  calculatePersonTransformationPotential,
  calculateVehicleAttentionScore,
  classifyPersonTrafficTier,
  derivePersonNewsEvidence,
  extractAttentionArchetypes
} = require("../lib/person/metrics");

const {
  aggregateLinkedPeople,
  buildPersonExternalKey,
  buildPersonMentionCandidates,
  pickRepresentativeMention
} = require("../lib/person/engine");

const {
  parseRssItems
} = require("../lib/news/providers/google-news-rss");

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
// Catalog integrity
// ---------------------------------------------------------

assert.equal(
  CATALOG_VERSION,
  "vehicle-person-catalog-v1"
);

assert.ok(PERSON_CATALOG.length >= 20);
assert.equal(validatePersonCatalog(), true);

function catalogEntry(overrides = {}) {
  return {
    slug: "test-person",
    canonicalName: "Test Person",
    aliases: ["test person"],
    countryCode: "US",
    roleCategory: "OTHER",
    priority: 5,
    associations: [
      {
        brand: "Ford",
        series: null,
        model: null,
        relationType: "OTHER",
        confidence: 0.5
      }
    ],
    ...overrides
  };
}

// Duplicate slug rejected.
assert.throws(
  () =>
    validatePersonCatalog([
      catalogEntry(),
      catalogEntry()
    ]),
  /Duplicate catalog slug/
);

// Banned alias rejected.
assert.throws(
  () =>
    validatePersonCatalog([
      catalogEntry({ aliases: ["musk"] })
    ]),
  /Banned person alias/
);

// Single Latin token rejected.
assert.throws(
  () =>
    validatePersonCatalog([
      catalogEntry({ aliases: ["hamilton"] })
    ]),
  /full multi-token name/
);

// Bad relation rejected.
assert.throws(
  () =>
    validatePersonCatalog([
      catalogEntry({
        associations: [
          {
            brand: "Ford",
            relationType: "FRIEND",
            confidence: 0.5
          }
        ]
      })
    ]),
  /Unknown relation/
);

// ---------------------------------------------------------
// Normalization + alias boundaries
// ---------------------------------------------------------

assert.equal(
  normalizePersonText("  Kén—Blóck™!! "),
  "kén blóck"
);

assert.equal(
  normalizePersonText("Vaughn Gittin Jr.'s run"),
  "vaughn gittin jr s run"
);

// The alias normalizes identically, so it still matches.
assert.ok(
  aliasMatchesNormalizedText(
    normalizePersonText("Vaughn Gittin Jr. drifts"),
    "vaughn gittin jr"
  )
);

assert.ok(
  aliasMatchesNormalizedText(
    normalizePersonText(
      "Akio Toyoda drives the GR GT"
    ),
    "akio toyoda"
  )
);

assert.ok(
  !aliasMatchesNormalizedText(
    normalizePersonText("toyoda city traffic"),
    "akio toyoda"
  )
);

assert.ok(
  !aliasMatchesNormalizedText(
    normalizePersonText("block the road"),
    "ken block"
  )
);

// CJK aliases match as substrings.
assert.ok(
  aliasMatchesNormalizedText(
    normalizePersonText("小米雷军发布新车"),
    "雷军"
  )
);

// ---------------------------------------------------------
// Query generation
// ---------------------------------------------------------

const leiJunQueries = buildPersonQueries(
  {
    canonical_name: "Lei Jun",
    linked_brands: ["Xiaomi"],
    linked_series: ["SU7"],
    linked_models: ["SU7 Ultra"]
  },
  { maxQueriesPerPerson: 4 }
);

assert.equal(leiJunQueries.length, 4);
assert.deepEqual(
  leiJunQueries.map(query => query.queryKey),
  [
    "PERSON",
    "PERSON_BRAND",
    "PERSON_MODEL",
    "PERSON_VEHICLE_TOPIC"
  ]
);

// Every query carries the quoted person name; never a
// bare brand query.
for (const query of leiJunQueries) {
  assert.ok(
    query.queryText.includes('"Lei Jun"'),
    `Query ${query.queryKey} must center the person.`
  );
}

assert.equal(
  leiJunQueries[1].queryText,
  '"Lei Jun" Xiaomi'
);
assert.equal(
  leiJunQueries[2].queryText,
  '"Lei Jun" Xiaomi SU7 Ultra'
);

// Default query cap.
assert.equal(
  buildPersonQueries({
    canonical_name: "Lei Jun",
    linked_brands: ["Xiaomi"],
    linked_models: ["SU7"]
  }).length,
  3
);

// Person without brand links still gets person queries.
const bareQueries = buildPersonQueries(
  { canonical_name: "Jay Leno" },
  { maxQueriesPerPerson: 3 }
);

assert.equal(bareQueries[0].queryKey, "PERSON");
assert.ok(bareQueries.length >= 2);

// Run payload validation.
const payload = normalizePersonRunPayload({});

assert.equal(payload.maxPeople, 20);
assert.equal(payload.vehicleWindowDays, 14);
assert.equal(payload.maxQueriesPerPerson, 3);
assert.equal(payload.maxItemsPerQuery, 20);
assert.equal(payload.maxAgeHours, 72);

assert.equal(
  normalizePersonRunPayload({ max_people: 99 })
    .maxPeople,
  30
);
assert.equal(
  normalizePersonRunPayload({
    vehicle_window_days: 9
  }).vehicleWindowDays,
  14
);

// ---------------------------------------------------------
// Mention dedup + person evidence
// ---------------------------------------------------------

const fixtureItems = parseRssItems(personFixtureXml, {
  queryKey: "PERSON",
  queryText: '"Lei Jun"'
});

const leiJunPerson = PERSON_CATALOG.find(
  person => person.slug === "lei-jun"
);

const muskPerson = PERSON_CATALOG.find(
  person => person.slug === "elon-musk"
);

const leiJunMentions = buildPersonMentionCandidates(
  {
    slug: "lei-jun",
    aliases: leiJunPerson.aliases
  },
  fixtureItems,
  { maxAgeHours: 72, now: FIXTURE_NOW }
);

// 5 fixture items: the 11-day-old archive item expires.
assert.equal(leiJunMentions.mentions.length, 4);
assert.equal(leiJunMentions.expiredCount, 1);

const titleVerified = leiJunMentions.mentions.find(
  mention =>
    mention.guid === "fixture-person-leijun-1"
);

assert.equal(
  titleVerified.personMatchMethod,
  "TITLE_ALIAS"
);
assert.equal(titleVerified.personConfidence, 1.0);

const snippetVerified =
  leiJunMentions.mentions.find(
    mention =>
      mention.guid === "fixture-person-leijun-2"
  );

assert.equal(
  snippetVerified.personMatchMethod,
  "SNIPPET_ALIAS"
);

const weakMention = leiJunMentions.mentions.find(
  mention =>
    mention.guid === "fixture-person-leijun-3"
);

assert.equal(
  weakMention.personMatchMethod,
  "QUERY_CONTEXT"
);
assert.ok(weakMention.personConfidence <= 0.5);

// Duplicate items from a second query merge instead of
// duplicating the mention.
const duplicated = buildPersonMentionCandidates(
  {
    slug: "lei-jun",
    aliases: leiJunPerson.aliases
  },
  [
    ...fixtureItems,
    ...parseRssItems(personFixtureXml, {
      queryKey: "PERSON_BRAND",
      queryText: '"Lei Jun" Xiaomi'
    })
  ],
  { maxAgeHours: 72, now: FIXTURE_NOW }
);

assert.equal(duplicated.mentions.length, 4);
assert.deepEqual(
  [...duplicated.mentions[0].queryKeys].sort(),
  ["PERSON", "PERSON_BRAND"]
);

// The same article can link two different people: the
// external key is person-neutral and uniqueness lives on
// (person_id, external_key).
const dualItem = fixtureItems.find(
  item => item.guid === "fixture-person-dual-1"
);

const muskMentions = buildPersonMentionCandidates(
  {
    slug: "elon-musk",
    aliases: muskPerson.aliases
  },
  [dualItem],
  { maxAgeHours: 72, now: FIXTURE_NOW }
);

assert.equal(muskMentions.mentions.length, 1);
assert.equal(
  muskMentions.mentions[0].personMatchMethod,
  "TITLE_ALIAS"
);

assert.equal(
  buildPersonExternalKey(dualItem),
  leiJunMentions.mentions.find(
    mention =>
      mention.guid === "fixture-person-dual-1"
  ).externalKey,
  "The same article keeps the same external key across people."
);

// Weak query-context mentions never dominate the
// representative headline.
assert.equal(
  pickRepresentativeMention([
    {
      personMatchMethod: "QUERY_CONTEXT",
      personConfidence: 0.5,
      title: "Weak mention",
      publishedAt: "2026-07-11T10:00:00Z"
    }
  ]),
  null
);

const representative = pickRepresentativeMention(
  leiJunMentions.mentions
);

assert.equal(
  representative.personMatchMethod,
  "TITLE_ALIAS"
);

// ---------------------------------------------------------
// Vehicle attention metrics (real views)
// ---------------------------------------------------------

const baseVehicle = {
  vehicleViewsTotal: 500000,
  qualifiedVehicleSignalCount: 2,
  directVehicleMentionCount: 1,
  vehicleSignalCount: 3
};

const baseAttention =
  calculateVehicleAttentionScore(baseVehicle);

assert.ok(baseAttention > 0);
assert.ok(baseAttention <= 100);

// Monotonicity: more real evidence never lowers the score.
assert.ok(
  calculateVehicleAttentionScore({
    ...baseVehicle,
    vehicleViewsTotal: 5000000
  }) >= baseAttention
);

assert.ok(
  calculateVehicleAttentionScore({
    ...baseVehicle,
    qualifiedVehicleSignalCount: 5
  }) >= baseAttention
);

assert.ok(
  calculateVehicleAttentionScore({
    ...baseVehicle,
    directVehicleMentionCount: 4
  }) >= baseAttention
);

assert.equal(
  calculateVehicleAttentionScore({
    vehicleViewsTotal: 0,
    qualifiedVehicleSignalCount: 0,
    directVehicleMentionCount: 0,
    vehicleSignalCount: 0
  }),
  0
);

// ---------------------------------------------------------
// News coverage metrics (proxy)
// ---------------------------------------------------------

const baseNews = {
  newsMentionCount: 4,
  publisherCount: 2,
  queryCount: 2,
  ageHours: 12,
  bestFeedRank: 5
};

const baseCoverage =
  calculateNewsCoverageScore(baseNews);

assert.ok(
  calculateNewsCoverageScore({
    ...baseNews,
    publisherCount: 4
  }) >= baseCoverage
);

assert.ok(
  calculateNewsCoverageScore({
    ...baseNews,
    newsMentionCount: 8
  }) >= baseCoverage
);

assert.ok(
  calculateNewsCoverageScore({
    ...baseNews,
    ageHours: 2
  }) >
    calculateNewsCoverageScore({
      ...baseNews,
      ageHours: 160
    })
);

// No news at all: coverage is exactly zero and the
// vehicle-only signal stays valid.
const emptyNews = derivePersonNewsEvidence([], {
  now: FIXTURE_NOW
});

assert.equal(emptyNews.newsCoverageScore, 0);
assert.equal(emptyNews.newsMentionCount, 0);
assert.equal(emptyNews.ageHours, null);

// Publisher dedup: same publisher twice counts once.
const newsEvidence = derivePersonNewsEvidence(
  [
    {
      publisherDomain: "reuters.com",
      queryKeys: ["PERSON"],
      feedRank: 2,
      publishedAt: "2026-07-11T20:00:00.000Z"
    },
    {
      publisherDomain: "reuters.com",
      queryKeys: ["PERSON_BRAND"],
      feedRank: 4,
      publishedAt: "2026-07-11T18:00:00.000Z"
    },
    {
      publisherDomain: "bloomberg.com",
      queryKeys: ["PERSON"],
      feedRank: 9,
      publishedAt: "2026-07-11T22:00:00.000Z"
    }
  ],
  { now: FIXTURE_NOW }
);

assert.equal(newsEvidence.newsMentionCount, 3);
assert.equal(newsEvidence.publisherCount, 2);
assert.equal(newsEvidence.queryCount, 2);
assert.equal(newsEvidence.bestFeedRank, 2);

// ---------------------------------------------------------
// Composite score + tiers
// ---------------------------------------------------------

assert.equal(COMPOSITE_WEIGHTS.VEHICLE, 0.65);
assert.equal(COMPOSITE_WEIGHTS.NEWS, 0.35);

assert.equal(
  calculatePersonTrafficScore({
    vehicleAttentionScore: 80,
    newsCoverageScore: 40
  }),
  80 * 0.65 + 40 * 0.35
);

// Vehicle side dominates the composite.
assert.ok(
  calculatePersonTrafficScore({
    vehicleAttentionScore: 100,
    newsCoverageScore: 0
  }) >
    calculatePersonTrafficScore({
      vehicleAttentionScore: 0,
      newsCoverageScore: 100
    })
);

// News-only maximum can never reach BREAKOUT: with zero
// vehicle attention the composite caps at 35, and a
// single publisher blocks the publisher path anyway.
const newsOnlyScore = calculatePersonTrafficScore({
  vehicleAttentionScore: 0,
  newsCoverageScore: 100
});

assert.ok(newsOnlyScore <= 35);
assert.notEqual(
  classifyPersonTrafficTier({
    trafficScore: newsOnlyScore,
    vehicleViewsTotal: 0,
    publisherCount: 1
  }),
  "BREAKOUT"
);

// Even a high composite with a single publisher and low
// vehicle views is not BREAKOUT.
assert.equal(
  classifyPersonTrafficTier({
    trafficScore: 80,
    vehicleViewsTotal: 500,
    publisherCount: 1
  }),
  "ACTIVE"
);

// Real vehicle views unlock BREAKOUT.
assert.equal(
  classifyPersonTrafficTier({
    trafficScore: 80,
    vehicleViewsTotal: 2000000,
    publisherCount: 1
  }),
  "BREAKOUT"
);

// Cross-publisher coverage also unlocks BREAKOUT.
assert.equal(
  classifyPersonTrafficTier({
    trafficScore: 80,
    vehicleViewsTotal: 100,
    publisherCount: 3
  }),
  "BREAKOUT"
);

assert.equal(
  classifyPersonTrafficTier({
    trafficScore: 30,
    vehicleViewsTotal: 0,
    publisherCount: 0
  }),
  "WATCH"
);

assert.equal(
  classifyPersonTrafficTier({
    trafficScore: 10,
    vehicleViewsTotal: 0,
    publisherCount: 0
  }),
  "LOW_SIGNAL"
);

// ---------------------------------------------------------
// Attention archetypes
// ---------------------------------------------------------

const crashArchetypes = extractAttentionArchetypes({
  vehicleTitles: ["Tesla crash on highway"],
  vehicleActions: [],
  headlines: [],
  snippets: []
});

assert.ok(
  crashArchetypes.archetypes.includes(
    "ACCIDENT_SAFETY"
  )
);

const actionArchetypes = extractAttentionArchetypes({
  vehicleTitles: [],
  vehicleActions: ["DRAG_RACING"],
  headlines: [],
  snippets: []
});

assert.ok(
  actionArchetypes.archetypes.includes(
    "PERFORMANCE_RIVALRY"
  )
);

const newsArchetypes = extractAttentionArchetypes({
  vehicleTitles: [],
  vehicleActions: [],
  headlines: [
    "CEO steps down after lawsuit",
    "New record lap for the SU7 Ultra"
  ],
  snippets: []
});

assert.ok(
  newsArchetypes.archetypes.includes(
    "LEADERSHIP_POWER"
  )
);
assert.ok(
  newsArchetypes.archetypes.includes(
    "LEGAL_REGULATORY"
  )
);
assert.ok(
  newsArchetypes.archetypes.includes(
    "RECORD_ACHIEVEMENT"
  )
);

// No evidence: empty array. Names alone never generate an
// archetype.
assert.deepEqual(
  extractAttentionArchetypes({
    vehicleTitles: ["Akio Toyoda"],
    vehicleActions: [],
    headlines: ["Lei Jun"],
    snippets: []
  }).archetypes,
  []
);

// Deterministic output with evidence.
const repeated = extractAttentionArchetypes({
  vehicleTitles: ["Tesla crash on highway"],
  vehicleActions: [],
  headlines: [],
  snippets: []
});

assert.deepEqual(repeated, crashArchetypes);
assert.ok(
  repeated.evidence.ACCIDENT_SAFETY.length > 0
);

// ---------------------------------------------------------
// Transformation potential
// ---------------------------------------------------------

const highPotential =
  calculatePersonTransformationPotential({
    trafficScore: 80,
    linkConfidence: 1,
    directMention: true,
    attentionArchetypes: [
      "PERFORMANCE_RIVALRY",
      "TECHNOLOGY_VISION",
      "RECORD_ACHIEVEMENT"
    ]
  });

assert.equal(
  highPotential.transformationTier,
  "HIGH"
);

const lowPotential =
  calculatePersonTransformationPotential({
    trafficScore: 10,
    linkConfidence: 0.5,
    directMention: false,
    attentionArchetypes: []
  });

assert.equal(lowPotential.transformationTier, "LOW");

// Country never changes the score: the function has no
// country input, and identical evidence always scores
// identically.
const inputsA = {
  trafficScore: 55,
  linkConfidence: 0.85,
  directMention: true,
  attentionArchetypes: ["TECHNOLOGY_VISION"]
};

assert.deepEqual(
  calculatePersonTransformationPotential(inputsA),
  calculatePersonTransformationPotential({
    ...inputsA
  })
);

// ---------------------------------------------------------
// Active vehicle aggregation + person priority
// ---------------------------------------------------------

const anchors = [
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

const people = aggregateLinkedPeople(anchors);

const slugs = people.map(person => person.slug);

assert.ok(slugs.includes("lei-jun"));
assert.ok(slugs.includes("elon-musk"));

// Priority: Lei Jun (8M views + direct mention) ranks
// above Elon Musk (3M brand association).
assert.ok(
  slugs.indexOf("lei-jun") <
    slugs.indexOf("elon-musk")
);

const leiJunSummary = people.find(
  person => person.slug === "lei-jun"
);

assert.equal(leiJunSummary.vehicle_signal_count, 1);
assert.equal(
  leiJunSummary.direct_vehicle_mention_count,
  1
);
assert.equal(
  leiJunSummary.vehicle_views_total,
  8000000
);
assert.ok(
  leiJunSummary.linked_brands.has("Xiaomi")
);
assert.ok(leiJunSummary.links.size > 0);

// No vehicle anchors: no people, no person signals.
assert.deepEqual(aggregateLinkedPeople([]), []);

console.log("TASK 3.3E PERSON CORE TESTS PASSED");

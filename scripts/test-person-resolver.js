const assert = require("node:assert/strict");

const {
  MENTION_MATCH_CONFIDENCE,
  PERSON_RESOLVER_VERSION,
  resolvePersonMentionEvidence,
  resolvePersonsForVehicleSignal
} = require("../lib/person/resolver");

const {
  MAX_BRAND_ASSOCIATION_PEOPLE_PER_BRAND
} = require("../lib/person/resolver");

function findPerson(results, slug) {
  return results.find(
    result => result.person.slug === slug
  );
}

// ---------------------------------------------------------
// Direct mentions with matching vehicles
// ---------------------------------------------------------

const toyoda = findPerson(
  resolvePersonsForVehicleSignal({
    title: "Akio Toyoda drives the GR GT",
    vehicleBrand: "Toyota",
    vehicleSeries: "GR",
    vehicleModel: "GR GT"
  }),
  "akio-toyoda"
);

assert.ok(toyoda, "Akio Toyoda must resolve.");
assert.equal(toyoda.directMention, true);
assert.equal(toyoda.linkMethod, "DIRECT_MENTION");
assert.equal(toyoda.linkConfidence, 1.0);
assert.equal(
  toyoda.resolverVersion,
  PERSON_RESOLVER_VERSION
);
assert.equal(toyoda.evidence.field, "title");

const leiJun = findPerson(
  resolvePersonsForVehicleSignal({
    title: "Lei Jun launches Xiaomi SU7 Ultra",
    vehicleBrand: "Xiaomi",
    vehicleSeries: "SU7",
    vehicleModel: "SU7 Ultra"
  }),
  "lei-jun"
);

assert.ok(leiJun, "Lei Jun must resolve.");
assert.equal(leiJun.directMention, true);
assert.equal(leiJun.linkConfidence, 1.0);

// CJK alias also resolves.
const leiJunCjk = findPerson(
  resolvePersonsForVehicleSignal({
    title: "雷军发布小米SU7 Ultra",
    vehicleBrand: "Xiaomi",
    vehicleSeries: "SU7",
    vehicleModel: "SU7 Ultra"
  }),
  "lei-jun"
);

assert.ok(leiJunCjk, "CJK alias must resolve Lei Jun.");
assert.equal(leiJunCjk.directMention, true);

const musk = findPerson(
  resolvePersonsForVehicleSignal({
    title: "Elon Musk reveals Tesla Roadster",
    vehicleBrand: "Tesla",
    vehicleModel: "Roadster"
  }),
  "elon-musk"
);

assert.ok(musk, "Elon Musk must resolve.");
assert.equal(musk.directMention, true);
assert.equal(musk.linkConfidence, 1.0);

const block = findPerson(
  resolvePersonsForVehicleSignal({
    title: "Ken Block Mustang drift tribute",
    vehicleBrand: "Ford",
    vehicleSeries: "Mustang",
    vehicleModel: "Mustang"
  }),
  "ken-block"
);

assert.ok(block, "Ken Block must resolve.");
assert.equal(block.directMention, true);
assert.equal(block.linkConfidence, 1.0);

// ---------------------------------------------------------
// False positives: partial names never match
// ---------------------------------------------------------

const blockRoad = resolvePersonsForVehicleSignal({
  title: "Police block the road for a Ford convoy",
  vehicleBrand: "Ford"
});

assert.ok(
  !blockRoad.some(
    result =>
      result.person.slug === "ken-block" &&
      result.directMention
  ),
  "'block the road' must never direct-match Ken Block."
);

const muskOx = resolvePersonsForVehicleSignal({
  title: "musk ox crossing delays traffic"
});

assert.ok(
  !muskOx.some(
    result => result.person.slug === "elon-musk"
  ),
  "'musk ox' must never match Elon Musk."
);

const junUpdate = resolvePersonsForVehicleSignal({
  title: "jun software update released"
});

assert.ok(
  !junUpdate.some(
    result => result.person.slug === "lei-jun"
  ),
  "'jun update' must never match Lei Jun."
);

const toyodaCity = resolvePersonsForVehicleSignal({
  title: "toyoda city traffic report",
  vehicleBrand: "Toyota"
});

assert.ok(
  !toyodaCity.some(
    result =>
      result.person.slug === "akio-toyoda" &&
      result.directMention
  ),
  "'toyoda city' must never direct-match Akio Toyoda."
);

// ---------------------------------------------------------
// Field priority: title > tags > description
// ---------------------------------------------------------

const tagMatch = findPerson(
  resolvePersonsForVehicleSignal({
    title: "Mustang drift session",
    tags: ["ken block", "drifting"],
    vehicleBrand: "Ford",
    vehicleSeries: "Mustang",
    vehicleModel: "Mustang"
  }),
  "ken-block"
);

assert.ok(tagMatch);
assert.equal(tagMatch.directMention, true);
assert.equal(tagMatch.evidence.field, "tags");
assert.equal(tagMatch.linkConfidence, 0.95);

const descriptionMatch = findPerson(
  resolvePersonsForVehicleSignal({
    title: "Mustang drift session",
    description:
      "A tribute run inspired by Ken Block.",
    vehicleBrand: "Ford",
    vehicleSeries: "Mustang",
    vehicleModel: "Mustang"
  }),
  "ken-block"
);

assert.ok(descriptionMatch);
assert.equal(
  descriptionMatch.evidence.field,
  "description"
);
assert.equal(descriptionMatch.linkConfidence, 0.85);

// ---------------------------------------------------------
// Association candidates without a direct mention
// ---------------------------------------------------------

const su7Association = findPerson(
  resolvePersonsForVehicleSignal({
    title: "Xiaomi SU7 Ultra acceleration run",
    vehicleBrand: "Xiaomi",
    vehicleSeries: "SU7",
    vehicleModel: "SU7 Ultra"
  }),
  "lei-jun"
);

assert.ok(
  su7Association,
  "Lei Jun must be a candidate via SU7 association."
);
assert.equal(su7Association.directMention, false);
assert.equal(
  su7Association.linkMethod,
  "MODEL_ASSOCIATION"
);
assert.ok(
  su7Association.linkConfidence < 1.0,
  "Association confidence must stay below direct match."
);

// Multiple plausible people are all kept with independent
// confidence and evidence.
const mustangResults =
  resolvePersonsForVehicleSignal({
    title: "Ford Mustang burnout compilation",
    vehicleBrand: "Ford",
    vehicleSeries: "Mustang",
    vehicleModel: "Mustang"
  });

const mustangSlugs = mustangResults.map(
  result => result.person.slug
);

assert.ok(mustangSlugs.includes("ken-block"));
assert.ok(mustangSlugs.includes("vaughn-gittin-jr"));

for (const result of mustangResults) {
  assert.ok(result.linkConfidence > 0);
  assert.ok(result.evidence);
}

// ---------------------------------------------------------
// Brand-only association capping
// ---------------------------------------------------------

const fordBrandOnly = resolvePersonsForVehicleSignal({
  title: "Ford factory tour highlights",
  vehicleBrand: "Ford"
});

const fordBrandCandidates = fordBrandOnly.filter(
  result => result.linkMethod === "BRAND_ASSOCIATION"
);

assert.ok(
  fordBrandCandidates.length <=
    MAX_BRAND_ASSOCIATION_PEOPLE_PER_BRAND,
  "Brand-only association must be capped per brand."
);

// No vehicle brand and no person alias: nothing resolves.
assert.equal(
  resolvePersonsForVehicleSignal({
    title: "generic traffic report"
  }).length,
  0
);

// ---------------------------------------------------------
// RSS mention verification
// ---------------------------------------------------------

const titleMention = resolvePersonMentionEvidence({
  title: "Lei Jun unveils Xiaomi SU7 Ultra",
  snippet: "",
  aliases: ["lei jun", "雷军"]
});

assert.equal(titleMention.matchMethod, "TITLE_ALIAS");
assert.equal(
  titleMention.confidence,
  MENTION_MATCH_CONFIDENCE.TITLE_ALIAS
);

const snippetMention = resolvePersonMentionEvidence({
  title: "Xiaomi SU7 Ultra sets new benchmark",
  snippet: "Founder Lei Jun celebrated the run.",
  aliases: ["lei jun", "雷军"]
});

assert.equal(
  snippetMention.matchMethod,
  "SNIPPET_ALIAS"
);
assert.equal(snippetMention.confidence, 0.8);

const queryMention = resolvePersonMentionEvidence({
  title: "Xiaomi shares rise on EV sales",
  snippet: "Deliveries beat expectations.",
  aliases: ["lei jun", "雷军"]
});

assert.equal(
  queryMention.matchMethod,
  "QUERY_CONTEXT"
);
assert.ok(queryMention.confidence <= 0.5);

// A different person with a similar surname never gets
// high confidence without the full alias.
const otherPerson = resolvePersonMentionEvidence({
  title: "Jun Matsumoto wins acting award",
  snippet: "",
  aliases: ["lei jun", "雷军"]
});

assert.equal(
  otherPerson.matchMethod,
  "QUERY_CONTEXT"
);
assert.ok(otherPerson.confidence <= 0.5);

console.log("TASK 3.3E PERSON RESOLVER TESTS PASSED");

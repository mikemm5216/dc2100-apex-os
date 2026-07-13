const assert = require("node:assert/strict");

const {
  EVIDENCE_HORIZONS,
  PERSON_RESONANCE_BREADTH,
  RELATIONSHIP_SCOPES,
  RESONANCE_THRESHOLDS,
  RESONANCE_TIERS,
  RESONANCE_VERSION,
  RESONANCE_WEIGHTS,
  calculateLinkHistoricalResonance,
  calculatePersonHistoricalResonance,
  classifyHistoricalResonanceTier,
  isAssociationEligibleForScope
} = require("../lib/person/resonance");

const {
  PERSON_CATALOG,
  RESONANCE_CATALOG_VERSION,
  validatePersonCatalog
} = require("../lib/person/person-catalog");

const {
  persistPersonResonance
} = require("../lib/person/engine");

const {
  listPersonRadar,
  parsePersonRadarQuery
} = require("../lib/person/api");

function findPerson(slug) {
  const person = PERSON_CATALOG.find(
    entry => entry.slug === slug
  );

  assert.ok(person, `Catalog person ${slug} missing.`);
  return person;
}

function association(overrides = {}) {
  return {
    brand: "Ford",
    series: null,
    model: null,
    relationType: "DRIVER",
    confidence: 0.9,
    evidenceHorizon: "ONE_YEAR",
    iconicAssociation: false,
    legacyAssociation: false,
    recognitionWeight: 0.5,
    associationStartYear: null,
    associationEndYear: null,
    resonanceLabel: "Test association.",
    ...overrides
  };
}

// ---------------------------------------------------------
// Constants + catalog resonance integrity
// ---------------------------------------------------------

assert.equal(
  RESONANCE_VERSION,
  "vehicle-person-resonance-v1"
);
assert.equal(
  RESONANCE_CATALOG_VERSION,
  "vehicle-person-resonance-v1"
);

assert.deepEqual(RELATIONSHIP_SCOPES, [
  "ONE_YEAR",
  "TEN_YEARS",
  "ALL_TIME"
]);

assert.deepEqual(EVIDENCE_HORIZONS, [
  "ONE_YEAR",
  "TEN_YEARS",
  "ALL_TIME"
]);

assert.deepEqual(Object.values(RESONANCE_TIERS), [
  "ICONIC",
  "ESTABLISHED",
  "RECOGNIZABLE",
  "NICHE"
]);

// Every catalog association carries complete resonance
// metadata (enforced at module load, re-checked here).
assert.equal(validatePersonCatalog(), true);
assert.ok(PERSON_CATALOG.length >= 20);

for (const person of PERSON_CATALOG) {
  for (const entry of person.associations) {
    assert.ok(
      EVIDENCE_HORIZONS.includes(
        entry.evidenceHorizon
      ),
      `${person.slug} needs an evidence horizon.`
    );
    assert.equal(
      typeof entry.iconicAssociation,
      "boolean"
    );
    assert.equal(
      typeof entry.legacyAssociation,
      "boolean"
    );
    assert.ok(
      entry.recognitionWeight >= 0 &&
        entry.recognitionWeight <= 1
    );
    assert.ok(
      typeof entry.resonanceLabel === "string" &&
        entry.resonanceLabel.length > 0 &&
        entry.resonanceLabel.length <= 240
    );
  }
}

// Resonance metadata is required: missing horizon /
// weight / label all reject.
const basePerson = {
  slug: "test-person",
  canonicalName: "Test Person",
  aliases: ["test person"],
  countryCode: "US",
  roleCategory: "OTHER",
  priority: 5
};

assert.throws(
  () =>
    validatePersonCatalog([
      {
        ...basePerson,
        associations: [
          association({ evidenceHorizon: "FOREVER" })
        ]
      }
    ]),
  /evidence horizon/
);

assert.throws(
  () =>
    validatePersonCatalog([
      {
        ...basePerson,
        associations: [
          association({ recognitionWeight: 1.5 })
        ]
      }
    ]),
  /Recognition weight/
);

assert.throws(
  () =>
    validatePersonCatalog([
      {
        ...basePerson,
        associations: [
          association({
            resonanceLabel: "x".repeat(241)
          })
        ]
      }
    ]),
  /Resonance label/
);

assert.throws(
  () =>
    validatePersonCatalog([
      {
        ...basePerson,
        associations: [
          association({
            associationStartYear: 2000,
            associationEndYear: 1990
          })
        ]
      }
    ]),
  /end year precedes/
);

assert.throws(
  () =>
    validatePersonCatalog([
      {
        ...basePerson,
        associations: [
          association({ associationStartYear: 1700 })
        ]
      }
    ]),
  /Association years/
);

// ---------------------------------------------------------
// Cumulative scope eligibility
// ---------------------------------------------------------

const oneYearEvidence = association({
  evidenceHorizon: "ONE_YEAR"
});
const tenYearEvidence = association({
  evidenceHorizon: "TEN_YEARS"
});
const allTimeEvidence = association({
  evidenceHorizon: "ALL_TIME"
});

// ONE_YEAR evidence: eligible everywhere.
for (const scope of RELATIONSHIP_SCOPES) {
  assert.equal(
    isAssociationEligibleForScope(
      oneYearEvidence,
      scope
    ),
    true
  );
}

// TEN_YEARS evidence: not in ONE_YEAR.
assert.equal(
  isAssociationEligibleForScope(
    tenYearEvidence,
    "ONE_YEAR"
  ),
  false
);
assert.equal(
  isAssociationEligibleForScope(
    tenYearEvidence,
    "TEN_YEARS"
  ),
  true
);
assert.equal(
  isAssociationEligibleForScope(
    tenYearEvidence,
    "ALL_TIME"
  ),
  true
);

// ALL_TIME evidence: only in ALL_TIME.
assert.equal(
  isAssociationEligibleForScope(
    allTimeEvidence,
    "ONE_YEAR"
  ),
  false
);
assert.equal(
  isAssociationEligibleForScope(
    allTimeEvidence,
    "TEN_YEARS"
  ),
  false
);
assert.equal(
  isAssociationEligibleForScope(
    allTimeEvidence,
    "ALL_TIME"
  ),
  true
);

// Unknown scope / missing horizon stay conservative.
assert.equal(
  isAssociationEligibleForScope(
    oneYearEvidence,
    "FOREVER"
  ),
  false
);
assert.equal(
  isAssociationEligibleForScope({}, "ONE_YEAR"),
  false
);
assert.equal(
  isAssociationEligibleForScope({}, "ALL_TIME"),
  true
);

// ---------------------------------------------------------
// Required catalog examples
// ---------------------------------------------------------

// Carroll Shelby ↔ Mustang: ALL_TIME iconic + legacy.
const shelby = findPerson("carroll-shelby");

const shelbyMustang = shelby.associations.find(
  entry => entry.brand === "Ford"
);

assert.equal(shelbyMustang.evidenceHorizon, "ALL_TIME");
assert.equal(shelbyMustang.iconicAssociation, true);
assert.equal(shelbyMustang.legacyAssociation, true);

const shelbyLink =
  calculateLinkHistoricalResonance(shelbyMustang);

// 25 model + 17 BUILDER + 25 ALL_TIME + 15 iconic
// + 10 legacy + 5 recognition = 97.
assert.equal(shelbyLink.score, 97);

const shelbyAllTime = calculatePersonHistoricalResonance(
  shelby.associations,
  "ALL_TIME"
);
const shelbyOneYear = calculatePersonHistoricalResonance(
  shelby.associations,
  "ONE_YEAR"
);

assert.equal(shelbyAllTime.tier, "ICONIC");
assert.ok(shelbyAllTime.score >= 80);
assert.equal(shelbyOneYear.score, null);
assert.equal(shelbyOneYear.tier, null);

// Enzo Ferrari ↔ Ferrari: deterministic ALL_TIME tier.
const enzo = findPerson("enzo-ferrari");

const enzoAllTime = calculatePersonHistoricalResonance(
  enzo.associations,
  "ALL_TIME"
);

assert.equal(enzoAllTime.score, 81);
assert.ok(
  ["ICONIC", "ESTABLISHED"].includes(
    enzoAllTime.tier
  )
);
assert.equal(enzoAllTime.tier, "ICONIC");
assert.equal(
  calculatePersonHistoricalResonance(
    enzo.associations,
    "ONE_YEAR"
  ).score,
  null
);

// Ken Block ↔ Ford / Hoonigan: TEN_YEARS evidence.
const kenBlock = findPerson("ken-block");

const kenOneYear = calculatePersonHistoricalResonance(
  kenBlock.associations,
  "ONE_YEAR"
);
const kenTenYears = calculatePersonHistoricalResonance(
  kenBlock.associations,
  "TEN_YEARS"
);
const kenAllTime = calculatePersonHistoricalResonance(
  kenBlock.associations,
  "ALL_TIME"
);

assert.equal(kenOneYear.score, null);
assert.ok(kenTenYears.score !== null);
assert.ok(kenAllTime.score !== null);
assert.equal(kenTenYears.score, kenAllTime.score);

// Akio Toyoda ↔ Toyota GR: ONE_YEAR evidence scores in
// all three scopes.
const akio = findPerson("akio-toyoda");

for (const scope of RELATIONSHIP_SCOPES) {
  const result = calculatePersonHistoricalResonance(
    akio.associations,
    scope
  );

  assert.ok(
    result.score !== null,
    `Akio Toyoda must be scored in ${scope}.`
  );
  assert.ok(result.tier !== null);
}

// Lei Jun ↔ Xiaomi SU7: ONE_YEAR evidence scores in all
// three scopes.
const leiJun = findPerson("lei-jun");

for (const scope of RELATIONSHIP_SCOPES) {
  const result = calculatePersonHistoricalResonance(
    leiJun.associations,
    scope
  );

  assert.ok(result.score !== null);
  assert.ok(result.tier !== null);
}

// ---------------------------------------------------------
// Independence: traffic-shaped inputs never change the
// resonance result.
// ---------------------------------------------------------

const cleanAssociation = association({
  model: "Mustang",
  iconicAssociation: true,
  recognitionWeight: 1
});

const pollutedAssociation = {
  ...cleanAssociation,
  vehicleViews: 10000000,
  vehicleViewsTotal: 10000000,
  publisherCount: 50,
  newsMentionCount: 500,
  trafficTier: "BREAKOUT",
  trafficScore: 99,
  country: "US",
  nationality: "US"
};

assert.deepEqual(
  calculateLinkHistoricalResonance(
    pollutedAssociation
  ),
  calculateLinkHistoricalResonance(cleanAssociation)
);

const cleanPerson = calculatePersonHistoricalResonance(
  [cleanAssociation],
  "ALL_TIME"
);
const pollutedPerson =
  calculatePersonHistoricalResonance(
    [pollutedAssociation],
    "ALL_TIME"
  );

assert.equal(
  pollutedPerson.score,
  cleanPerson.score
);
assert.equal(pollutedPerson.tier, cleanPerson.tier);

// Views 1,000 vs 10,000,000 shaped inputs: identical.
assert.equal(
  calculateLinkHistoricalResonance({
    ...cleanAssociation,
    vehicleViews: 1000
  }).score,
  calculateLinkHistoricalResonance({
    ...cleanAssociation,
    vehicleViews: 10000000
  }).score
);

// ---------------------------------------------------------
// Monotonic guarantees
// ---------------------------------------------------------

// Model-specific >= brand-only.
assert.ok(
  calculateLinkHistoricalResonance(
    association({ model: "Mustang" })
  ).score >=
    calculateLinkHistoricalResonance(association())
      .score
);

// Series-specific between model and brand.
assert.ok(
  calculateLinkHistoricalResonance(
    association({ model: "Mustang" })
  ).score >=
    calculateLinkHistoricalResonance(
      association({ series: "Mustang" })
    ).score
);

// Iconic true never lowers the score.
assert.ok(
  calculateLinkHistoricalResonance(
    association({ iconicAssociation: true })
  ).score >=
    calculateLinkHistoricalResonance(association())
      .score
);

// Legacy true never lowers the score.
assert.ok(
  calculateLinkHistoricalResonance(
    association({ legacyAssociation: true })
  ).score >=
    calculateLinkHistoricalResonance(association())
      .score
);

// Higher recognition weight never lowers the score.
assert.ok(
  calculateLinkHistoricalResonance(
    association({ recognitionWeight: 1 })
  ).score >=
    calculateLinkHistoricalResonance(
      association({ recognitionWeight: 0.2 })
    ).score
);

// Relation strengths are all distinct (no ties) and the
// strong relations outrank the weak ones.
const strengthValues = Object.values(
  RESONANCE_WEIGHTS.RELATION_STRENGTH
);

assert.equal(
  new Set(strengthValues).size,
  strengthValues.length,
  "No two relation types may score identically."
);

for (const strong of [
  "FOUNDER",
  "DESIGNER",
  "ENGINEER",
  "DRIVER",
  "RACING_DRIVER",
  "BUILDER",
  "TUNER"
]) {
  for (const weak of ["OWNER", "CREATOR", "OTHER"]) {
    assert.ok(
      RESONANCE_WEIGHTS.RELATION_STRENGTH[strong] >
        RESONANCE_WEIGHTS.RELATION_STRENGTH[weak],
      `${strong} must outrank ${weak}.`
    );
  }
}

// A larger scope never loses evidence a smaller scope
// already had: for every catalog person, scope scores
// are monotonically non-decreasing.
for (const person of PERSON_CATALOG) {
  let previous = null;

  for (const scope of RELATIONSHIP_SCOPES) {
    const result = calculatePersonHistoricalResonance(
      person.associations,
      scope
    );

    if (previous !== null && previous.score !== null) {
      assert.ok(
        result.score !== null,
        `${person.slug}: ${scope} must keep smaller-scope evidence.`
      );
      assert.ok(
        result.score >= previous.score,
        `${person.slug}: ${scope} score must not drop.`
      );
    }

    previous = result;
  }
}

// ---------------------------------------------------------
// Tier rules
// ---------------------------------------------------------

// ICONIC requires score >= 80 AND iconic/legacy evidence.
assert.equal(
  classifyHistoricalResonanceTier({
    score: 90,
    hasIconicEvidence: true
  }),
  "ICONIC"
);

// High score WITHOUT iconic/legacy evidence caps at
// ESTABLISHED.
assert.equal(
  classifyHistoricalResonanceTier({
    score: 90,
    hasIconicEvidence: false
  }),
  "ESTABLISHED"
);

assert.equal(
  classifyHistoricalResonanceTier({
    score: 79.99,
    hasIconicEvidence: true
  }),
  "ESTABLISHED"
);

assert.equal(
  classifyHistoricalResonanceTier({ score: 45 }),
  "RECOGNIZABLE"
);

assert.equal(
  classifyHistoricalResonanceTier({ score: 10 }),
  "NICHE"
);

// Null score => null tier — never NICHE.
assert.equal(
  classifyHistoricalResonanceTier({ score: null }),
  null
);

assert.equal(RESONANCE_THRESHOLDS.ICONIC, 80);
assert.equal(RESONANCE_THRESHOLDS.ESTABLISHED, 60);
assert.equal(RESONANCE_THRESHOLDS.RECOGNIZABLE, 40);

// Breadth bonus: each additional strong (>= 50) eligible
// link adds 2, capped at 8; never counts the primary.
const strongLink = association({
  model: "Mustang",
  iconicAssociation: true,
  recognitionWeight: 1
});

const soloResult = calculatePersonHistoricalResonance(
  [strongLink],
  "ALL_TIME"
);

const breadthResult =
  calculatePersonHistoricalResonance(
    [
      strongLink,
      association({
        brand: "Shelby",
        relationType: "FOUNDER",
        iconicAssociation: true,
        recognitionWeight: 1
      })
    ],
    "ALL_TIME"
  );

assert.equal(
  breadthResult.score,
  Math.min(100, soloResult.score + 2)
);
assert.equal(
  PERSON_RESONANCE_BREADTH.MAX,
  8
);

// ---------------------------------------------------------
// Resonance lock rules (engine persistence)
// ---------------------------------------------------------

function createResonancePool({ links }) {
  const state = {
    links: new Map(
      links.map(link => [link.id, { ...link }])
    ),
    signal: null
  };

  const queries = [];

  return {
    queries,
    state,

    async query(sql, values = []) {
      queries.push({ sql, values });

      if (
        sql.includes("FROM vehicle_person_links") &&
        sql.includes("WHERE person_id")
      ) {
        return {
          rows: [...state.links.values()],
          rowCount: state.links.size
        };
      }

      if (
        sql.includes("UPDATE vehicle_person_links")
      ) {
        assert.ok(
          sql.includes("resonance_locked = FALSE"),
          "Link resonance updates must respect resonance_locked."
        );

        // The resonance update may never touch link
        // identity columns.
        assert.ok(
          !sql.includes("vehicle_brand =") &&
            !sql.includes("relation_type =") &&
            !sql.includes("link_confidence ="),
          "Resonance updates must not modify core link identity."
        );

        const link = state.links.get(values[0]);

        if (link && !link.resonance_locked) {
          link.evidence_horizon = values[1];
          link.iconic_association = values[2];
          link.legacy_association = values[3];
          link.recognition_weight = values[4];
          link.association_start_year = values[5];
          link.association_end_year = values[6];
          link.historical_resonance_score = values[7];
          link.historical_resonance_tier = values[8];
          link.resonance_evidence = JSON.parse(
            values[9]
          );
          link.resonance_version = values[10];

          return { rows: [], rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      }

      if (
        sql.includes("UPDATE person_traffic_signals")
      ) {
        state.signal = {
          person_id: values[0],
          historical_resonance_scores: JSON.parse(
            values[1]
          ),
          historical_resonance_tiers: JSON.parse(
            values[2]
          ),
          historical_resonance_score: values[3],
          historical_resonance_tier: values[4],
          primary_resonance_link_id: values[5],
          resonance_version: values[6],
          resonance_evidence: JSON.parse(values[7])
        };

        return { rows: [], rowCount: 1 };
      }

      throw new Error(
        `Unexpected resonance query: ${sql.slice(0, 80)}`
      );
    }
  };
}

async function run() {
  // Happy path: both Shelby links scored, primary link
  // and per-scope scores persisted on the signal.
  const openPool = createResonancePool({
    links: [
      {
        id: 11,
        vehicle_brand: "Ford",
        vehicle_series: "Mustang",
        vehicle_model: "Mustang",
        relation_type: "BUILDER",
        locked: false,
        resonance_locked: false
      },
      {
        id: 12,
        vehicle_brand: "Shelby",
        vehicle_series: null,
        vehicle_model: null,
        relation_type: "FOUNDER",
        locked: false,
        resonance_locked: false
      }
    ]
  });

  const shelbyScopes = await persistPersonResonance(
    openPool,
    7,
    shelby
  );

  assert.equal(shelbyScopes.ONE_YEAR.score, null);
  assert.equal(shelbyScopes.TEN_YEARS.score, null);
  assert.equal(shelbyScopes.ALL_TIME.tier, "ICONIC");

  const fordLink = openPool.state.links.get(11);

  assert.equal(
    fordLink.historical_resonance_score,
    97
  );
  assert.equal(
    fordLink.historical_resonance_tier,
    "ICONIC"
  );
  assert.equal(fordLink.evidence_horizon, "ALL_TIME");
  assert.equal(fordLink.iconic_association, true);
  assert.equal(fordLink.legacy_association, true);
  assert.equal(
    fordLink.resonance_version,
    RESONANCE_VERSION
  );
  assert.equal(
    fordLink.resonance_evidence.resonance_label,
    shelbyMustang.resonanceLabel
  );

  const persisted = openPool.state.signal;

  assert.equal(persisted.person_id, 7);
  assert.equal(
    persisted.historical_resonance_scores.ONE_YEAR,
    undefined,
    "Null scopes are omitted, never stored as 0."
  );
  assert.ok(
    persisted.historical_resonance_scores.ALL_TIME >=
      80
  );
  assert.equal(
    persisted.historical_resonance_tiers.ALL_TIME,
    "ICONIC"
  );
  assert.equal(
    persisted.historical_resonance_score,
    persisted.historical_resonance_scores.ALL_TIME,
    "Top-level score is the ALL_TIME default."
  );
  assert.equal(
    persisted.primary_resonance_link_id,
    11,
    "Primary link must be the strongest ALL_TIME link."
  );
  assert.equal(
    persisted.resonance_version,
    RESONANCE_VERSION
  );

  const evidence = persisted.resonance_evidence;

  assert.equal(
    evidence.resonance_catalog_version,
    RESONANCE_CATALOG_VERSION
  );
  assert.ok(evidence.scopes.ALL_TIME);
  assert.equal(
    evidence.scopes.ALL_TIME.eligible_link_count,
    2
  );
  assert.equal(
    evidence.scopes.ALL_TIME.strong_link_count,
    2
  );
  assert.ok(
    evidence.scopes.ALL_TIME.score_breakdown
  );
  assert.equal(
    evidence.scopes.ONE_YEAR.score,
    null
  );

  // resonance_locked = TRUE: nothing is overwritten.
  const lockedPool = createResonancePool({
    links: [
      {
        id: 21,
        vehicle_brand: "Ford",
        vehicle_series: "Mustang",
        vehicle_model: "Mustang",
        relation_type: "BUILDER",
        locked: false,
        resonance_locked: true,
        evidence_horizon: "TEN_YEARS",
        historical_resonance_score: 55,
        historical_resonance_tier: "RECOGNIZABLE",
        resonance_version: "manual-override"
      }
    ]
  });

  await persistPersonResonance(
    lockedPool,
    8,
    shelby
  );

  const lockedLink = lockedPool.state.links.get(21);

  assert.equal(
    lockedLink.historical_resonance_score,
    55,
    "resonance_locked links keep their values."
  );
  assert.equal(
    lockedLink.evidence_horizon,
    "TEN_YEARS"
  );
  assert.equal(
    lockedLink.resonance_version,
    "manual-override"
  );

  // locked = TRUE (identity lock) with
  // resonance_locked = FALSE: resonance IS updated and
  // link identity is untouched.
  const identityLockedPool = createResonancePool({
    links: [
      {
        id: 31,
        vehicle_brand: "Ford",
        vehicle_series: "Mustang",
        vehicle_model: "Mustang",
        relation_type: "BUILDER",
        locked: true,
        resonance_locked: false
      }
    ]
  });

  await persistPersonResonance(
    identityLockedPool,
    9,
    shelby
  );

  const identityLocked =
    identityLockedPool.state.links.get(31);

  assert.equal(
    identityLocked.historical_resonance_score,
    97,
    "Identity-locked links still receive resonance."
  );
  assert.equal(identityLocked.vehicle_brand, "Ford");
  assert.equal(
    identityLocked.relation_type,
    "BUILDER"
  );

  // -------------------------------------------------------
  // API: relationship scope + resonance tier + sorting
  // -------------------------------------------------------

  // Defaults preserved and extended.
  const defaults = parsePersonRadarQuery(
    new URLSearchParams()
  );

  assert.equal(defaults.value.windowHours, 168);
  assert.equal(defaults.value.sort, "traffic_score");
  assert.equal(
    defaults.value.relationshipScope,
    "ALL_TIME"
  );
  assert.equal(
    defaults.value.historicalResonanceTier,
    "ALL"
  );

  // Scope + tier parsing (case-insensitive).
  const parsed = parsePersonRadarQuery(
    new URLSearchParams({
      relationship_scope: "one_year",
      historical_resonance_tier: "iconic",
      sort: "historical_resonance"
    })
  );

  assert.equal(
    parsed.value.relationshipScope,
    "ONE_YEAR"
  );
  assert.equal(
    parsed.value.historicalResonanceTier,
    "ICONIC"
  );
  assert.equal(
    parsed.value.sort,
    "historical_resonance"
  );

  // Allowlist validation.
  for (const [key, value] of [
    ["relationship_scope", "FIVE_YEARS"],
    ["relationship_scope", "'; DROP TABLE"],
    ["historical_resonance_tier", "LEGENDARY"],
    ["historical_resonance_tier", "1=1"]
  ]) {
    const invalid = parsePersonRadarQuery(
      new URLSearchParams({ [key]: value })
    );

    assert.equal(
      invalid.error?.statusCode,
      400,
      `${key}=${value} must be rejected.`
    );
  }

  function createCapturingPool(rows = []) {
    const queries = [];

    return {
      queries,

      async query(sql, values) {
        queries.push({ sql, values });

        if (sql.includes("COUNT(*) OVER()")) {
          return { rows, rowCount: rows.length };
        }

        return { rows: [], rowCount: 0 };
      }
    };
  }

  // Default list: selected scope is ALL_TIME; response
  // fields include the resonance layer.
  const defaultPool = createCapturingPool([
    {
      id: "1",
      total_count: "1",
      historical_resonance_score: "97.00",
      historical_resonance_tier: "ICONIC"
    }
  ]);

  const defaultResponse = await listPersonRadar(
    defaultPool,
    new URLSearchParams()
  );

  assert.equal(defaultResponse.statusCode, 200);
  assert.equal(
    defaultResponse.payload.filters
      .relationship_scope,
    "ALL_TIME"
  );
  assert.equal(
    defaultResponse.payload.filters
      .historical_resonance_tier,
    "ALL"
  );
  assert.equal(
    defaultResponse.payload.data[0]
      .relationship_scope,
    "ALL_TIME",
    "Every record carries the selected scope."
  );

  const defaultSql = defaultPool.queries[0].sql;

  for (const column of [
    "historical_resonance_scores",
    "historical_resonance_tiers",
    "primary_resonance_link_id",
    "resonance_version",
    "resonance_evidence",
    "traffic_observed_since",
    "historical_traffic_claimed"
  ]) {
    assert.ok(
      defaultSql.includes(column),
      `List query must select ${column}.`
    );
  }

  assert.ok(
    defaultSql.includes(
      "->> 'ALL_TIME')::numeric"
    ),
    "Selected scope score comes from the scope map."
  );

  assert.ok(
    defaultSql.includes(
      "FALSE AS historical_traffic_claimed"
    ),
    "Historical traffic is never claimed."
  );

  assert.ok(
    !defaultSql.includes("'2026-"),
    "traffic_observed_since must not be hardcoded."
  );

  // historical_resonance sort obeys the selected scope
  // with NULLS LAST and the documented tie-breakers.
  const sortPool = createCapturingPool();

  await listPersonRadar(
    sortPool,
    new URLSearchParams({
      sort: "historical_resonance",
      relationship_scope: "ONE_YEAR"
    })
  );

  const sortSql = sortPool.queries[0].sql;
  const orderBy = sortSql.split("ORDER BY")[1];

  assert.ok(
    orderBy
      .replace(/\s+/g, " ")
      .includes(
        "(pts.historical_resonance_scores ->> 'ONE_YEAR')::numeric DESC NULLS LAST"
      ),
    "Sort must use the selected scope score NULLS LAST."
  );
  assert.ok(
    orderBy.includes("pts.traffic_score DESC") &&
      orderBy.includes(
        "pts.vehicle_views_total DESC"
      ) &&
      orderBy.includes("pts.id DESC")
  );

  // Resonance tier filter binds the tier value against
  // the SELECTED scope tier map.
  const tierPool = createCapturingPool();

  await listPersonRadar(
    tierPool,
    new URLSearchParams({
      historical_resonance_tier: "ICONIC",
      relationship_scope: "TEN_YEARS"
    })
  );

  const tierQuery = tierPool.queries[0];

  assert.ok(
    tierQuery.values.includes("ICONIC"),
    "Tier filter must be a bind value."
  );
  assert.ok(
    tierQuery.sql.includes(
      "historical_resonance_tiers ->> 'TEN_YEARS'"
    ),
    "Tier filter must target the selected scope."
  );
  assert.ok(
    !tierQuery.sql.includes("'ICONIC'"),
    "Tier value never appears in the SQL text."
  );

  // Summary aggregates by the selected scope in the
  // database — never on the visible page.
  const summarySql = tierPool.queries[1].sql;

  for (const aggregate of [
    "iconic",
    "established",
    "recognizable",
    "niche",
    "unscored",
    "average_historical_resonance",
    "selected_resonance_score",
    "selected_resonance_tier"
  ]) {
    assert.ok(
      summarySql.includes(aggregate),
      `Summary must aggregate ${aggregate}.`
    );
  }

  assert.ok(
    !summarySql.includes("LIMIT $"),
    "Summary must aggregate without pagination."
  );

  console.log(
    "TASK 3.3E.1 PERSON RESONANCE TESTS PASSED"
  );
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

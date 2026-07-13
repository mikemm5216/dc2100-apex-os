const assert = require("node:assert/strict");

const {
  FUSION_VERSION,
  FUSION_WEIGHTS,
  MISSING_SIGNALS,
  PERSON_LINK_TIER_CAPS,
  calculateFusionScore,
  calculateVehicleTrafficScore,
  countryNewsTrafficProxyScore,
  deriveVehiclePersonLinkTier,
  personCurrentTrafficScore,
  personHistoricalResonanceScore,
  transformationPotentialScore,
  vehiclePersonLinkConfidenceScore
} = require("../lib/fusion/scoring");

const {
  FUSION_RUN_LIMITS,
  buildCandidate,
  normalizeFusionRunPayload
} = require("../lib/fusion/engine");

// ---------------------------------------------------------
// Weights: vehicle traffic strictly outweighs every other
// individual component, and weights sum to 100.
// ---------------------------------------------------------

assert.equal(
  Object.values(FUSION_WEIGHTS).reduce(
    (sum, value) => sum + value,
    0
  ),
  100
);

for (const [key, weight] of Object.entries(
  FUSION_WEIGHTS
)) {
  if (key === "VEHICLE_TRAFFIC") continue;
  assert.ok(
    FUSION_WEIGHTS.VEHICLE_TRAFFIC > weight,
    `VEHICLE_TRAFFIC must outweigh ${key}.`
  );
}

// ---------------------------------------------------------
// Vehicle traffic: log10/7-scaled, matches the same cap
// already validated in lib/person/metrics.js
// (vehicleViewsScore), just rescaled to 0-100.
// ---------------------------------------------------------

assert.equal(
  calculateVehicleTrafficScore({ vehicleViewsTotal: 0 }),
  0
);

assert.equal(
  calculateVehicleTrafficScore({
    vehicleViewsTotal: 10000000
  }),
  100
);

assert.ok(
  calculateVehicleTrafficScore({
    vehicleViewsTotal: 1000
  }) <
    calculateVehicleTrafficScore({
      vehicleViewsTotal: 100000
    }),
  "More views must never score lower."
);

assert.equal(
  calculateVehicleTrafficScore({
    vehicleViewsTotal: -500
  }),
  0,
  "Negative views must not produce a negative score."
);

// ---------------------------------------------------------
// Country News Traffic Proxy: reused as-is (already 0-100),
// never re-derived.
// ---------------------------------------------------------

assert.equal(
  countryNewsTrafficProxyScore({ traffic_score: 62.5 }),
  62.5
);

assert.equal(
  countryNewsTrafficProxyScore({ traffic_score: -5 }),
  0
);

// ---------------------------------------------------------
// Person Current Traffic and Historical Resonance stay
// independent. Historical Resonance is read from the LINK
// row, never from a person-level rollup, and never copied
// into Current Traffic.
// ---------------------------------------------------------

assert.equal(
  personCurrentTrafficScore(null),
  null,
  "No person traffic signal => null, not zero."
);

assert.equal(
  personCurrentTrafficScore({ traffic_score: 40 }),
  40
);

assert.equal(
  personHistoricalResonanceScore(null),
  null
);

assert.equal(
  personHistoricalResonanceScore({
    historical_resonance_score: null
  }),
  null,
  "Resonance not yet computed on the link => null, not zero."
);

assert.equal(
  personHistoricalResonanceScore({
    historical_resonance_score: 88
  }),
  88
);

// Changing one must never change the other.
const currentOnly = personCurrentTrafficScore({
  traffic_score: 70
});
const historicalOnly = personHistoricalResonanceScore({
  historical_resonance_score: 10
});

assert.equal(currentOnly, 70);
assert.equal(historicalOnly, 10);

// ---------------------------------------------------------
// Vehicle-Person Link Confidence: tier caps enforce a
// strict ceiling ordering EXACT_VEHICLE > SAME_SERIES >
// SAME_BRAND even at maximum raw confidence.
// ---------------------------------------------------------

const maxConfidenceLink = { link_confidence: 1 };

const exactCeiling = vehiclePersonLinkConfidenceScore(
  maxConfidenceLink,
  "EXACT_VEHICLE"
);
const seriesCeiling = vehiclePersonLinkConfidenceScore(
  maxConfidenceLink,
  "SAME_SERIES"
);
const brandCeiling = vehiclePersonLinkConfidenceScore(
  maxConfidenceLink,
  "SAME_BRAND"
);

assert.ok(exactCeiling > seriesCeiling);
assert.ok(seriesCeiling > brandCeiling);
assert.equal(
  exactCeiling,
  100 * PERSON_LINK_TIER_CAPS.EXACT_VEHICLE
);

// A SAME_BRAND link can NEVER reach an EXACT_VEHICLE
// link's ceiling, even at a much lower raw confidence for
// the exact link.
const weakExact = vehiclePersonLinkConfidenceScore(
  { link_confidence: 0.4 },
  "EXACT_VEHICLE"
);

assert.ok(
  weakExact >= brandCeiling ||
    weakExact >
      vehiclePersonLinkConfidenceScore(
        { link_confidence: 0.65 },
        "SAME_BRAND"
      ),
  "Realistic resolver-tier confidences must keep EXACT_VEHICLE ahead of SAME_BRAND."
);

assert.equal(
  vehiclePersonLinkConfidenceScore(null, "EXACT_VEHICLE"),
  null
);

// ---------------------------------------------------------
// Transformation Potential reuses existing computed
// fields — never a new formula. With no person, only the
// country's value is used.
// ---------------------------------------------------------

assert.equal(
  transformationPotentialScore({
    countryNewsSignal: { transformation_potential: 30 },
    personTrafficSignal: null
  }),
  30
);

assert.equal(
  transformationPotentialScore({
    countryNewsSignal: { transformation_potential: 30 },
    personTrafficSignal: {
      transformation_potential: 80
    }
  }),
  80,
  "The stronger of the two available angles is used."
);

// ---------------------------------------------------------
// Fusion score: no renormalization. A NO_PERSON_SIGNAL
// candidate's ceiling is strictly below a candidate with a
// full person contribution, and the person weight share is
// simply forfeited, not redistributed.
// ---------------------------------------------------------

const maxedNoPerson = calculateFusionScore({
  vehicleTrafficScore: 100,
  countryNewsTrafficProxyScore: 100,
  transformationPotentialScore: 100,
  personCurrentTrafficScore: null,
  personHistoricalResonanceScore: null,
  vehiclePersonLinkConfidenceScore: null
});

const noPersonCeiling =
  FUSION_WEIGHTS.VEHICLE_TRAFFIC +
  FUSION_WEIGHTS.COUNTRY_NEWS +
  FUSION_WEIGHTS.TRANSFORMATION_POTENTIAL;

assert.equal(maxedNoPerson, noPersonCeiling);

const weakVehicleWithPerson = calculateFusionScore({
  vehicleTrafficScore: 60,
  countryNewsTrafficProxyScore: 60,
  transformationPotentialScore: 60,
  personCurrentTrafficScore: 100,
  personHistoricalResonanceScore: 100,
  vehiclePersonLinkConfidenceScore: 100
});

assert.ok(
  weakVehicleWithPerson > maxedNoPerson,
  "A candidate with strong person evidence can outrank a maxed-out NO_PERSON_SIGNAL candidate on its own merit — but the NO_PERSON_SIGNAL candidate's own ceiling must never be inflated by renormalization."
);

assert.ok(
  maxedNoPerson < 100,
  "NO_PERSON_SIGNAL candidates can never reach the full 0-100 range."
);

// A weaker-but-otherwise-similar candidate with full
// person data must outrank an identical NO_PERSON_SIGNAL
// candidate.
const base = {
  vehicleTrafficScore: 50,
  countryNewsTrafficProxyScore: 50,
  transformationPotentialScore: 50
};

const withoutPerson = calculateFusionScore({
  ...base,
  personCurrentTrafficScore: null,
  personHistoricalResonanceScore: null,
  vehiclePersonLinkConfidenceScore: null
});

const withWeakPerson = calculateFusionScore({
  ...base,
  personCurrentTrafficScore: 20,
  personHistoricalResonanceScore: 20,
  vehiclePersonLinkConfidenceScore: 20
});

assert.ok(withWeakPerson > withoutPerson);

// ---------------------------------------------------------
// Person link tier derivation reuses the actual persisted
// vehicle_person_links columns against the candidate
// vehicle's own resolved identity.
// ---------------------------------------------------------

const vehicle = {
  vehicle_id: "500",
  vehicle_brand: "Toyota",
  vehicle_series: "Supra",
  vehicle_model: "Supra MK5"
};

assert.equal(
  deriveVehiclePersonLinkTier(
    { vehicle_id: "500" },
    vehicle
  ),
  "EXACT_VEHICLE"
);

assert.equal(
  deriveVehiclePersonLinkTier(
    {
      vehicle_id: null,
      vehicle_brand: "Toyota",
      vehicle_model: "Supra MK5"
    },
    vehicle
  ),
  "EXACT_VEHICLE",
  "Model match without a resolved vehicle_id is still exact."
);

assert.equal(
  deriveVehiclePersonLinkTier(
    {
      vehicle_id: "999",
      vehicle_brand: "Toyota",
      vehicle_series: "Supra",
      vehicle_model: "Supra MK4"
    },
    vehicle
  ),
  "SAME_SERIES",
  "Same brand + series, different model."
);

assert.equal(
  deriveVehiclePersonLinkTier(
    {
      vehicle_id: null,
      vehicle_brand: "Toyota",
      vehicle_series: "Corolla",
      vehicle_model: "Corolla GR"
    },
    vehicle
  ),
  "SAME_BRAND",
  "Same brand only, different series."
);

assert.equal(
  deriveVehiclePersonLinkTier(
    { vehicle_brand: "Ford" },
    vehicle
  ),
  null,
  "Unrelated brand must be ineligible, not a weak match."
);

assert.equal(
  deriveVehiclePersonLinkTier(null, vehicle),
  null
);

// ---------------------------------------------------------
// buildCandidate: end-to-end evidence assembly, missing
// signals, and NO_COUNTRY_NEWS_SIGNAL / NO_PERSON_SIGNAL /
// NO_HISTORICAL_RESONANCE marking.
// ---------------------------------------------------------

const testVehicle = {
  vehicle_id: "1",
  vehicle_code: "GR86",
  qualified_vehicle_signal_count: 4,
  vehicle_views_total: "2500000",
  vehicle_views_max: "1200000",
  representative_viral_tier: "PROVEN"
};

const testCountryNews = {
  id: "9",
  category: "ENERGY",
  conflict_archetypes: ["RESOURCE_SCARCITY"],
  traffic_score: 75,
  transformation_potential: 40
};

const noPersonCandidate = buildCandidate({
  vehicle: testVehicle,
  countryNewsSignal: testCountryNews,
  personLink: null
});

assert.deepEqual(noPersonCandidate.missingSignals, [
  MISSING_SIGNALS.NO_PERSON_SIGNAL
]);
assert.equal(noPersonCandidate.isComplete, false);
assert.equal(noPersonCandidate.personId, null);
assert.equal(
  noPersonCandidate.personCurrentTrafficScore,
  null
);
assert.equal(
  noPersonCandidate.personHistoricalResonanceScore,
  null
);
assert.equal(
  noPersonCandidate.vehiclePersonLinkConfidenceScore,
  null
);
assert.equal(
  noPersonCandidate.fusionEvidence.person_current,
  null
);
assert.equal(
  noPersonCandidate.fusionEvidence.historical_relationship,
  null
);

const personLinkNoResonance = {
  link_id: "77",
  person_id: "42",
  tier: "SAME_BRAND",
  link_confidence: 0.65,
  evidence_horizon: null,
  historical_resonance_score: null,
  historical_resonance_tier: null,
  person_traffic_score: 55,
  person_transformation_potential: 20
};

const partialCandidate = buildCandidate({
  vehicle: testVehicle,
  countryNewsSignal: testCountryNews,
  personLink: personLinkNoResonance
});

assert.deepEqual(partialCandidate.missingSignals, [
  MISSING_SIGNALS.NO_HISTORICAL_RESONANCE
]);
assert.equal(partialCandidate.isComplete, false);
assert.equal(
  partialCandidate.personCurrentTrafficScore,
  55
);
assert.equal(
  partialCandidate.personHistoricalResonanceScore,
  null
);

const fullPersonLink = {
  link_id: "78",
  person_id: "43",
  tier: "EXACT_VEHICLE",
  link_confidence: 0.85,
  evidence_horizon: "ALL_TIME",
  historical_resonance_score: 90,
  historical_resonance_tier: "ICONIC",
  person_traffic_score: 60,
  person_transformation_potential: 70
};

const completeCandidate = buildCandidate({
  vehicle: testVehicle,
  countryNewsSignal: testCountryNews,
  personLink: fullPersonLink
});

assert.deepEqual(completeCandidate.missingSignals, []);
assert.equal(completeCandidate.isComplete, true);
assert.equal(
  completeCandidate.personHistoricalResonanceScore,
  90
);
assert.equal(
  completeCandidate.transformationPotentialScore,
  70,
  "Person's stronger transformation potential wins."
);
assert.equal(
  completeCandidate.fusionEvidence.fusion_version,
  FUSION_VERSION
);

assert.ok(
  completeCandidate.fusionScore >
    noPersonCandidate.fusionScore,
  "Identical vehicle/news evidence: the complete candidate must outrank the NO_PERSON_SIGNAL one."
);

// ---------------------------------------------------------
// Run payload normalization: allowlisted windows, clamped
// integers, safe defaults.
// ---------------------------------------------------------

const defaults = normalizeFusionRunPayload({});

assert.equal(
  defaults.maxVehicles,
  FUSION_RUN_LIMITS.MAX_VEHICLES.fallback
);
assert.equal(
  defaults.vehicleWindowDays,
  FUSION_RUN_LIMITS.VEHICLE_WINDOW_DAYS_FALLBACK
);
assert.equal(
  defaults.newsWindowHours,
  FUSION_RUN_LIMITS.NEWS_WINDOW_HOURS_FALLBACK
);
assert.equal(defaults.vehicleIds, null);

const clamped = normalizeFusionRunPayload({
  max_vehicles: 99999,
  vehicle_window_days: 999,
  news_window_hours: 999,
  max_news_per_vehicle: 0,
  vehicle_ids: ["12", "abc", "34"]
});

assert.equal(
  clamped.maxVehicles,
  FUSION_RUN_LIMITS.MAX_VEHICLES.max
);
assert.equal(
  clamped.vehicleWindowDays,
  FUSION_RUN_LIMITS.VEHICLE_WINDOW_DAYS_FALLBACK
);
assert.equal(
  clamped.maxNewsPerVehicle,
  FUSION_RUN_LIMITS.MAX_NEWS_PER_VEHICLE.min
);
assert.deepEqual(clamped.vehicleIds, ["12", "34"]);

console.log("TASK 3.3F FUSION CORE TESTS PASSED");

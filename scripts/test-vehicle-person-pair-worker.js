const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  evaluateJointVideo,
  rankPairs,
  selectBestPair,
  pairSpecificity,
  isFounderEligible,
  isFounderFallbackEligible,
  isCrossCountryPair
} = require("../lib/person/vehicle-person-pair-engine");
const {
  runPersonFictionalizationValidator
} = require("../lib/story/validators");
const {
  validateRunPayload
} = require("../lib/person/vehicle-person-pair-api");

function video(overrides = {}) {
  return {
    videoId: "v1",
    title: "Keiichi Tsuchiya drives Toyota GR86",
    tags: [], description: "", channelTitle: "irrelevant",
    duration: "PT55S", views: 1000,
    publishedAt: "2026-01-01T00:00:00Z",
    ...overrides
  };
}

const options = {
  personTerms: ["Keiichi Tsuchiya", "Drift King"],
  vehicleTerms: [
    { term: "GR86", specificity: "EXACT_MODEL" },
    { term: "GR", specificity: "SAME_SERIES" },
    { term: "Toyota", specificity: "SAME_BRAND" }
  ],
  format: "SHORTS"
};

// 1. Same video contains person + exact model.
assert.equal(evaluateJointVideo(video(), options).pairSpecificity, "EXACT_MODEL");
// 2. Separate person-only and vehicle-only videos cannot form a pair.
assert.equal(evaluateJointVideo(video({ title: "Keiichi Tsuchiya interview" }), options), null);
assert.equal(evaluateJointVideo(video({ title: "Toyota GR86 review" }), options), null);
// 3-4. Channel title is never accepted for either identity.
assert.equal(evaluateJointVideo(video({ title: "Toyota GR86", channelTitle: "Keiichi Tsuchiya" }), options), null);
assert.equal(evaluateJointVideo(video({ title: "Keiichi Tsuchiya", channelTitle: "Toyota GR86" }), options), null);
// 5-6. Specificity is exact > series > brand.
assert.equal(evaluateJointVideo(video({ title: "Keiichi Tsuchiya tests GR chassis" }), options).pairSpecificity, "SAME_SERIES");
assert.equal(evaluateJointVideo(video({ title: "Keiichi Tsuchiya visits Toyota" }), options).pairSpecificity, "SAME_BRAND");
// 7-8. Actual joint views dominate; no vehicle/person traffic sum is involved.
const base = { anchor: { views: 500, vehicle_id: 1 }, link: { person_id: 2 }, video: { publishedAt: "2026-01-01" } };
const highViews = { ...base, views: 2000, pairSpecificity: "SAME_BRAND" };
const lowViews = { ...base, views: 1000, pairSpecificity: "EXACT_MODEL" };
assert.equal(selectBestPair([lowViews, highViews]), highViews);
assert.ok(rankPairs(highViews, lowViews) < 0);
// 9. Exactly one selected person per vehicle.
assert.equal([selectBestPair([lowViews, highViews])].length, 1);
// 10. Anchor SQL is distinct by resolved vehicle.
const pairSource = fs.readFileSync(require.resolve("../lib/person/vehicle-person-pair-engine"), "utf8");
assert.match(pairSource, /PARTITION BY sig\.resolved_vehicle_id/);
// 11. Cross-country is evidence, not rejection.
assert.equal(isCrossCountryPair(10, 20), true);
assert.equal(isCrossCountryPair(10, 10), false);
// 12-14. Founder current eligibility requires ALIVE.
assert.equal(isFounderEligible({ role_category: "FOUNDER_EXECUTIVE", life_status: "ALIVE" }), true);
assert.equal(isFounderEligible({ role_category: "FOUNDER_EXECUTIVE", life_status: "DECEASED" }), false);
assert.equal(isFounderEligible({ role_category: "FOUNDER_EXECUTIVE", life_status: "UNKNOWN" }), false);
assert.equal(isFounderEligible({ role_category: "DRIVER_RACER", life_status: "DECEASED" }), false);
assert.equal(isFounderEligible({ role_category: "HISTORICAL_FIGURE", life_status: "UNKNOWN" }), false);
// 15-18. Fallback is Tesla/Xiaomi only, with all four support facts.
const founder = { role_category: "FOUNDER_EXECUTIVE", life_status: "ALIVE", link_id: 7 };
const fallback = brand => isFounderFallbackEligible({
  anchor: { vehicle_brand: brand, signal_id: 9 }, person: founder,
  directSupport: { id: 11 }, provenPairs: []
});
assert.equal(fallback("Tesla"), true);
assert.equal(fallback("Xiaomi"), true);
assert.equal(fallback("Toyota"), false);
assert.equal(isFounderFallbackEligible({ anchor: { vehicle_brand: "Tesla", signal_id: 9 }, person: founder, directSupport: null, provenPairs: [] }), false);
// 19. A proven pair always suppresses founder fallback.
assert.equal(isFounderFallbackEligible({ anchor: { vehicle_brand: "Tesla", signal_id: 9 }, person: founder, directSupport: { id: 11 }, provenPairs: [highViews] }), false);
// 20. Missing person country is excluded in the discovery SQL.
assert.match(pairSource, /p\.country_id IS NOT NULL/);
assert.match(pairSource, /p\.life_status <> 'DECEASED'/);
// Additional validator regression: duration applies before ranking.
assert.equal(evaluateJointVideo(video({ duration: "PT4M" }), options), null);
// Tags and description are valid evidence fields.
assert.equal(evaluateJointVideo(video({ title: "clip", tags: ["Drift King", "GR86"] }), options).personMatchField, "TAGS");
assert.equal(evaluateJointVideo(video({ title: "clip", description: "Drift King in a GR86" }), options).vehicleMatchField, "DESCRIPTION");
// Catalog specificity is deterministic.
assert.equal(pairSpecificity({ vehicle_model: "GR86" }, { vehicle_name: "Toyota GR86" }), "EXACT_MODEL");

// 27-28. Canonical names and aliases are both prohibited in Story identities.
const context = { personCanonicalName: "Justin Shearer", personAliases: ["Big Chief"] };
const canonicalIssues = runPersonFictionalizationValidator({ character_concept: { canon_driver_name: "Justin Nova" } }, context);
const aliasIssues = runPersonFictionalizationValidator({ character_concept: { canon_driver_name: "Big Chief" } }, context);
assert.ok(canonicalIssues.length > 0);
assert.ok(aliasIssues.length > 0);
assert.ok(runPersonFictionalizationValidator({ character_concept: { canon_driver_name: "Nova Vale" }, hook: "Big Chief returns" }, context).length > 0);
// 29. Snapshot contract explicitly requires fictionalization.
const storySource = fs.readFileSync(require.resolve("../lib/story/engine"), "utf8");
assert.match(storySource, /fictional_character_required:\s*true/);
assert.match(storySource, /source_person_evidence:\s*true/);

const migrationSource = fs.readFileSync(
  require.resolve("../db/migrations/018_vehicle_person_pair_country_v2.sql"),
  "utf8"
);
assert.match(migrationSource, /life_status IN \('ALIVE','DECEASED','UNKNOWN'\)/);
assert.match(migrationSource, /CREATE TABLE vehicle_person_pair_runs/);
assert.match(migrationSource, /CREATE TABLE vehicle_person_pair_signals/);
assert.equal(validateRunPayload({ history_scope: "ALL_TIME", format: "SHORTS", max_vehicles: 10 }), null);
assert.equal(validateRunPayload({ history_scope: "RECENT" }).statusCode, 400);

console.log("VEHICLE-PERSON PAIR WORKER TESTS PASSED (29 policy cases)");

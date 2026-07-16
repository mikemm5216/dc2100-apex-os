const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  evaluateJointVideo,
  rankPairs,
  selectBestPair,
  pairSpecificity,
  isFounderEligible,
  isFounderFallbackEligible,
  isCrossCountryPair,
  normalizeVehicleBrand,
  dedupeAnchorsByBrand,
  compareUsablePairs,
  selectBestPairPerBrand,
  selectDistinctPairOutcome,
  selectTopDistinctBrandAndPersonPairs,
  scanBrandAnchorBatches,
  normalizePairRunPayload,
  PairQuotaBlockedError,
  buildPairSearchQueries,
  executePairSearchQuery,
  searchPair
} = require("../lib/person/vehicle-person-pair-engine");
const {
  runPersonFictionalizationValidator
} = require("../lib/story/validators");
const {
  validateRunPayload,
  createVehiclePersonPairRun
} = require("../lib/person/vehicle-person-pair-api");
const {
  F1_DRIVER_CATALOG
} = require("../lib/person/person-catalog");
const {
  persistVerifiedF1CatalogLinks
} = require("../lib/person/engine");

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
const f1MigrationSource = fs.readFileSync(
  require.resolve("../db/migrations/019_f1_person_countries.sql"),
  "utf8"
);
assert.match(f1MigrationSource, /\('MC', 'Monaco', TRUE\)/);
assert.match(f1MigrationSource, /\('ES', 'Spain', TRUE\)/);
assert.match(f1MigrationSource, /\('BR', 'Brazil', TRUE\)/);
assert.match(f1MigrationSource, /superseded_by_run_id/);
const quotaMigrationSource = fs.readFileSync(
  require.resolve("../db/migrations/020_pair_search_quota_resume.sql"),
  "utf8"
);
assert.match(quotaMigrationSource, /'PARTIAL'/);
assert.match(quotaMigrationSource, /CREATE TABLE IF NOT EXISTS youtube_search_query_cache/);
assert.match(quotaMigrationSource, /UNIQUE\(normalized_query, format, provider\)/);
assert.match(quotaMigrationSource, /UPDATE fusion_runs previous/);
assert.equal(validateRunPayload({ history_scope: "ALL_TIME", format: "SHORTS", max_vehicles: 10 }), null);
assert.equal(validateRunPayload({ history_scope: "RECENT" }).statusCode, 400);

function anchor(vehicleBrand, vehicleId, views, publishedAt = "2026-01-01", signalId = vehicleId) {
  return {
    vehicle_brand: vehicleBrand,
    normalized_vehicle_brand: normalizeVehicleBrand(vehicleBrand),
    vehicle_id: vehicleId,
    signal_id: signalId,
    vehicle_code: `${vehicleBrand}-${vehicleId}`,
    views,
    published_at: publishedAt
  };
}

function usablePair(vehicleBrand, vehicleId, jointViews, overrides = {}) {
  return {
    pairStatus: "PROVEN_PAIR",
    pairSpecificity: "EXACT_MODEL",
    views: jointViews,
    anchor: anchor(vehicleBrand, vehicleId, overrides.anchorViews || 1000),
    video: { publishedAt: overrides.publishedAt || "2026-01-01" },
    link: { person_id: overrides.personId || vehicleId },
    ...overrides
  };
}

async function runDistinctBrandTests() {
  // 1. Porsche representative is chosen by anchor traffic before pair search.
  const porsche = dedupeAnchorsByBrand([
    anchor("Porsche", 17, 29_731_320),
    anchor("Porsche", 16, 8_105_349)
  ]);
  assert.equal(porsche.length, 1);
  assert.equal(porsche[0].vehicle_id, 17);

  // 2. BMW M2/M3/M4 occupy one brand slot.
  const bmw = dedupeAnchorsByBrand([
    anchor("BMW", 2, 14_000_000),
    anchor("BMW", 3, 7_000_000),
    anchor("BMW", 4, 8_000_000)
  ]);
  assert.equal(bmw.length, 1);
  assert.equal(bmw[0].vehicle_id, 2);

  // 3. Ten vehicles of the same brand produce one distinct-brand anchor.
  assert.equal(dedupeAnchorsByBrand(
    Array.from({ length: 10 }, (_, index) => anchor("Toyota", index + 1, 100 - index))
  ).length, 1);

  // 4. Case and repeated whitespace normalize deterministically.
  assert.equal(normalizeVehicleBrand("  PORSCHE   "), "porsche");
  assert.equal(dedupeAnchorsByBrand([
    anchor("Porsche", 1, 10),
    anchor(" porsche  ", 2, 9),
    anchor("PORSCHE", 3, 8)
  ]).length, 1);

  // 5. A low-yield first batch does not stop later-brand scanning.
  const twentyBrands = Array.from({ length: 20 }, (_, index) =>
    anchor(`Brand ${index + 1}`, index + 1, 1000 - index)
  );
  const continued = await scanBrandAnchorBatches({
    anchors: twentyBrands,
    batchSize: 10,
    targetPairs: 3,
    scanAnchor: async item => [1, 2, 11].includes(item.vehicle_id)
      ? usablePair(item.vehicle_brand, item.vehicle_id, 1000 + item.vehicle_id)
      : null
  });
  assert.equal(continued.batchesCompleted, 2);
  assert.equal(continued.brandsScanned, 20);

  // 6-7. Finish the second 25-brand batch, collect 13, select only Top 10.
  const fiftyBrands = Array.from({ length: 50 }, (_, index) =>
    anchor(`Maker ${index + 1}`, index + 1, 5000 - index)
  );
  const thirteen = await scanBrandAnchorBatches({
    anchors: fiftyBrands,
    batchSize: 25,
    targetPairs: 10,
    scanAnchor: async item => (
      item.vehicle_id <= 7 || (item.vehicle_id >= 26 && item.vehicle_id <= 31)
    ) ? usablePair(item.vehicle_brand, item.vehicle_id, item.vehicle_id * 1000) : null
  });
  assert.equal(thirteen.batchesCompleted, 2);
  assert.equal(thirteen.usablePairs.length, 13);
  const selectedTen = selectTopDistinctBrandAndPersonPairs(
    thirteen.usablePairs,
    10
  );
  assert.equal(selectedTen.length, 10);
  // 8. Selected pairs are ten distinct normalized brands.
  assert.equal(new Set(selectedTen.map(item => item.anchor.normalized_vehicle_brand)).size, 10);

  // 9. Multiple usable pairs inside one brand retain only the highest-ranked pair.
  const brandBest = selectBestPairPerBrand([
    usablePair("Audi", 1, 1000),
    usablePair("Audi", 1, 2000, { personId: 2 })
  ]);
  assert.equal(brandBest.length, 1);
  assert.equal(brandBest[0].views, 2000);

  // 10. Global ranking follows joint views, not discovery order.
  const ranked = selectTopDistinctBrandAndPersonPairs([
    usablePair("Alpha", 1, 10),
    usablePair("Beta", 2, 1000),
    usablePair("Gamma", 3, 100)
  ], 3);
  assert.deepEqual(ranked.map(item => item.views), [1000, 100, 10]);

  // 11. Any proven pair outranks a founder fallback.
  const fallbackPair = usablePair("Tesla", 5, null, {
    pairStatus: "CURATED_FOUNDER_FALLBACK",
    pairSpecificity: "EXACT_MODEL"
  });
  const provenPair = usablePair("Toyota", 6, 1);
  assert.ok(compareUsablePairs(provenPair, fallbackPair, { global: true }) < 0);

  // 12. Insufficient usable brands never duplicate a brand to fill target.
  const insufficient = selectTopDistinctBrandAndPersonPairs([
    usablePair("Ford", 1, 100),
    usablePair("Ford", 2, 90),
    usablePair("Honda", 3, 80)
  ], 10);
  assert.equal(insufficient.length, 2);
  assert.equal(new Set(insufficient.map(item => item.anchor.normalized_vehicle_brand)).size, 2);

  // Payload defaults, explicit fields, and max_vehicles compatibility alias.
  assert.deepEqual(normalizePairRunPayload({ max_vehicles: 7 }), {
    historyScope: "ALL_TIME",
    format: "SHORTS",
    targetPairs: 7,
    maxBrandAnchors: 50,
    brandBatchSize: 25,
    maxPeoplePerVehicle: 10,
    maxSearchQueries: 90,
    resumeRunId: null,
    stationRunKey: null
  });
  assert.equal(validateRunPayload({ target_pairs: 10, max_brand_anchors: 9 }).statusCode, 400);
  assert.equal(validateRunPayload({ brand_batch_size: 4 }).statusCode, 400);
  let queuedPayload = null;
  const queued = await createVehiclePersonPairRun({
    async query(sql, values = []) {
      if (sql.includes("status IN ('QUEUED','RUNNING')")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO vehicle_person_pair_runs")) {
        queuedPayload = JSON.parse(values[0]);
        return { rows: [{ id: 1, status: "QUEUED", request_payload: queuedPayload }], rowCount: 1 };
      }
      throw new Error(`Unexpected Pair API query: ${sql.slice(0, 80)}`);
    }
  }, { max_vehicles: 7 });
  assert.equal(queued.statusCode, 202);
  assert.deepEqual(queuedPayload, {
    history_scope: "ALL_TIME",
    format: "SHORTS",
    target_pairs: 7,
    max_brand_anchors: 50,
    brand_batch_size: 25,
    max_people_per_vehicle: 10,
    max_search_queries: 90,
    resume_run_id: null,
    station_run_key: null
  });
  let resumedPayload = null;
  const resumed = await createVehiclePersonPairRun({
    async query(sql, values = []) {
      if (sql.includes("status IN ('QUEUED','RUNNING')")) {
        return { rows: [], rowCount: 0 };
      }
      if (sql.includes("SELECT id,status,request_payload,summary")) {
        return {
          rows: [{ id: "3", status: "FAILED", summary: { target_reached: false } }],
          rowCount: 1
        };
      }
      if (sql.includes("INSERT INTO vehicle_person_pair_runs")) {
        resumedPayload = JSON.parse(values[0]);
        assert.equal(values[1], "3");
        return { rows: [{ id: 4, status: "QUEUED", request_payload: resumedPayload }], rowCount: 1 };
      }
      throw new Error(`Unexpected resume API query: ${sql.slice(0, 80)}`);
    }
  }, { resume_run_id: "3", max_search_queries: 90 });
  assert.equal(resumed.statusCode, 202);
  assert.equal(resumedPayload.resume_run_id, "3");

  // 13-15. Fusion reads selected pairs, deduplicates brands, and keeps person-country binding.
  const fusionSource = fs.readFileSync(require.resolve("../lib/fusion/engine"), "utf8");
  assert.match(fusionSource, /ps\.selected=TRUE/);
  assert.match(fusionSource, /PARTITION BY LOWER\(REGEXP_REPLACE/);
  assert.match(fusionSource, /PARTITION BY ps\.person_id/);
  assert.match(fusionSource, /PARTITION BY ps\.vehicle_id/);
  assert.match(fusionSource, /countryId:\s*pair\.person_country_id/);
  assert.match(fusionSource, /countryBinding:\s*selectedPair \? 'PERSON_COUNTRY'/);

  // Unique-person 1-4. Chris Harris ranks with Ferrari; Porsche falls
  // through to its next eligible person instead of duplicating Chris.
  const ferrariChris = usablePair("Ferrari", 32, 3_968_940, {
    personId: 20
  });
  const porscheChris = usablePair("Porsche", 17, 839_043, {
    personId: 20
  });
  const porscheAlternative = usablePair("Porsche", 17, 700_000, {
    personId: 21
  });
  const resolvedConflict = selectDistinctPairOutcome([
    porscheChris,
    porscheAlternative,
    ferrariChris
  ], 10);
  assert.deepEqual(
    resolvedConflict.selected.map(item => item.link.person_id),
    [20, 21]
  );
  assert.deepEqual(
    resolvedConflict.selected.map(item => item.anchor.normalized_vehicle_brand),
    ["ferrari", "porsche"]
  );
  assert.equal(resolvedConflict.personConflictsResolved, 1);
  const noPorscheAlternative = selectTopDistinctBrandAndPersonPairs([
    ferrariChris,
    porscheChris
  ], 10);
  assert.equal(noPorscheAlternative.length, 1);
  assert.equal(noPorscheAlternative[0], ferrariChris);

  // Unique-person 5-6. Ten brands backed by nine people are not enough;
  // a later batch must supply the tenth feasible brand/person pair.
  const uniquenessScan = await scanBrandAnchorBatches({
    anchors: Array.from({ length: 20 }, (_, index) =>
      anchor(`Unique ${index + 1}`, index + 1, 1000 - index)
    ),
    batchSize: 10,
    targetPairs: 10,
    scanAnchor: async item => {
      if (item.vehicle_id <= 10) {
        return usablePair(item.vehicle_brand, item.vehicle_id, 2000 - item.vehicle_id, {
          personId: Math.min(item.vehicle_id, 9)
        });
      }
      return item.vehicle_id === 11
        ? usablePair(item.vehicle_brand, item.vehicle_id, 500, { personId: 10 })
        : null;
    }
  });
  assert.equal(uniquenessScan.batchesCompleted, 2);
  assert.equal(uniquenessScan.brandsScanned, 20);
  const feasibleTen = selectTopDistinctBrandAndPersonPairs(
    uniquenessScan.usablePairs,
    10
  );
  assert.equal(feasibleTen.length, 10);

  // Unique-person 7-8. A selected Top 10 is unique on all three axes,
  // and no person can appear selected more than once.
  assert.equal(new Set(feasibleTen.map(item => item.anchor.normalized_vehicle_brand)).size, 10);
  assert.equal(new Set(feasibleTen.map(item => String(item.anchor.vehicle_id))).size, 10);
  assert.equal(new Set(feasibleTen.map(item => String(item.link.person_id))).size, 10);
  const selectedCountsByPerson = feasibleTen.reduce((counts, item) => {
    const key = String(item.link.person_id);
    counts.set(key, (counts.get(key) || 0) + 1);
    return counts;
  }, new Map());
  assert.ok([...selectedCountsByPerson.values()].every(count => count <= 1));

  // F1 9-10. A verified constructor link still needs one actual joint
  // video; lack of a joint person+brand video remains a hard rejection.
  const hamilton = F1_DRIVER_CATALOG.find(item => item.slug === "lewis-hamilton");
  assert.equal(hamilton.roleCategory, "DRIVER_RACER");
  assert.equal(hamilton.lifeStatus, "ALIVE");
  assert.ok(hamilton.associations.some(item => item.brand === "Ferrari" && item.source));
  const f1Joint = evaluateJointVideo(video({
    title: "Lewis Hamilton drives Ferrari",
    views: 5_000_000
  }), {
    personTerms: hamilton.aliases,
    vehicleTerms: [{ term: "Ferrari", specificity: "SAME_BRAND" }],
    format: "SHORTS"
  });
  assert.equal(f1Joint.pairSpecificity, "SAME_BRAND");
  assert.equal(evaluateJointVideo(video({
    title: "Lewis Hamilton interview"
  }), {
    personTerms: hamilton.aliases,
    vehicleTerms: [{ term: "Ferrari", specificity: "SAME_BRAND" }],
    format: "SHORTS"
  }), null);

  // F1 11. Engine suppliers never create road-car associations.
  const gasly = F1_DRIVER_CATALOG.find(item => item.slug === "pierre-gasly");
  assert.deepEqual(gasly.associations.map(item => item.brand), ["Alpine"]);
  assert.ok(F1_DRIVER_CATALOG.every(person =>
    person.associations.every(item => !["Ford", "Honda"].includes(item.brand))
  ));
  const f1LinkWrites = [];
  await persistVerifiedF1CatalogLinks({
    async query(sql, values) {
      f1LinkWrites.push({ sql, values });
      return { rows: [], rowCount: 1 };
    }
  }, new Map(F1_DRIVER_CATALOG.map((person, index) => [
    person.slug,
    { id: index + 1, active: true }
  ])), { catalog: F1_DRIVER_CATALOG });
  assert.equal(
    f1LinkWrites.length,
    F1_DRIVER_CATALOG.reduce(
      (total, person) => total + person.associations.length,
      0
    )
  );
  assert.ok(f1LinkWrites.every(write =>
    write.sql.includes("'CATALOG'") &&
    JSON.parse(write.values[6]).relationship === "CONSTRUCTOR_OR_WORKS_TEAM"
  ));

  // F1 12. No role quota: actual joint views rank an F1 driver and a
  // creator by the exact same comparator.
  const f1Pair = usablePair("Ferrari", 32, 100, {
    personId: 40,
    link: { person_id: 40, f1_driver: true }
  });
  const creatorPair = usablePair("Porsche", 17, 200, {
    personId: 41,
    link: { person_id: 41, f1_driver: false }
  });
  assert.deepEqual(
    selectTopDistinctBrandAndPersonPairs([f1Pair, creatorPair], 2),
    [creatorPair, f1Pair]
  );

  // 13-15. Founder and person-country regressions remain covered above;
  // Fusion additionally partitions selected input by person and vehicle.
  assert.equal(fallback("Tesla"), true);
  assert.match(fusionSource, /countryId:\s*pair\.person_country_id/);
  assert.match(fusionSource, /person_rn=1/);

  // Quota/resume regressions. Query aliases are normalized and never duplicate.
  const queryLink = {
    canonical_name: "Lewis Hamilton",
    aliases: ["Lewis Hamilton", "Sir Lewis"],
    vehicle_brand: "Ferrari",
    vehicle_series: "SF",
    vehicle_model: "SF-26"
  };
  const planned = buildPairSearchQueries(queryLink, { vehicle_brand: "Ferrari" });
  assert.ok(planned.primary.length <= 2);
  assert.equal(new Set([...planned.primary, planned.conditional].filter(Boolean)
    .map(item => item.toLowerCase())).size,
  [...planned.primary, planned.conditional].filter(Boolean).length);

  const searchState = (overrides = {}) => ({
    searchQueriesPlanned: 0, searchQueriesCacheHit: 0,
    searchQueriesApiCalled: 0, searchQueries: 0,
    maxSearchQueries: 90, videosListCalls: 0,
    quotaBudgetExhausted: false, quotaErrors: 0,
    quotaUnits: 0, videosDiscovered: 0, videosEvaluated: 0,
    needMorePairs: () => true, ...overrides
  });
  const cachePool = cachedIds => {
    async function query(sql) {
      if (sql.includes("FROM youtube_search_query_cache")) {
        return cachedIds === null
          ? { rows: [], rowCount: 0 }
          : { rows: [{ result_video_ids: cachedIds }], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO youtube_search_query_cache")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO youtube_daily_search_budget") ||
        ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql.trim())) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("FROM youtube_daily_search_budget")) {
        return {
          rows: [{ search_calls_used: 0, automated_safe_limit: 90 }],
          rowCount: 1
        };
      }
      if (sql.includes("UPDATE youtube_daily_search_budget")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected cache query: ${sql.slice(0, 80)}`);
    }
    return {
      query,
      async connect() { return { query, release() {} }; }
    };
  };

  // Cache hits consume no search.list budget but still refresh videos.list details.
  let searchCalls = 0;
  let videoDetailCalls = 0;
  const cachedState = searchState();
  const cachedMatch = await searchPair(
    cachePool(["cached-video"]), queryLink,
    { vehicle_brand: "Ferrari" }, "SHORTS", "key", cachedState,
    {
      async searchVideos() { searchCalls += 1; return []; },
      async fetchVideos(ids, options) {
        videoDetailCalls += 1;
        options.onRequest();
        return [video({
          videoId: ids[0],
          title: "Sir Lewis drives Ferrari SF-26"
        })];
      }
    }
  );
  assert.ok(cachedMatch);
  assert.equal(searchCalls, 0);
  assert.equal(cachedState.searchQueriesApiCalled, 0);
  assert.ok(cachedState.searchQueriesCacheHit >= 1);
  assert.ok(videoDetailCalls >= 1);
  assert.ok(cachedState.videosListCalls >= 1);

  // The 91st cache miss is blocked before search.list is called.
  const cappedState = searchState({ searchQueriesApiCalled: 90, searchQueries: 90 });
  await assert.rejects(
    executePairSearchQuery(
      cachePool(null), "new query", "SHORTS", "key", cappedState,
      { async searchVideos() { searchCalls += 1; return []; } }
    ),
    error => error instanceof PairQuotaBlockedError
  );
  assert.equal(cappedState.searchQueriesApiCalled, 90);
  assert.equal(cappedState.quotaBudgetExhausted, true);

  // Provider quota errors become a resumable quota condition.
  const providerState = searchState();
  await assert.rejects(
    executePairSearchQuery(
      cachePool(null), "quota query", "SHORTS", "key", providerState,
      { async searchVideos() { throw new Error("quotaExceeded: Search Queries per day"); } }
    ),
    error => error.code === "YOUTUBE_SEARCH_QUOTA_BLOCKED"
  );
  assert.equal(providerState.quotaErrors, 1);
  assert.equal(providerState.quotaBudgetExhausted, true);

  // A partial batch preserves acquired candidates and a progress cursor.
  const partialScan = await scanBrandAnchorBatches({
    anchors: [anchor("First", 1), anchor("Second", 2)],
    batchSize: 5,
    targetPairs: 10,
    scanAnchor: async item => {
      if (item.vehicle_id === 1) return usablePair("First", 1, 100);
      throw new PairQuotaBlockedError("quota", { person_id: "22", next_query_stage: 2 });
    }
  });
  assert.equal(partialScan.quotaBlocked, true);
  assert.equal(partialScan.usablePairs.length, 1);
  assert.equal(partialScan.pendingAnchor.person_id, "22");
  assert.equal(partialScan.pendingAnchor.next_query_stage, 2);

  console.log("VEHICLE-PERSON PAIR WORKER TESTS PASSED (including quota/cache/resume regressions)");
}

runDistinctBrandTests().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

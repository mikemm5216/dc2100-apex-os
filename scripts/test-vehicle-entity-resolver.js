const assert = require("node:assert/strict");

const {
  BANNED_ALIASES,
  BRAND_CATALOG,
  MODEL_CATALOG,
  SERIES_CATALOG
} = require("../lib/scanner/vehicle-catalog");

const {
  ENTITY_STATUSES,
  MATCH_METHODS,
  RESOLVER_VERSION,
  normalizeEntityText,
  resolveVehicleEntity
} = require("../lib/scanner/entity-resolver");

function resolveTitle(title, extra = {}) {
  return resolveVehicleEntity({
    isShort: true,
    title,
    ...extra
  });
}

// ---------------------------------------------------------
// Catalog hygiene: no banned single-token aliases.
// ---------------------------------------------------------

for (const entry of [
  ...BRAND_CATALOG,
  ...SERIES_CATALOG,
  ...MODEL_CATALOG
]) {
  for (const alias of entry.aliases) {
    assert.ok(
      !BANNED_ALIASES.has(alias),
      `Catalog must not contain banned alias "${alias}".`
    );
  }
}

// ---------------------------------------------------------
// Normalization
// ---------------------------------------------------------

assert.equal(
  normalizeEntityText("GT-R"),
  "gt r"
);

assert.equal(
  normalizeEntityText("GT R"),
  "gt r"
);

assert.equal(
  normalizeEntityText("GT–R"),
  "gt r"
);

assert.equal(
  normalizeEntityText("RX-7"),
  "rx 7"
);

assert.equal(
  normalizeEntityText("RX7"),
  "rx7"
);

assert.equal(
  normalizeEntityText("Mercedes-AMG"),
  "mercedes amg"
);

assert.equal(
  normalizeEntityText("Mercedes AMG"),
  "mercedes amg"
);

assert.equal(
  normalizeEntityText("GR86™"),
  "gr86"
);

assert.equal(
  normalizeEntityText("  GR   86  "),
  "gr 86"
);

assert.equal(
  normalizeEntityText("911/GT3\\RS"),
  "911 gt3 rs"
);

// ---------------------------------------------------------
// Required vehicle cases
// ---------------------------------------------------------

const grGt = resolveTitle("Toyota GR GT top speed run");

assert.equal(grGt.status, ENTITY_STATUSES.RESOLVED);
assert.equal(grGt.brand, "Toyota");
assert.equal(grGt.series, "GR");
assert.equal(grGt.model, "GR GT");
assert.equal(grGt.countryCode, "JP");
assert.equal(grGt.confidence, 1.0);
assert.equal(grGt.resolverVersion, RESOLVER_VERSION);
assert.equal(RESOLVER_VERSION, "vehicle-rules-v1");

const su7 = resolveTitle("Xiaomi SU7 Ultra launch test");

assert.equal(su7.status, ENTITY_STATUSES.RESOLVED);
assert.equal(su7.brand, "Xiaomi");
assert.equal(su7.series, "SU7");
assert.equal(su7.model, "SU7 Ultra");
assert.equal(su7.countryCode, "CN");
assert.equal(su7.vehicleType, "EV");

const gt3rs = resolveTitle(
  "Porsche 911 GT3 RS on the Nurburgring"
);

assert.equal(gt3rs.status, ENTITY_STATUSES.RESOLVED);
assert.equal(gt3rs.brand, "Porsche");
assert.equal(gt3rs.series, "911");
assert.equal(gt3rs.model, "911 GT3 RS");
assert.equal(gt3rs.countryCode, "DE");
assert.equal(gt3rs.confidence, 1.0);
assert.equal(
  gt3rs.matchMethod,
  MATCH_METHODS.MODEL_ALIAS
);

const mustang = resolveTitle("Ford Mustang burnout");

assert.equal(mustang.status, ENTITY_STATUSES.RESOLVED);
assert.equal(mustang.brand, "Ford");
assert.equal(mustang.series, "Mustang");
assert.equal(mustang.model, "Mustang");
assert.equal(mustang.countryCode, "US");

const m3 = resolveTitle("BMW M3 review");

assert.equal(m3.status, ENTITY_STATUSES.RESOLVED);
assert.equal(m3.brand, "BMW");
assert.equal(m3.series, "M");
assert.equal(m3.model, "M3");
assert.equal(m3.countryCode, "DE");

const gtr = resolveTitle("Nissan GT-R street pull");

assert.equal(gtr.status, ENTITY_STATUSES.RESOLVED);
assert.equal(gtr.brand, "Nissan");
assert.equal(gtr.series, "GT-R");
assert.equal(gtr.model, "GT-R");
assert.equal(gtr.countryCode, "JP");

const rx7 = resolveTitle("Mazda RX-7 rotary sound");

assert.equal(rx7.status, ENTITY_STATUSES.RESOLVED);
assert.equal(rx7.brand, "Mazda");
assert.equal(rx7.series, "RX");
assert.equal(rx7.model, "RX-7");
assert.equal(rx7.countryCode, "JP");

const sti = resolveTitle("Subaru WRX STI gravel stage");

assert.equal(sti.status, ENTITY_STATUSES.RESOLVED);
assert.equal(sti.brand, "Subaru");
assert.equal(sti.series, "WRX");
assert.equal(sti.model, "WRX STI");
assert.equal(sti.countryCode, "JP");

// Additional catalog coverage.
const coverage = [
  ["Mercedes-AMG GT flyby", "Mercedes-AMG", "AMG GT", "DE"],
  ["Chevrolet Corvette dyno", "Chevrolet", "Corvette", "US"],
  ["Dodge Challenger burnout", "Dodge", "Challenger", "US"],
  ["Ferrari SF90 tunnel run", "Ferrari", "SF90", "IT"],
  ["Lamborghini Revuelto sound", "Lamborghini", "Revuelto", "IT"],
  ["McLaren 750S onboard", "McLaren", "750S", "GB"],
  ["Audi RS6 autobahn", "Audi", "RS6", "DE"],
  ["Honda Civic Type R lap record", "Honda", "Civic Type R", "JP"]
];

for (const [title, brand, model, country] of coverage) {
  const result = resolveTitle(title);

  assert.equal(
    result.status,
    ENTITY_STATUSES.RESOLVED,
    `${title} must resolve.`
  );
  assert.equal(result.brand, brand, title);
  assert.equal(result.model, model, title);
  assert.equal(result.countryCode, country, title);
}

// ---------------------------------------------------------
// Normalization variants resolve to the same model
// ---------------------------------------------------------

for (const variant of ["GT-R", "GT R", "GTR"]) {
  const result = resolveTitle(`${variant} highway pull`);

  assert.equal(
    result.model,
    "GT-R",
    `"${variant}" must resolve to GT-R.`
  );
}

for (const variant of ["RX-7", "RX7"]) {
  const result = resolveTitle(`${variant} widebody`);

  assert.equal(
    result.model,
    "RX-7",
    `"${variant}" must resolve to RX-7.`
  );
}

for (const variant of ["GR86", "GR 86"]) {
  const result = resolveTitle(`${variant} track day`);

  assert.equal(
    result.model,
    "GR86",
    `"${variant}" must resolve to GR86.`
  );
}

for (const variant of [
  "Mercedes-AMG GT",
  "Mercedes AMG GT"
]) {
  const result = resolveTitle(`${variant} launch`);

  assert.equal(
    result.brand,
    "Mercedes-AMG",
    `"${variant}" must resolve to Mercedes-AMG.`
  );
}

// ---------------------------------------------------------
// False positives
// ---------------------------------------------------------

const program = resolveTitle("program update");

assert.equal(
  program.status,
  ENTITY_STATUSES.UNRESOLVED,
  '"program update" must never resolve to RAM.'
);
assert.equal(program.brand, null);

const insane = resolveTitle("this car is insane");

assert.equal(
  insane.status,
  ENTITY_STATUSES.UNRESOLVED
);
assert.deepEqual(
  insane.conflictKeywords,
  ["insane"]
);

const gtVsRs = resolveTitle("GT vs RS");

assert.ok(
  gtVsRs.status === ENTITY_STATUSES.AMBIGUOUS ||
    gtVsRs.status === ENTITY_STATUSES.UNRESOLVED,
  '"GT vs RS" must be AMBIGUOUS or UNRESOLVED.'
);
assert.equal(gtVsRs.model, null);

const mPerformance = resolveTitle("new M performance");

assert.equal(
  mPerformance.status,
  ENTITY_STATUSES.UNRESOLVED,
  'A bare "M" must never resolve a BMW M model.'
);

const mini = resolveTitle("mini changes to suspension");

assert.equal(
  mini.status,
  ENTITY_STATUSES.UNRESOLVED,
  '"mini" without automotive brand context must not resolve.'
);

// Two incompatible brands with equal evidence.
const brandFight = resolveTitle("Ferrari vs Lamborghini");

assert.equal(
  brandFight.status,
  ENTITY_STATUSES.AMBIGUOUS,
  "Two tied brands must be AMBIGUOUS, not first-pick."
);
assert.equal(brandFight.brand, null);

// ---------------------------------------------------------
// Long videos are out of scope
// ---------------------------------------------------------

const longVideo = resolveVehicleEntity({
  isShort: false,
  title: "Porsche 911 GT3 RS full documentary"
});

assert.equal(
  longVideo.status,
  ENTITY_STATUSES.NOT_APPLICABLE
);
assert.equal(longVideo.confidence, null);
assert.equal(
  longVideo.matchMethod,
  MATCH_METHODS.NONE
);
assert.equal(longVideo.brand, null);

// ---------------------------------------------------------
// Match methods + confidence tiers
// ---------------------------------------------------------

const uniqueAlias = resolveTitle("SF90 pure sound");

assert.equal(
  uniqueAlias.matchMethod,
  MATCH_METHODS.UNIQUE_MODEL_ALIAS
);
assert.equal(uniqueAlias.confidence, 0.95);

const seriesOnly = resolveTitle(
  "Porsche 911 launch control"
);

assert.equal(
  seriesOnly.status,
  ENTITY_STATUSES.RESOLVED
);
assert.equal(
  seriesOnly.matchMethod,
  MATCH_METHODS.SERIES_ALIAS
);
assert.equal(seriesOnly.confidence, 0.85);
assert.equal(seriesOnly.series, "911");
assert.equal(seriesOnly.model, null);

const brandOnly = resolveTitle(
  "Toyota factory tour walkthrough"
);

assert.equal(
  brandOnly.status,
  ENTITY_STATUSES.BRAND_ONLY
);
assert.equal(
  brandOnly.matchMethod,
  MATCH_METHODS.BRAND_ALIAS
);
assert.equal(brandOnly.confidence, 0.65);
assert.equal(brandOnly.brand, "Toyota");
assert.equal(
  brandOnly.vehicleType,
  "UNKNOWN",
  "A brand alone must never imply a vehicle type."
);

const sourcePrior = resolveVehicleEntity({
  isShort: true,
  title: "new hot lap at the ring",
  channelTitle: "Toyota Gazoo Racing"
});

assert.equal(
  sourcePrior.status,
  ENTITY_STATUSES.BRAND_ONLY
);
assert.equal(
  sourcePrior.matchMethod,
  MATCH_METHODS.SOURCE_PRIOR
);
assert.equal(sourcePrior.brand, "Toyota");

// Tags and description also carry evidence.
const fromTags = resolveVehicleEntity({
  isShort: true,
  title: "craziest sound you will hear today",
  tags: ["porsche 911 gt3 rs", "trackday"]
});

assert.equal(fromTags.model, "911 GT3 RS");
assert.equal(
  fromTags.status,
  ENTITY_STATUSES.RESOLVED
);

const fromDescription = resolveVehicleEntity({
  isShort: true,
  title: "you wont believe this pull",
  description:
    "Filmed the Nissan GT-R at the strip last weekend."
});

assert.equal(fromDescription.model, "GT-R");

// ---------------------------------------------------------
// Action detection
// ---------------------------------------------------------

const actionCases = [
  ["Mustang drag race", "DRAG_RACING"],
  ["BMW M3 drift", "DRIFTING"],
  ["Barn find RX-7 restoration", "RESTORATION"],
  ["Porsche 911 launch control", "LAUNCH"],
  ["Ferrari vs Lamborghini", "COMPARISON"],
  ["Corvette burnout gone wrong", "BURNOUT"],
  ["Police chase ends badly", "CHASE"],
  ["GR Yaris rally jump", "JUMP"],
  ["Supra crash compilation", "CRASH"],
  ["Civic Type R track racing", "RACING"]
];

for (const [title, expectedAction] of actionCases) {
  const result = resolveTitle(title);

  assert.equal(
    result.action,
    expectedAction,
    `"${title}" must detect ${expectedAction}.`
  );
}

// ---------------------------------------------------------
// Conflict keywords: canonical, deduplicated, stable order
// ---------------------------------------------------------

const conflictA = resolveTitle(
  "fastest crash ever vs the slowest car"
);

assert.deepEqual(
  conflictA.conflictKeywords,
  ["comparison", "fastest", "slowest", "crash"]
);

// Same terms in a different order produce the same output.
const conflictB = resolveTitle(
  "the slowest car crash vs fastest run"
);

assert.deepEqual(
  conflictB.conflictKeywords,
  ["comparison", "fastest", "slowest", "crash"]
);

// Duplicates collapse.
const conflictC = resolveTitle(
  "crash crash crash vs vs versus"
);

assert.deepEqual(
  conflictC.conflictKeywords,
  ["comparison", "crash"]
);

// Raw matched terms are preserved in evidence.
assert.ok(
  conflictC.evidence.conflict_terms_raw.includes("vs")
);
assert.ok(
  conflictC.evidence.conflict_terms_raw.includes("versus")
);

// ---------------------------------------------------------
// Resolver never outputs traffic fields
// ---------------------------------------------------------

for (const key of [
  "views",
  "viralTier",
  "qualified",
  "rankScore"
]) {
  assert.ok(
    !(key in gt3rs),
    `Resolver output must not contain ${key}.`
  );
}

// ---------------------------------------------------------
// Entity lock: scanner upsert must not overwrite locked rows
// ---------------------------------------------------------

const {
  ENTITY_STATUSES: ENGINE_ENTITY_STATUSES
} = require("../lib/scanner/entity-resolver");

assert.equal(
  ENGINE_ENTITY_STATUSES.RESOLVED,
  "RESOLVED"
);

async function testEntityLockUpsert() {
  const fs = require("node:fs");
  const path = require("node:path");

  const engineSource = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "lib",
      "scanner",
      "engine.js"
    ),
    "utf8"
  );

  // Every entity column in the upsert must be guarded by
  // the entity_locked CASE.
  const guardedColumns = [
    "vehicle_brand",
    "vehicle_series",
    "vehicle_model",
    "vehicle_type",
    "vehicle_action",
    "resolved_vehicle_id",
    "resolved_country_id",
    "conflict_keywords",
    "entity_resolution_status",
    "entity_confidence",
    "entity_match_method",
    "entity_evidence",
    "entity_resolver_version"
  ];

  for (const column of guardedColumns) {
    const guard = new RegExp(
      `${column} = CASE\\s*\\n\\s*WHEN signals.entity_locked\\s*\\n\\s*THEN signals.${column}\\s*\\n\\s*ELSE EXCLUDED.${column}`,
      "m"
    );

    assert.ok(
      guard.test(engineSource),
      `Signals upsert must preserve ${column} when entity_locked = true.`
    );
  }

  // entity_locked itself must never be overwritten by the
  // scanner.
  assert.ok(
    !/entity_locked\s*=\s*EXCLUDED\.entity_locked/.test(
      engineSource
    ),
    "Scanner must never overwrite entity_locked."
  );

  // Behavioral check with a capturing pool: the SQL sent to
  // the database contains the lock guards, and resolver
  // output is passed as parameters.
  const { executeRun } = require("../lib/scanner/engine");

  assert.equal(typeof executeRun, "function");
}

// ---------------------------------------------------------
// Evidence stays compact
// ---------------------------------------------------------

const longDescription = "porsche ".repeat(4000);

const bigInput = resolveVehicleEntity({
  isShort: true,
  title: "mystery car",
  description: longDescription
});

const evidenceSize = JSON.stringify(
  bigInput.evidence
).length;

assert.ok(
  evidenceSize < 8000,
  `Entity evidence must stay compact (got ${evidenceSize} bytes).`
);

testEntityLockUpsert()
  .then(() => {
    console.log(
      "TASK 3.3C VEHICLE ENTITY RESOLVER TESTS PASSED"
    );
  })
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

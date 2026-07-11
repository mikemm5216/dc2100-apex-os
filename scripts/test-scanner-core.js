const assert = require("node:assert/strict");

const {
  VIRAL_THRESHOLDS,
  classifyShortFormat,
  classifyViralTier,
  deriveSignalMetrics,
  getDurationBucket,
  parseIso8601Duration
} = require("../lib/scanner/metrics");

const {
  extractChannelLookup
} = require("../lib/scanner/youtube");

// ---------------------------------------------------------
// ISO 8601 duration parsing
// ---------------------------------------------------------

assert.equal(
  parseIso8601Duration("PT9S"),
  9
);

assert.equal(
  parseIso8601Duration("PT1M20S"),
  80
);

assert.equal(
  parseIso8601Duration("PT1H2M3S"),
  3723
);

// ---------------------------------------------------------
// Duration buckets
// ---------------------------------------------------------

assert.equal(
  getDurationBucket(9),
  "UNDER_10"
);

assert.equal(
  getDurationBucket(10),
  "10_TO_20"
);

assert.equal(
  getDurationBucket(20),
  "10_TO_20"
);

assert.equal(
  getDurationBucket(40),
  "20_TO_40"
);

assert.equal(
  getDurationBucket(41),
  "41_TO_60"
);

assert.equal(
  getDurationBucket(60),
  "41_TO_60"
);

assert.equal(
  getDurationBucket(61),
  "61_TO_180"
);

assert.equal(
  getDurationBucket(180),
  "61_TO_180"
);

assert.equal(
  getDurationBucket(181),
  "OVER_180"
);

// ---------------------------------------------------------
// Shorts classification
// ---------------------------------------------------------

assert.deepEqual(
  classifyShortFormat(0),
  {
    isShort: false,
    shortFormat: "NOT_SHORT",
    shortRejectionReason: "ZERO_DURATION"
  }
);

assert.deepEqual(
  classifyShortFormat(1),
  {
    isShort: true,
    shortFormat: "CLASSIC_SHORT",
    shortRejectionReason: null
  }
);

assert.deepEqual(
  classifyShortFormat(60),
  {
    isShort: true,
    shortFormat: "CLASSIC_SHORT",
    shortRejectionReason: null
  }
);

assert.deepEqual(
  classifyShortFormat(61),
  {
    isShort: true,
    shortFormat: "EXTENDED_SHORT",
    shortRejectionReason: null
  }
);

assert.deepEqual(
  classifyShortFormat(180),
  {
    isShort: true,
    shortFormat: "EXTENDED_SHORT",
    shortRejectionReason: null
  }
);

assert.deepEqual(
  classifyShortFormat(181),
  {
    isShort: false,
    shortFormat: "NOT_SHORT",
    shortRejectionReason: "OVER_180_SECONDS"
  }
);

assert.deepEqual(
  classifyShortFormat(null),
  {
    isShort: false,
    shortFormat: "NOT_SHORT",
    shortRejectionReason: "MISSING_DURATION"
  }
);

assert.deepEqual(
  classifyShortFormat(undefined),
  {
    isShort: false,
    shortFormat: "NOT_SHORT",
    shortRejectionReason: "MISSING_DURATION"
  }
);

// ---------------------------------------------------------
// Channel lookup
// ---------------------------------------------------------

assert.deepEqual(
  extractChannelLookup(
    "https://www.youtube.com/@carwow"
  ),
  {
    type: "handle",
    value: "carwow"
  }
);

assert.deepEqual(
  extractChannelLookup(
    "https://www.youtube.com/channel/UC123"
  ),
  {
    type: "id",
    value: "UC123"
  }
);

// ---------------------------------------------------------
// Metrics
// ---------------------------------------------------------

const firstScan = deriveSignalMetrics({
  views: 24000,
  publishedAt:
    "2026-07-10T00:00:00.000Z",
  now:
    "2026-07-11T00:00:00.000Z"
});

assert.equal(
  firstScan.ageHours,
  24
);

assert.equal(
  firstScan.ageDays,
  1
);

assert.equal(
  firstScan.viewsPerDay,
  24000
);

assert.equal(
  firstScan.viewsPerHour,
  1000
);

// First scan uses cumulative views per hour.
assert.equal(
  firstScan.growthVelocity,
  1000
);

const repeatScan = deriveSignalMetrics({
  views: 30000,
  publishedAt:
    "2026-07-10T00:00:00.000Z",
  previousViews: 24000,
  previousCapturedAt:
    "2026-07-10T18:00:00.000Z",
  now:
    "2026-07-11T00:00:00.000Z"
});

assert.equal(
  repeatScan.growthVelocity,
  1000
);

// Age is floored at 1 hour.
const freshScan = deriveSignalMetrics({
  views: 600,
  publishedAt:
    "2026-07-10T23:30:00.000Z",
  now:
    "2026-07-11T00:00:00.000Z"
});

assert.equal(
  freshScan.ageHours,
  1
);

// ---------------------------------------------------------
// Viral tiers + qualification
// ---------------------------------------------------------

assert.equal(
  VIRAL_THRESHOLDS.PROVEN.minViews,
  1_000_000
);

const megaShort = classifyViralTier({
  isShort: true,
  views: 3_000_000,
  viewsPerDay: 500_000,
  ageDays: 6
});

assert.deepEqual(
  megaShort,
  {
    viralTier: "PROVEN",
    qualified: true
  }
);

assert.deepEqual(
  classifyViralTier({
    isShort: true,
    views: 1_000_000,
    viewsPerDay: 20_000,
    ageDays: 50
  }),
  {
    viralTier: "PROVEN",
    qualified: true
  }
);

const risingShort = classifyViralTier({
  isShort: true,
  views: 100_000,
  viewsPerDay: 50_000,
  ageDays: 2
});

assert.deepEqual(
  risingShort,
  {
    viralTier: "RISING",
    qualified: true
  }
);

assert.deepEqual(
  classifyViralTier({
    isShort: true,
    views: 25_000,
    viewsPerDay: 10_000,
    ageDays: 2
  }),
  {
    viralTier: "WATCH",
    qualified: false
  }
);

// High-view long-form video never qualifies.
assert.deepEqual(
  classifyViralTier({
    isShort: false,
    views: 5_000_000,
    viewsPerDay: 1_000_000,
    ageDays: 2
  }),
  {
    viralTier: "UNQUALIFIED",
    qualified: false
  }
);

// Low-view fresh Short stays below WATCH thresholds.
assert.deepEqual(
  classifyViralTier({
    isShort: true,
    views: 1_000,
    viewsPerDay: 2_000,
    ageDays: 0.5
  }),
  {
    viralTier: "UNQUALIFIED",
    qualified: false
  }
);

// RISING window expires after 14 days.
assert.deepEqual(
  classifyViralTier({
    isShort: true,
    views: 150_000,
    viewsPerDay: 60_000,
    ageDays: 20
  }),
  {
    viralTier: "UNQUALIFIED",
    qualified: false
  }
);

// ---------------------------------------------------------
// Actual Views First ordering
// ---------------------------------------------------------

const provenSignal = {
  views: 3_000_000,
  tier: megaShort.viralTier
};

const risingSignal = {
  views: 100_000,
  tier: risingShort.viralTier
};

const ranked = [
  risingSignal,
  provenSignal
].sort((a, b) => b.views - a.views);

assert.equal(
  ranked[0],
  provenSignal,
  "A 3,000,000-view PROVEN Short must rank above a 100,000-view RISING Short."
);

console.log(
  "TASK 3.3B SCANNER CORE TESTS PASSED"
);

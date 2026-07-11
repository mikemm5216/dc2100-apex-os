const assert = require("node:assert/strict");

const {
  deriveSignalMetrics,
  getDurationBucket,
  parseIso8601Duration
} = require("../lib/scanner/metrics");

const {
  extractChannelLookup
} = require("../lib/scanner/youtube");

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
  "OVER_40"
);

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
  firstScan.viewsPerDay,
  24000
);

assert.equal(
  firstScan.growthVelocity,
  1000
);

assert.equal(
  firstScan.qualified,
  true
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

console.log(
  "TASK 3.3 SCANNER CORE TESTS PASSED"
);

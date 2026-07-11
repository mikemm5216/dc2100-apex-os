const assert =
  require("node:assert/strict");

const {
  parseSignalQuery,
  validateScannerRunPayload
} = require(
  "../lib/scanner/api"
);

const validRun =
  validateScannerRunPayload({
    source_ids: [
      1,
      "2",
      2
    ],

    max_results_per_source: 20,
    max_age_days: 14,
    force_refresh_channels: true
  });

assert.deepEqual(
  validRun.value,
  {
    source_ids: [
      "1",
      "2"
    ],

    max_results_per_source: 20,
    max_age_days: 14,
    force_refresh_channels: true
  }
);

const invalidAge =
  validateScannerRunPayload({
    max_age_days: 10
  });

assert.equal(
  invalidAge.error.statusCode,
  400
);

const top30 =
  parseSignalQuery(
    new URLSearchParams({
      view: "top30",
      window_days: "7",
      duration_bucket: "20_TO_40",
      sort: "growth_velocity",
      limit: "100"
    })
  );

assert.equal(
  top30.value.qualifiedOnly,
  true
);

assert.equal(
  top30.value.limit,
  30
);

assert.equal(
  top30.value.windowDays,
  7
);

assert.equal(
  top30.value.durationBucket,
  "20_TO_40"
);

const invalidWindow =
  parseSignalQuery(
    new URLSearchParams({
      window_days: "9"
    })
  );

assert.equal(
  invalidWindow.error.statusCode,
  400
);

console.log(
  "TASK 3.3 SCANNER API TESTS PASSED"
);

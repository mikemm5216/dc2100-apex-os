const SHORT_FORMATS = {
  CLASSIC_SHORT: "CLASSIC_SHORT",
  EXTENDED_SHORT: "EXTENDED_SHORT",
  NOT_SHORT: "NOT_SHORT"
};

const SHORT_REJECTION_REASONS = {
  MISSING_DURATION: "MISSING_DURATION",
  ZERO_DURATION: "ZERO_DURATION",
  OVER_180_SECONDS: "OVER_180_SECONDS"
};

const VIRAL_TIERS = {
  PROVEN: "PROVEN",
  RISING: "RISING",
  WATCH: "WATCH",
  UNQUALIFIED: "UNQUALIFIED"
};

const VIRAL_THRESHOLDS = {
  PROVEN: {
    minViews: 1_000_000
  },
  RISING: {
    minViews: 100_000,
    minViewsPerDay: 50_000,
    maxAgeDays: 14
  },
  WATCH: {
    minViews: 25_000,
    minViewsPerDay: 10_000,
    maxAgeDays: 7
  }
};

function round(value, decimals) {
  const multiplier = 10 ** decimals;

  return Math.round(value * multiplier) / multiplier;
}

function parseIso8601Duration(value) {
  const input = String(value || "").trim();

  const match = input.match(
    /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
  );

  if (!match) {
    return null;
  }

  const days = Number(match[1] || 0);
  const hours = Number(match[2] || 0);
  const minutes = Number(match[3] || 0);
  const seconds = Number(match[4] || 0);

  return (
    days * 86400 +
    hours * 3600 +
    minutes * 60 +
    seconds
  );
}

function getDurationBucket(durationSeconds) {
  const duration = Number(durationSeconds);

  if (!Number.isFinite(duration) || duration < 0) {
    return "UNKNOWN";
  }

  if (duration < 10) {
    return "UNDER_10";
  }

  if (duration <= 20) {
    return "10_TO_20";
  }

  if (duration <= 40) {
    return "20_TO_40";
  }

  if (duration <= 60) {
    return "41_TO_60";
  }

  if (duration <= 180) {
    return "61_TO_180";
  }

  return "OVER_180";
}

function classifyShortFormat(durationSeconds) {
  if (
    durationSeconds === null ||
    durationSeconds === undefined ||
    durationSeconds === ""
  ) {
    return {
      isShort: false,
      shortFormat: SHORT_FORMATS.NOT_SHORT,
      shortRejectionReason:
        SHORT_REJECTION_REASONS.MISSING_DURATION
    };
  }

  const duration = Number(durationSeconds);

  if (
    !Number.isFinite(duration) ||
    duration < 0
  ) {
    return {
      isShort: false,
      shortFormat: SHORT_FORMATS.NOT_SHORT,
      shortRejectionReason:
        SHORT_REJECTION_REASONS.MISSING_DURATION
    };
  }

  if (duration === 0) {
    return {
      isShort: false,
      shortFormat: SHORT_FORMATS.NOT_SHORT,
      shortRejectionReason:
        SHORT_REJECTION_REASONS.ZERO_DURATION
    };
  }

  if (duration <= 60) {
    return {
      isShort: true,
      shortFormat: SHORT_FORMATS.CLASSIC_SHORT,
      shortRejectionReason: null
    };
  }

  if (duration <= 180) {
    return {
      isShort: true,
      shortFormat: SHORT_FORMATS.EXTENDED_SHORT,
      shortRejectionReason: null
    };
  }

  return {
    isShort: false,
    shortFormat: SHORT_FORMATS.NOT_SHORT,
    shortRejectionReason:
      SHORT_REJECTION_REASONS.OVER_180_SECONDS
  };
}

function classifyViralTier({
  isShort,
  views,
  viewsPerDay,
  ageDays
}) {
  if (isShort !== true) {
    return {
      viralTier: VIRAL_TIERS.UNQUALIFIED,
      qualified: false
    };
  }

  const normalizedViews = Math.max(
    0,
    Number(views) || 0
  );

  const normalizedViewsPerDay = Math.max(
    0,
    Number(viewsPerDay) || 0
  );

  const normalizedAgeDays = Number(ageDays);

  const hasValidAge =
    Number.isFinite(normalizedAgeDays) &&
    normalizedAgeDays >= 0;

  if (
    normalizedViews >=
    VIRAL_THRESHOLDS.PROVEN.minViews
  ) {
    return {
      viralTier: VIRAL_TIERS.PROVEN,
      qualified: true
    };
  }

  if (
    normalizedViews >=
      VIRAL_THRESHOLDS.RISING.minViews &&
    normalizedViewsPerDay >=
      VIRAL_THRESHOLDS.RISING.minViewsPerDay &&
    hasValidAge &&
    normalizedAgeDays <=
      VIRAL_THRESHOLDS.RISING.maxAgeDays
  ) {
    return {
      viralTier: VIRAL_TIERS.RISING,
      qualified: true
    };
  }

  if (
    normalizedViews >=
      VIRAL_THRESHOLDS.WATCH.minViews &&
    normalizedViewsPerDay >=
      VIRAL_THRESHOLDS.WATCH.minViewsPerDay &&
    hasValidAge &&
    normalizedAgeDays <=
      VIRAL_THRESHOLDS.WATCH.maxAgeDays
  ) {
    return {
      viralTier: VIRAL_TIERS.WATCH,
      qualified: false
    };
  }

  return {
    viralTier: VIRAL_TIERS.UNQUALIFIED,
    qualified: false
  };
}

function deriveSignalMetrics({
  views,
  publishedAt,
  previousViews = null,
  previousCapturedAt = null,
  now = new Date(),
  maxAgeDays = 30
}) {
  const normalizedViews = Math.max(
    0,
    Number(views) || 0
  );

  const publishedDate = new Date(publishedAt);
  const currentDate = new Date(now);

  if (
    Number.isNaN(publishedDate.getTime()) ||
    Number.isNaN(currentDate.getTime())
  ) {
    throw new Error(
      "publishedAt and now must be valid dates."
    );
  }

  const ageHours = Math.max(
    (currentDate.getTime() -
      publishedDate.getTime()) /
      3600000,
    1
  );

  const ageDays = Math.max(
    ageHours / 24,
    1 / 24
  );

  const viewsPerDay =
    normalizedViews / ageDays;

  const viewsPerHour =
    normalizedViews / ageHours;

  // First scan: growth velocity falls back to the
  // cumulative average views per hour.
  let growthVelocity = viewsPerHour;

  const normalizedPreviousViews =
    previousViews === null
      ? null
      : Math.max(0, Number(previousViews) || 0);

  const previousDate = previousCapturedAt
    ? new Date(previousCapturedAt)
    : null;

  if (
    normalizedPreviousViews !== null &&
    previousDate &&
    !Number.isNaN(previousDate.getTime()) &&
    currentDate > previousDate
  ) {
    const elapsedHours = Math.max(
      (currentDate.getTime() -
        previousDate.getTime()) /
        3600000,
      1 / 60
    );

    growthVelocity = Math.max(
      0,
      (
        normalizedViews -
        normalizedPreviousViews
      ) / elapsedHours
    );
  }

  const maxAgeHours =
    Math.max(1, Number(maxAgeDays) || 30) * 24;

  const recencyFactor = Math.max(
    0,
    1 - ageHours / maxAgeHours
  );

  // Auxiliary only: rank_score never decides viral
  // tier, qualification, or default sorting.
  const rankScore =
    Math.log10(normalizedViews + 1) * 20 +
    Math.log10(viewsPerDay + 1) * 30 +
    Math.log10(growthVelocity + 1) * 30 +
    recencyFactor * 20;

  return {
    ageHours: round(ageHours, 2),
    ageDays: round(ageDays, 4),
    viewsPerDay: round(viewsPerDay, 2),
    viewsPerHour: round(viewsPerHour, 4),
    growthVelocity: round(
      growthVelocity,
      4
    ),
    rankScore: round(rankScore, 4)
  };
}

module.exports = {
  SHORT_FORMATS,
  SHORT_REJECTION_REASONS,
  VIRAL_THRESHOLDS,
  VIRAL_TIERS,
  classifyShortFormat,
  classifyViralTier,
  deriveSignalMetrics,
  getDurationBucket,
  parseIso8601Duration
};

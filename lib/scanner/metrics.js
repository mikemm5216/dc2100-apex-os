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

  return "OVER_40";
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
    1 / 60
  );

  const ageDays = Math.max(
    ageHours / 24,
    1 / 24
  );

  const viewsPerDay =
    normalizedViews / ageDays;

  let growthVelocity =
    normalizedViews / ageHours;

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

  const rankScore =
    Math.log10(normalizedViews + 1) * 20 +
    Math.log10(viewsPerDay + 1) * 30 +
    Math.log10(growthVelocity + 1) * 30 +
    recencyFactor * 20;

  const qualified =
    ageHours <= maxAgeHours &&
    (
      normalizedViews >= 100000 ||
      viewsPerDay >= 10000 ||
      growthVelocity >= 500
    );

  return {
    ageHours: round(ageHours, 2),
    viewsPerDay: round(viewsPerDay, 2),
    growthVelocity: round(
      growthVelocity,
      4
    ),
    rankScore: round(rankScore, 4),
    qualified
  };
}

module.exports = {
  deriveSignalMetrics,
  getDurationBucket,
  parseIso8601Duration
};

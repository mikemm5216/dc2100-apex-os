// =========================================================
// VEHICLE-CENTERED SIGNAL FUSION — SCORING
// Task 3.3F
//
// Pure, deterministic scoring over evidence already
// persisted by prior radars. Fusion computes nothing new
// about vehicles, news, or people — it only combines their
// existing scores.
//
// Vehicle Traffic normalization reuses the log10-scaled
// view formula already validated for real vehicle views in
// lib/person/metrics.js (vehicleViewsScore), rescaled to
// this module's own 0-100 component range instead of that
// module's 55-point weight.
// =========================================================

const FUSION_VERSION = "vehicle-signal-fusion-v1";

// Weights sum to 100. VEHICLE_TRAFFIC is strictly higher
// than every other individual component, as required.
const FUSION_WEIGHTS = {
  VEHICLE_TRAFFIC: 40,
  COUNTRY_NEWS: 20,
  TRANSFORMATION_POTENTIAL: 10,
  PERSON_CURRENT: 15,
  PERSON_HISTORICAL: 10,
  PERSON_LINK_CONFIDENCE: 5
};

// Same log10/7 cap used by lib/person/metrics.js
// vehicleViewsScore: score reaches its maximum around 10M
// aggregated qualified-signal views.
const VEHICLE_VIEWS_LOG_CAP = 7;

// Person-link tier caps. Applied on top of the resolver's
// own tier-ordered link_confidence (MODEL 0.85 / SERIES
// 0.75 / BRAND 0.65 in lib/person/resolver.js) so a
// SAME_BRAND link can never reach the score ceiling of an
// EXACT_VEHICLE link even at maximum raw confidence.
const PERSON_LINK_TIER_CAPS = {
  EXACT_VEHICLE: 1.0,
  SAME_SERIES: 0.7,
  SAME_BRAND: 0.4
};

const MISSING_SIGNALS = {
  NO_PERSON_SIGNAL: "NO_PERSON_SIGNAL",
  NO_HISTORICAL_RESONANCE: "NO_HISTORICAL_RESONANCE"
};

function round(value, decimals) {
  const multiplier = 10 ** decimals;

  return Math.round(value * multiplier) / multiplier;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function nonnegative(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : 0;
}

// =========================================================
// COMPONENT SCORES (each independently 0-100)
// =========================================================

function calculateVehicleTrafficScore({
  vehicleViewsTotal
}) {
  const views = nonnegative(vehicleViewsTotal);

  const score =
    100 *
    Math.min(
      1,
      Math.log10(views + 1) / VEHICLE_VIEWS_LOG_CAP
    );

  return round(clamp(score, 0, 100), 2);
}

// Country news traffic_score and transformation_potential
// are already native 0-100 scores computed by the Country
// News radar (lib/news/classification.js) — reused as-is,
// never re-derived.
function countryNewsTrafficProxyScore(
  countryNewsSignal
) {
  return round(
    clamp(
      nonnegative(countryNewsSignal.traffic_score),
      0,
      100
    ),
    2
  );
}

// Person Current Traffic (person_traffic_signals.
// traffic_score) is already a native 0-100 score computed
// by the Person Radar (lib/person/metrics.js) — reused
// as-is, never re-derived and never blended with
// resonance.
function personCurrentTrafficScore(personTrafficSignal) {
  if (!personTrafficSignal) {
    return null;
  }

  return round(
    clamp(
      nonnegative(personTrafficSignal.traffic_score),
      0,
      100
    ),
    2
  );
}

// Historical Resonance is read from the authoritative
// per-(person, vehicle) link row — vehicle_person_links.
// historical_resonance_score for the SPECIFIC link used by
// this candidate — never from a person-level rollup and
// never copied into Current Person Traffic.
function personHistoricalResonanceScore(link) {
  if (
    !link ||
    link.historical_resonance_score === null ||
    link.historical_resonance_score === undefined
  ) {
    return null;
  }

  return round(
    clamp(
      nonnegative(link.historical_resonance_score),
      0,
      100
    ),
    2
  );
}

// Vehicle-Person Link Confidence: the resolver's own
// tier-ordered link_confidence (0-1), rescaled to 0-100
// and capped per eligibility tier so no lower tier can
// ever reach a higher tier's ceiling.
function vehiclePersonLinkConfidenceScore(
  link,
  tier
) {
  if (!link || !tier) {
    return null;
  }

  const cap = PERSON_LINK_TIER_CAPS[tier] ?? 0;

  const raw =
    clamp(nonnegative(link.link_confidence), 0, 1) * 100;

  return round(clamp(raw * cap, 0, 100), 2);
}

// Transformation Potential reuses the already-computed
// transformation_potential fields from Country News and
// Person Radar. When a person is linked, the stronger of
// the two available angles is used; with no eligible
// person the country's transformation_potential is the
// only available signal.
function transformationPotentialScore({
  countryNewsSignal,
  personTrafficSignal = null
}) {
  const countryScore = clamp(
    nonnegative(countryNewsSignal.transformation_potential),
    0,
    100
  );

  if (!personTrafficSignal) {
    return round(countryScore, 2);
  }

  const personScore = clamp(
    nonnegative(
      personTrafficSignal.transformation_potential
    ),
    0,
    100
  );

  return round(Math.max(countryScore, personScore), 2);
}

// =========================================================
// FUSION SCORE
//
// Weights are applied as fixed percentages of the 0-100
// component scores. Absent person components contribute
// exactly 0 — their weight share is never redistributed to
// the remaining components, so a NO_PERSON_SIGNAL candidate
// can never outrank an otherwise-similar candidate with a
// valid person link purely through renormalization. The
// structural ceiling for a NO_PERSON_SIGNAL candidate is
// VEHICLE_TRAFFIC + COUNTRY_NEWS + TRANSFORMATION_POTENTIAL
// = 70, strictly below the 100-point ceiling available when
// a strong person link is present.
// =========================================================

function calculateFusionScore({
  vehicleTrafficScore,
  countryNewsTrafficProxyScore: countryScore,
  transformationPotentialScore: transformationScore,
  personCurrentTrafficScore: personCurrentScore = null,
  personHistoricalResonanceScore: personHistoricalScore = null,
  vehiclePersonLinkConfidenceScore: linkConfidenceScore = null
}) {
  const weighted =
    (clamp(nonnegative(vehicleTrafficScore), 0, 100) *
      FUSION_WEIGHTS.VEHICLE_TRAFFIC) /
      100 +
    (clamp(nonnegative(countryScore), 0, 100) *
      FUSION_WEIGHTS.COUNTRY_NEWS) /
      100 +
    (clamp(nonnegative(transformationScore), 0, 100) *
      FUSION_WEIGHTS.TRANSFORMATION_POTENTIAL) /
      100 +
    (personCurrentScore === null
      ? 0
      : (clamp(nonnegative(personCurrentScore), 0, 100) *
          FUSION_WEIGHTS.PERSON_CURRENT) /
        100) +
    (personHistoricalScore === null
      ? 0
      : (clamp(nonnegative(personHistoricalScore), 0, 100) *
          FUSION_WEIGHTS.PERSON_HISTORICAL) /
        100) +
    (linkConfidenceScore === null
      ? 0
      : (clamp(nonnegative(linkConfidenceScore), 0, 100) *
          FUSION_WEIGHTS.PERSON_LINK_CONFIDENCE) /
        100);

  return round(clamp(weighted, 0, 100), 2);
}

// =========================================================
// PERSON LINK TIER DERIVATION
//
// Reuses the actual persisted vehicle_person_links columns
// (vehicle_id, vehicle_brand, vehicle_series, vehicle_model)
// against the candidate vehicle's own resolved brand/series/
// model (read from its qualified signals). No new tier
// taxonomy — EXACT_VEHICLE / SAME_SERIES / SAME_BRAND mirror
// the resolver's own model / series / brand association
// levels (lib/person/resolver.js).
// =========================================================

function normalizeIdentity(value) {
  return String(value ?? "").trim().toLowerCase();
}

function deriveVehiclePersonLinkTier(link, vehicle) {
  if (!link) {
    return null;
  }

  if (
    link.vehicle_id !== null &&
    link.vehicle_id !== undefined &&
    String(link.vehicle_id) === String(vehicle.vehicle_id)
  ) {
    return "EXACT_VEHICLE";
  }

  const linkBrand = normalizeIdentity(
    link.vehicle_brand
  );
  const vehicleBrand = normalizeIdentity(
    vehicle.vehicle_brand
  );

  if (!linkBrand || linkBrand !== vehicleBrand) {
    return null;
  }

  const linkModel = normalizeIdentity(link.vehicle_model);
  const vehicleModel = normalizeIdentity(
    vehicle.vehicle_model
  );

  if (linkModel && linkModel === vehicleModel) {
    return "EXACT_VEHICLE";
  }

  const linkSeries = normalizeIdentity(
    link.vehicle_series
  );
  const vehicleSeries = normalizeIdentity(
    vehicle.vehicle_series
  );

  if (linkSeries && linkSeries === vehicleSeries) {
    return "SAME_SERIES";
  }

  return "SAME_BRAND";
}

const PERSON_LINK_TIER_RANK = {
  EXACT_VEHICLE: 3,
  SAME_SERIES: 2,
  SAME_BRAND: 1
};

module.exports = {
  FUSION_VERSION,
  FUSION_WEIGHTS,
  MISSING_SIGNALS,
  PERSON_LINK_TIER_CAPS,
  PERSON_LINK_TIER_RANK,
  VEHICLE_VIEWS_LOG_CAP,
  calculateFusionScore,
  calculateVehicleTrafficScore,
  countryNewsTrafficProxyScore,
  deriveVehiclePersonLinkTier,
  personCurrentTrafficScore,
  personHistoricalResonanceScore,
  transformationPotentialScore,
  vehiclePersonLinkConfidenceScore
};

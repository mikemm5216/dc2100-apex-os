// =========================================================
// HISTORICAL PERSON RESONANCE ENGINE — Task 3.3E.1
//
// Deterministic catalog-based scoring of how durable and
// culturally recognizable a vehicle-person association is.
//
// Historical Resonance is relationship knowledge. It is
// NOT historical traffic, NOT a 10-year view count, and it
// never reads current vehicle views, news mentions,
// publisher counts, traffic scores, or nationality.
// =========================================================

const RESONANCE_VERSION = "vehicle-person-resonance-v1";

// Cumulative relationship scopes:
// ONE_YEAR ⊂ TEN_YEARS ⊂ ALL_TIME.
const RELATIONSHIP_SCOPES = [
  "ONE_YEAR",
  "TEN_YEARS",
  "ALL_TIME"
];

const EVIDENCE_HORIZONS = [
  "ONE_YEAR",
  "TEN_YEARS",
  "ALL_TIME"
];

// Lower rank = shorter evidence horizon. An association is
// eligible for every scope at least as wide as its own
// evidence horizon.
const SCOPE_RANKS = {
  ONE_YEAR: 1,
  TEN_YEARS: 2,
  ALL_TIME: 3
};

const RESONANCE_TIERS = {
  ICONIC: "ICONIC",
  ESTABLISHED: "ESTABLISHED",
  RECOGNIZABLE: "RECOGNIZABLE",
  NICHE: "NICHE"
};

const RESONANCE_THRESHOLDS = {
  // ICONIC additionally requires iconic or legacy
  // catalog evidence on at least one eligible link.
  ICONIC: 80,
  ESTABLISHED: 60,
  RECOGNIZABLE: 40
};

const RESONANCE_WEIGHTS = {
  // Vehicle specificity: max 25.
  SPECIFICITY_MODEL: 25,
  SPECIFICITY_SERIES: 20,
  SPECIFICITY_BRAND: 15,
  SPECIFICITY_GENERAL: 8,

  // Relation strength: max 20. Every relation type maps
  // to a distinct value — no two relations tie.
  RELATION_STRENGTH: {
    FOUNDER: 20,
    DESIGNER: 19,
    ENGINEER: 18,
    BUILDER: 17,
    TUNER: 16,
    RACING_DRIVER: 15,
    DRIVER: 14,
    EXECUTIVE: 12,
    HISTORICAL: 11,
    OWNER: 8,
    CREATOR: 6,
    OTHER: 4
  },

  // Evidence horizon durability: max 25.
  HORIZON_DURABILITY: {
    ONE_YEAR: 8,
    TEN_YEARS: 17,
    ALL_TIME: 25
  },

  ICONIC_BONUS: 15,
  LEGACY_BONUS: 10,
  RECOGNITION_MAX: 5
};

// Person scope score = best eligible link score plus a
// breadth bonus for each ADDITIONAL strong eligible link.
const PERSON_RESONANCE_BREADTH = {
  STRONG_LINK_THRESHOLD: 50,
  POINTS_EACH: 2,
  MAX: 8
};

function round(value, decimals) {
  const multiplier = 10 ** decimals;
  return Math.round(value * multiplier) / multiplier;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizedHorizon(association) {
  const horizon = association?.evidenceHorizon;

  // Unknown horizons collapse to ALL_TIME, the most
  // conservative bucket: never eligible for the shorter
  // scopes.
  return EVIDENCE_HORIZONS.includes(horizon)
    ? horizon
    : "ALL_TIME";
}

function isAssociationEligibleForScope(
  association,
  scope
) {
  if (!SCOPE_RANKS[scope]) {
    return false;
  }

  return (
    SCOPE_RANKS[normalizedHorizon(association)] <=
    SCOPE_RANKS[scope]
  );
}

function specificityScore(association) {
  if (association.model) {
    return RESONANCE_WEIGHTS.SPECIFICITY_MODEL;
  }

  if (association.series) {
    return RESONANCE_WEIGHTS.SPECIFICITY_SERIES;
  }

  if (association.generalAssociation) {
    return RESONANCE_WEIGHTS.SPECIFICITY_GENERAL;
  }

  return RESONANCE_WEIGHTS.SPECIFICITY_BRAND;
}

function relationStrengthScore(association) {
  const strength =
    RESONANCE_WEIGHTS.RELATION_STRENGTH[
      association.relationType
    ];

  return Number.isFinite(strength)
    ? strength
    : RESONANCE_WEIGHTS.RELATION_STRENGTH.OTHER;
}

function recognitionScore(association) {
  const weight = Number(association.recognitionWeight);

  if (!Number.isFinite(weight)) {
    return 0;
  }

  return (
    clamp(weight, 0, 1) *
    RESONANCE_WEIGHTS.RECOGNITION_MAX
  );
}

// Scores ONE catalog association 0–100. The formula only
// reads durable catalog fields; traffic evidence of any
// kind is structurally impossible to feed in.
function calculateLinkHistoricalResonance(
  association
) {
  const horizon = normalizedHorizon(association);

  const breakdown = {
    vehicle_specificity:
      specificityScore(association),
    relation_strength:
      relationStrengthScore(association),
    horizon_durability:
      RESONANCE_WEIGHTS.HORIZON_DURABILITY[horizon],
    iconic_bonus: association.iconicAssociation
      ? RESONANCE_WEIGHTS.ICONIC_BONUS
      : 0,
    legacy_bonus: association.legacyAssociation
      ? RESONANCE_WEIGHTS.LEGACY_BONUS
      : 0,
    recognition_points: round(
      recognitionScore(association),
      2
    )
  };

  const score = round(
    clamp(
      breakdown.vehicle_specificity +
        breakdown.relation_strength +
        breakdown.horizon_durability +
        breakdown.iconic_bonus +
        breakdown.legacy_bonus +
        breakdown.recognition_points,
      0,
      100
    ),
    2
  );

  return { score, breakdown };
}

// hasIconicEvidence: at least one eligible association
// carries iconic or legacy catalog evidence. A high score
// without such evidence can never be ICONIC.
function classifyHistoricalResonanceTier({
  score,
  hasIconicEvidence = false
}) {
  // "No evidence" must never read as "low resonance":
  // a missing score yields a NULL tier, not NICHE.
  if (score === null || score === undefined) {
    return null;
  }

  const parsed = Number(score);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (
    parsed >= RESONANCE_THRESHOLDS.ICONIC &&
    hasIconicEvidence
  ) {
    return RESONANCE_TIERS.ICONIC;
  }

  if (parsed >= RESONANCE_THRESHOLDS.ESTABLISHED) {
    return RESONANCE_TIERS.ESTABLISHED;
  }

  if (parsed >= RESONANCE_THRESHOLDS.RECOGNIZABLE) {
    return RESONANCE_TIERS.RECOGNIZABLE;
  }

  return RESONANCE_TIERS.NICHE;
}

// Scores ONE person for ONE relationship scope from the
// person's catalog associations. With no eligible
// association the score and tier are BOTH null — "no
// evidence" must never read as "low resonance".
function calculatePersonHistoricalResonance(
  associations,
  scope
) {
  const eligible = (
    Array.isArray(associations) ? associations : []
  ).filter(association =>
    isAssociationEligibleForScope(association, scope)
  );

  if (eligible.length === 0) {
    return {
      scope,
      score: null,
      tier: null,
      primaryAssociation: null,
      primaryBreakdown: null,
      eligibleLinkCount: 0,
      strongLinkCount: 0,
      breadthBonus: 0
    };
  }

  const scored = eligible.map(association => ({
    association,
    ...calculateLinkHistoricalResonance(association)
  }));

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      String(a.association.brand || "").localeCompare(
        String(b.association.brand || "")
      )
  );

  const primary = scored[0];

  const strongLinks = scored.filter(
    entry =>
      entry.score >=
      PERSON_RESONANCE_BREADTH.STRONG_LINK_THRESHOLD
  );

  // The primary link never counts toward its own breadth
  // bonus.
  const additionalStrong = strongLinks.filter(
    entry => entry !== primary
  ).length;

  const breadthBonus = Math.min(
    PERSON_RESONANCE_BREADTH.MAX,
    additionalStrong *
      PERSON_RESONANCE_BREADTH.POINTS_EACH
  );

  const score = round(
    clamp(primary.score + breadthBonus, 0, 100),
    2
  );

  const hasIconicEvidence = eligible.some(
    association =>
      Boolean(association.iconicAssociation) ||
      Boolean(association.legacyAssociation)
  );

  return {
    scope,
    score,
    tier: classifyHistoricalResonanceTier({
      score,
      hasIconicEvidence
    }),
    primaryAssociation: primary.association,
    primaryBreakdown: primary.breakdown,
    eligibleLinkCount: eligible.length,
    strongLinkCount: strongLinks.length,
    breadthBonus
  };
}

module.exports = {
  EVIDENCE_HORIZONS,
  PERSON_RESONANCE_BREADTH,
  RELATIONSHIP_SCOPES,
  RESONANCE_THRESHOLDS,
  RESONANCE_TIERS,
  RESONANCE_VERSION,
  RESONANCE_WEIGHTS,
  SCOPE_RANKS,
  calculateLinkHistoricalResonance,
  calculatePersonHistoricalResonance,
  classifyHistoricalResonanceTier,
  isAssociationEligibleForScope
};

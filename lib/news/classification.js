// =========================================================
// COUNTRY NEWS CLASSIFICATION — Task 3.3D
//
// Deterministic rule-based classification:
//   - country evidence (title / snippet / query context)
//   - news category
//   - conflict archetypes
//   - transformation potential (score only, no story)
//
// No scoring rule may depend on political stance or grant
// a fixed bonus to a specific country.
// =========================================================

const {
  COUNTRY_MATCH_CONFIDENCE,
  COUNTRY_MATCH_METHODS,
  getCountryAliases
} = require("./country-query-catalog");

const NEWS_RESOLVER_VERSION = "country-news-rules-v1";

const NEWS_CATEGORIES = [
  "POLITICS_POLICY",
  "ENERGY",
  "WAR_SECURITY",
  "SANCTIONS_TRADE",
  "RESOURCES",
  "SEMICONDUCTORS_AI",
  "ECONOMY",
  "DISASTER_CLIMATE",
  "INFRASTRUCTURE",
  "INTERNATIONAL_RELATIONS",
  "CULTURE_SOCIETY",
  "OTHER"
];

const CONFLICT_ARCHETYPES = [
  "RESOURCE_SCARCITY",
  "SUPPLY_CHAIN_DISRUPTION",
  "POWER_STRUGGLE",
  "TECHNOLOGY_RACE",
  "SANCTIONS_BLOCKADE",
  "INFRASTRUCTURE_FAILURE",
  "DISASTER_SURVIVAL",
  "ECONOMIC_PRESSURE",
  "BORDER_SECURITY",
  "PROPAGANDA_CULTURE"
];

// Category keyword tables. Order defines the deterministic
// priority used to break ties (earlier wins).
const CATEGORY_RULES = [
  ["DISASTER_CLIMATE", [
    "earthquake", "tsunami", "typhoon", "hurricane",
    "flood", "flooding", "wildfire", "drought",
    "heatwave", "volcano", "landslide", "storm",
    "climate", "disaster", "evacuation"
  ]],
  ["WAR_SECURITY", [
    "war", "military", "missile", "invasion", "troops",
    "airstrike", "attack", "defense", "terror",
    "conflict zone", "ceasefire", "armed", "navy",
    "drone strike"
  ]],
  ["SANCTIONS_TRADE", [
    "sanction", "sanctions", "tariff", "tariffs",
    "embargo", "export ban", "export restriction",
    "export restrictions", "export controls",
    "trade war", "trade deal", "trade dispute",
    "blockade", "import ban"
  ]],
  ["SEMICONDUCTORS_AI", [
    "semiconductor", "semiconductors", "chip", "chips",
    "chipmaker", "foundry", "artificial intelligence",
    " ai ", "robotics", "quantum computing", "cyberattack",
    "cybersecurity", "data center"
  ]],
  ["ENERGY", [
    "energy", "oil", "gas", "fuel", "electricity",
    "power grid", "power shortage", "power outage",
    "nuclear plant", "reactor", "battery", "solar",
    "wind power", "refinery", "pipeline", "blackout"
  ]],
  ["RESOURCES", [
    "rare earth", "lithium", "cobalt", "minerals",
    "mining", "water shortage", "water crisis",
    "food supply", "food shortage", "grain", "raw material",
    "commodity", "shortage"
  ]],
  ["INFRASTRUCTURE", [
    "infrastructure", "bridge", "railway", "rail",
    "highway", "airport", "port", "tunnel", "collapse",
    "construction", "grid failure", "subway", "dam"
  ]],
  ["ECONOMY", [
    "economy", "inflation", "recession", "gdp",
    "unemployment", "interest rate", "central bank",
    "stock market", "currency", "debt", "exports",
    "supply chain", "manufacturing", "factory"
  ]],
  ["INTERNATIONAL_RELATIONS", [
    "summit", "diplomacy", "diplomatic", "alliance",
    "treaty", "bilateral", "foreign minister", "embassy",
    "united nations", "nato", "relations"
  ]],
  ["POLITICS_POLICY", [
    "election", "parliament", "government", "policy",
    "minister", "president", "prime minister", "senate",
    "congress", "legislation", "vote", "cabinet",
    "regulation", "law", "reform"
  ]],
  ["CULTURE_SOCIETY", [
    "festival", "culture", "cultural", "museum", "film",
    "music", "sports", "olympics", "tourism", "anime",
    "fashion", "celebrity", "society", "population",
    "birth rate"
  ]]
];

const CATEGORY_CONFIDENCE = {
  HEADLINE: 0.9,
  SNIPPET: 0.7,
  QUERY_GROUP: 0.4
};

// Query group fallback when neither headline nor snippet
// carries category evidence.
const QUERY_GROUP_CATEGORY_FALLBACK = {
  GENERAL: "OTHER",
  RESOURCE_ENERGY: "ENERGY",
  TECHNOLOGY: "SEMICONDUCTORS_AI",
  ECONOMY_TRADE: "ECONOMY",
  SECURITY_CRISIS: "WAR_SECURITY"
};

// Archetype keyword tables. Evidence must come from the
// headline or snippet; query groups never produce
// archetypes on their own.
const ARCHETYPE_RULES = [
  ["RESOURCE_SCARCITY", [
    "shortage", "scarcity", "rationing", "supply crunch",
    "runs out", "running out", "depleted", "water crisis",
    "fuel shortage", "energy crisis", "food crisis"
  ]],
  ["SUPPLY_CHAIN_DISRUPTION", [
    "supply chain", "factory shutdown", "plant shutdown",
    "production halt", "halts production", "shipping delay",
    "port congestion", "logistics", "parts shortage",
    "factory closure", "assembly line", "supply disruption"
  ]],
  ["POWER_STRUGGLE", [
    "power struggle", "coup", "leadership battle",
    "political crisis", "rivalry", "succession",
    "ousted", "no-confidence", "impeachment"
  ]],
  ["TECHNOLOGY_RACE", [
    "chip race", "ai race", "tech race", "arms race",
    "semiconductor subsidy", "chip subsidy",
    "tech competition", "breakthrough", "supremacy",
    "next-generation", "innovation race"
  ]],
  ["SANCTIONS_BLOCKADE", [
    "sanction", "sanctions", "embargo", "blockade",
    "export ban", "export controls", "export restriction",
    "export restrictions", "blacklist", "asset freeze",
    "blocks exports", "block exports"
  ]],
  ["INFRASTRUCTURE_FAILURE", [
    "bridge collapse", "collapse", "collapsed",
    "grid failure", "blackout", "power outage",
    "derailment", "burst pipeline", "dam failure",
    "structural failure", "outage"
  ]],
  ["DISASTER_SURVIVAL", [
    "earthquake", "tsunami", "typhoon", "hurricane",
    "flood", "wildfire", "evacuation", "rescue",
    "survivors", "death toll", "state of emergency",
    "disaster zone"
  ]],
  ["ECONOMIC_PRESSURE", [
    "inflation", "recession", "default", "debt crisis",
    "currency crash", "layoffs", "bankruptcy",
    "cost of living", "economic crisis", "austerity",
    "market crash"
  ]],
  ["BORDER_SECURITY", [
    "border", "incursion", "territorial", "airspace",
    "maritime dispute", "border clash", "checkpoint",
    "frontier", "territorial waters"
  ]],
  ["PROPAGANDA_CULTURE", [
    "propaganda", "disinformation", "censorship",
    "state media", "influence campaign", "misinformation",
    "information war", "soft power"
  ]]
];

// Archetypes that describe crisis pressure for the
// transformation-potential score. Country-neutral.
const CRISIS_KEYWORDS = [
  "crisis", "shortage", "war", "sanction", "collapse",
  "emergency", "blackout", "invasion", "disaster",
  "blockade", "shutdown", "conflict", "attack",
  "evacuation", "failure", "restriction"
];

const TRANSFORMATION_WEIGHTS = {
  ARCHETYPE_POINTS_EACH: 15,
  ARCHETYPE_MAX: 45,

  CRISIS_KEYWORD_POINTS_EACH: 5,
  CRISIS_KEYWORD_MAX: 20,

  CRISIS_CATEGORY_BONUS: 10,

  COUNTRY_CONFIDENCE_MAX: 10,

  TRAFFIC_MAX: 15
};

const CRISIS_CATEGORIES = new Set([
  "ENERGY",
  "WAR_SECURITY",
  "SANCTIONS_TRADE",
  "RESOURCES",
  "SEMICONDUCTORS_AI",
  "ECONOMY",
  "DISASTER_CLIMATE",
  "INFRASTRUCTURE"
]);

const TRANSFORMATION_TIERS = {
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW"
};

const TRANSFORMATION_THRESHOLDS = {
  HIGH: 70,
  MEDIUM: 40
};

function normalizeText(value) {
  return ` ${String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()} `;
}

function containsTerm(paddedText, term) {
  const normalizedTerm = term.toLowerCase();

  if (
    normalizedTerm.startsWith(" ") ||
    normalizedTerm.endsWith(" ")
  ) {
    return paddedText.includes(normalizedTerm);
  }

  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${normalizedTerm.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&"
    )}(?:$|[^\\p{L}\\p{N}])`,
    "u"
  );

  return pattern.test(paddedText);
}

// =========================================================
// COUNTRY EVIDENCE
// =========================================================

function resolveCountryEvidence({
  countryCode,
  title,
  snippet
}) {
  const aliases = getCountryAliases(countryCode) || [];

  const paddedTitle = normalizeText(title);
  const paddedSnippet = normalizeText(snippet);

  const titleMatches = aliases.filter(alias =>
    containsTerm(paddedTitle, alias)
  );

  if (titleMatches.length > 0) {
    return {
      matchMethod: COUNTRY_MATCH_METHODS.TITLE_ALIAS,
      confidence: COUNTRY_MATCH_CONFIDENCE.TITLE_ALIAS,
      evidence: {
        matched_aliases: titleMatches,
        field: "title"
      }
    };
  }

  const snippetMatches = aliases.filter(alias =>
    containsTerm(paddedSnippet, alias)
  );

  if (snippetMatches.length > 0) {
    return {
      matchMethod: COUNTRY_MATCH_METHODS.SNIPPET_ALIAS,
      confidence: COUNTRY_MATCH_CONFIDENCE.SNIPPET_ALIAS,
      evidence: {
        matched_aliases: snippetMatches,
        field: "snippet"
      }
    };
  }

  // No direct alias evidence: only the query context ties
  // this story to the target country. Confidence is capped
  // even when the text names other countries.
  return {
    matchMethod: COUNTRY_MATCH_METHODS.QUERY_CONTEXT,
    confidence: COUNTRY_MATCH_CONFIDENCE.QUERY_CONTEXT,
    evidence: {
      matched_aliases: [],
      field: "query"
    }
  };
}

// =========================================================
// CATEGORY
// =========================================================

function matchCategoryInText(paddedText) {
  let best = null;

  for (const [category, terms] of CATEGORY_RULES) {
    const matched = terms.filter(term =>
      containsTerm(paddedText, term)
    );

    if (matched.length === 0) {
      continue;
    }

    // More matched terms wins; ties resolve by the fixed
    // CATEGORY_RULES priority order (earlier entry wins).
    if (!best || matched.length > best.matched.length) {
      best = { category, matched };
    }
  }

  return best;
}

function classifyCategory({
  title,
  snippet,
  queryKeys = []
}) {
  const headlineMatch = matchCategoryInText(
    normalizeText(title)
  );

  if (headlineMatch) {
    return {
      category: headlineMatch.category,
      confidence: CATEGORY_CONFIDENCE.HEADLINE,
      evidence: {
        field: "headline",
        matched_terms: headlineMatch.matched
      }
    };
  }

  const snippetMatch = matchCategoryInText(
    normalizeText(snippet)
  );

  if (snippetMatch) {
    return {
      category: snippetMatch.category,
      confidence: CATEGORY_CONFIDENCE.SNIPPET,
      evidence: {
        field: "snippet",
        matched_terms: snippetMatch.matched
      }
    };
  }

  for (const queryKey of queryKeys) {
    const fallback =
      QUERY_GROUP_CATEGORY_FALLBACK[queryKey];

    if (fallback && fallback !== "OTHER") {
      return {
        category: fallback,
        confidence: CATEGORY_CONFIDENCE.QUERY_GROUP,
        evidence: {
          field: "query_group",
          matched_terms: [queryKey]
        }
      };
    }
  }

  return {
    category: "OTHER",
    confidence: CATEGORY_CONFIDENCE.QUERY_GROUP,
    evidence: {
      field: "none",
      matched_terms: []
    }
  };
}

// =========================================================
// CONFLICT ARCHETYPES
// =========================================================

function extractConflictArchetypes({ title, snippet }) {
  const paddedText = normalizeText(
    `${title || ""} ${snippet || ""}`
  );

  const archetypes = [];
  const evidence = {};

  for (const [archetype, terms] of ARCHETYPE_RULES) {
    const matched = terms.filter(term =>
      containsTerm(paddedText, term)
    );

    if (matched.length > 0) {
      archetypes.push(archetype);
      evidence[archetype] = matched;
    }
  }

  return {
    archetypes,
    evidence
  };
}

function extractCrisisKeywords({ title, snippet }) {
  const paddedText = normalizeText(
    `${title || ""} ${snippet || ""}`
  );

  return CRISIS_KEYWORDS.filter(keyword =>
    containsTerm(paddedText, keyword)
  );
}

// =========================================================
// TRANSFORMATION POTENTIAL
// =========================================================

function calculateTransformationPotential({
  conflictArchetypes = [],
  crisisKeywords = [],
  category,
  countryConfidence,
  trafficScore
}) {
  const archetypeScore = Math.min(
    TRANSFORMATION_WEIGHTS.ARCHETYPE_MAX,
    conflictArchetypes.length *
      TRANSFORMATION_WEIGHTS.ARCHETYPE_POINTS_EACH
  );

  const keywordScore = Math.min(
    TRANSFORMATION_WEIGHTS.CRISIS_KEYWORD_MAX,
    crisisKeywords.length *
      TRANSFORMATION_WEIGHTS.CRISIS_KEYWORD_POINTS_EACH
  );

  const categoryScore = CRISIS_CATEGORIES.has(category)
    ? TRANSFORMATION_WEIGHTS.CRISIS_CATEGORY_BONUS
    : 0;

  const confidenceScore =
    Math.max(0, Math.min(1, Number(countryConfidence) || 0)) *
    TRANSFORMATION_WEIGHTS.COUNTRY_CONFIDENCE_MAX;

  const trafficComponent =
    (Math.max(0, Math.min(100, Number(trafficScore) || 0)) /
      100) *
    TRANSFORMATION_WEIGHTS.TRAFFIC_MAX;

  const total = Math.min(
    100,
    Math.round(
      (archetypeScore +
        keywordScore +
        categoryScore +
        confidenceScore +
        trafficComponent) *
        100
    ) / 100
  );

  let tier = TRANSFORMATION_TIERS.LOW;

  if (total >= TRANSFORMATION_THRESHOLDS.HIGH) {
    tier = TRANSFORMATION_TIERS.HIGH;
  } else if (total >= TRANSFORMATION_THRESHOLDS.MEDIUM) {
    tier = TRANSFORMATION_TIERS.MEDIUM;
  }

  return {
    transformationPotential: total,
    transformationTier: tier
  };
}

module.exports = {
  ARCHETYPE_RULES,
  CATEGORY_CONFIDENCE,
  CATEGORY_RULES,
  CONFLICT_ARCHETYPES,
  CRISIS_CATEGORIES,
  CRISIS_KEYWORDS,
  NEWS_CATEGORIES,
  NEWS_RESOLVER_VERSION,
  QUERY_GROUP_CATEGORY_FALLBACK,
  TRANSFORMATION_THRESHOLDS,
  TRANSFORMATION_TIERS,
  TRANSFORMATION_WEIGHTS,
  calculateTransformationPotential,
  classifyCategory,
  extractConflictArchetypes,
  extractCrisisKeywords,
  resolveCountryEvidence
};

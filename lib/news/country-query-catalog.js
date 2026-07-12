// =========================================================
// COUNTRY QUERY CATALOG — Task 3.3D
//
// Deterministic country-level news query groups plus the
// country evidence alias catalog used to confirm that a
// headline actually concerns the target country.
// =========================================================

const QUERY_GROUPS = [
  "GENERAL",
  "RESOURCE_ENERGY",
  "TECHNOLOGY",
  "ECONOMY_TRADE",
  "SECURITY_CRISIS"
];

// Query terms per group. "{country}" is replaced with the
// country display name. Terms are OR-combined by the
// provider-safe builder below.
const QUERY_GROUP_TERMS = {
  GENERAL: [],

  RESOURCE_ENERGY: [
    "energy",
    "oil",
    "fuel",
    "electricity",
    "battery",
    "rare earth",
    "water shortage"
  ],

  TECHNOLOGY: [
    "semiconductor",
    "chips",
    "AI",
    "technology",
    "robotics",
    "cyber"
  ],

  ECONOMY_TRADE: [
    "economy",
    "trade",
    "tariff",
    "sanctions",
    "inflation",
    "exports",
    "supply chain"
  ],

  SECURITY_CRISIS: [
    "war",
    "military",
    "security",
    "border",
    "disaster",
    "emergency",
    "infrastructure"
  ]
};

// Country evidence aliases. Keyed by ISO 3166-1 alpha-2.
// Covers every country the vehicle entity resolver can
// currently produce.
const COUNTRY_ALIASES = {
  JP: ["japan", "japanese", "tokyo"],
  DE: ["germany", "german", "berlin"],
  US: [
    "united states",
    "usa",
    "u.s.",
    "american",
    "washington"
  ],
  IT: ["italy", "italian", "rome"],
  GB: [
    "united kingdom",
    "uk",
    "u.k.",
    "britain",
    "british",
    "london"
  ],
  CN: ["china", "chinese", "beijing"],
  KR: [
    "south korea",
    "korea",
    "korean",
    "seoul"
  ],
  FR: ["france", "french", "paris"],
  SE: ["sweden", "swedish", "stockholm"],
  HR: ["croatia", "croatian", "zagreb"]
};

const COUNTRY_MATCH_METHODS = {
  TITLE_ALIAS: "TITLE_ALIAS",
  SNIPPET_ALIAS: "SNIPPET_ALIAS",
  QUERY_CONTEXT: "QUERY_CONTEXT"
};

const COUNTRY_MATCH_CONFIDENCE = {
  TITLE_ALIAS: 1.0,
  SNIPPET_ALIAS: 0.8,
  QUERY_CONTEXT: 0.55
};

const NEWS_RUN_LIMITS = {
  MAX_COUNTRIES: { min: 1, max: 10, fallback: 10 },
  MAX_QUERIES_PER_COUNTRY: { min: 1, max: 5, fallback: 5 },
  MAX_ITEMS_PER_QUERY: { min: 5, max: 50, fallback: 20 },
  MAX_AGE_HOURS_ALLOWED: [24, 72, 168],
  MAX_AGE_HOURS_FALLBACK: 72,
  MAX_COUNTRY_CODES: 10
};

function getCountryAliases(countryCode) {
  const code = String(countryCode || "")
    .trim()
    .toUpperCase();

  return COUNTRY_ALIASES[code] || null;
}

// A query keeps only safe characters so nothing can smuggle
// provider operators or URL structure through a country
// name.
function sanitizeQueryTerm(term) {
  return String(term || "")
    .replace(/[^\p{L}\p{N} .'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCountryQueries(
  country,
  {
    maxQueriesPerCountry =
      NEWS_RUN_LIMITS.MAX_QUERIES_PER_COUNTRY.fallback
  } = {}
) {
  const countryName = sanitizeQueryTerm(
    country.country_name || country.name
  );

  if (!countryName) {
    return [];
  }

  const queries = [];

  for (const group of QUERY_GROUPS) {
    if (queries.length >= maxQueriesPerCountry) {
      break;
    }

    const terms = QUERY_GROUP_TERMS[group]
      .map(sanitizeQueryTerm)
      .filter(Boolean);

    const queryText =
      terms.length === 0
        ? countryName
        : `${countryName} (${terms.join(" OR ")})`;

    queries.push({
      queryKey: group,
      queryText
    });
  }

  return queries;
}

function clampInteger(value, { min, max, fallback }) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizeNewsRunPayload(payload = {}) {
  const requestedAgeHours = Number(payload.max_age_hours);

  const maxAgeHours =
    NEWS_RUN_LIMITS.MAX_AGE_HOURS_ALLOWED.includes(
      requestedAgeHours
    )
      ? requestedAgeHours
      : NEWS_RUN_LIMITS.MAX_AGE_HOURS_FALLBACK;

  const countryCodes = Array.isArray(payload.country_codes)
    ? [
        ...new Set(
          payload.country_codes
            .map(value =>
              String(value).trim().toUpperCase()
            )
            .filter(value => /^[A-Z]{2}$/.test(value))
        )
      ].slice(0, NEWS_RUN_LIMITS.MAX_COUNTRY_CODES)
    : null;

  return {
    maxCountries: clampInteger(
      payload.max_countries,
      NEWS_RUN_LIMITS.MAX_COUNTRIES
    ),

    maxQueriesPerCountry: clampInteger(
      payload.max_queries_per_country,
      NEWS_RUN_LIMITS.MAX_QUERIES_PER_COUNTRY
    ),

    maxItemsPerQuery: clampInteger(
      payload.max_items_per_query,
      NEWS_RUN_LIMITS.MAX_ITEMS_PER_QUERY
    ),

    maxAgeHours,

    countryCodes:
      countryCodes && countryCodes.length > 0
        ? countryCodes
        : null
  };
}

module.exports = {
  COUNTRY_ALIASES,
  COUNTRY_MATCH_CONFIDENCE,
  COUNTRY_MATCH_METHODS,
  NEWS_RUN_LIMITS,
  QUERY_GROUPS,
  QUERY_GROUP_TERMS,
  buildCountryQueries,
  getCountryAliases,
  normalizeNewsRunPayload,
  sanitizeQueryTerm
};

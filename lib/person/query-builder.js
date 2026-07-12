// =========================================================
// PERSON QUERY BUILDER — Task 3.3E
//
// Deterministic person-centric news queries. Every query
// carries the quoted canonical person name; the radar
// never searches a bare brand ("Xiaomi") because that
// would degrade into brand news, not person news.
// =========================================================

const PERSON_QUERY_KEYS = [
  "PERSON",
  "PERSON_BRAND",
  "PERSON_MODEL",
  "PERSON_VEHICLE_TOPIC"
];

const PERSON_RUN_LIMITS = {
  MAX_PEOPLE: { min: 1, max: 30, fallback: 20 },
  VEHICLE_WINDOW_DAYS_ALLOWED: [3, 7, 14, 30],
  VEHICLE_WINDOW_DAYS_FALLBACK: 14,
  MAX_QUERIES_PER_PERSON: { min: 1, max: 4, fallback: 3 },
  MAX_ITEMS_PER_QUERY: { min: 5, max: 50, fallback: 20 },
  MAX_AGE_HOURS_ALLOWED: [24, 72, 168],
  MAX_AGE_HOURS_FALLBACK: 72,
  MAX_PERSON_SELECTORS: 30
};

// Keeps only characters that are safe inside a provider
// query so nothing can smuggle operators or URL structure.
function sanitizeQueryTerm(term) {
  return String(term || "")
    .replace(/[^\p{L}\p{N} .'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPersonQueries(
  personSummary,
  {
    maxQueriesPerPerson =
      PERSON_RUN_LIMITS.MAX_QUERIES_PER_PERSON.fallback
  } = {}
) {
  const personName = sanitizeQueryTerm(
    personSummary.canonical_name ||
    personSummary.canonicalName
  );

  if (!personName) {
    return [];
  }

  const quotedName = `"${personName}"`;

  const brands = (
    personSummary.linked_brands ||
    personSummary.linkedBrands ||
    []
  )
    .map(sanitizeQueryTerm)
    .filter(Boolean);

  const models = (
    personSummary.linked_models ||
    personSummary.linkedModels ||
    []
  )
    .map(sanitizeQueryTerm)
    .filter(Boolean);

  const series = (
    personSummary.linked_series ||
    personSummary.linkedSeries ||
    []
  )
    .map(sanitizeQueryTerm)
    .filter(Boolean);

  const primaryBrand = brands[0] || null;
  const primaryModel = models[0] || series[0] || null;

  const candidates = [
    {
      queryKey: "PERSON",
      queryText: quotedName
    }
  ];

  if (primaryBrand) {
    candidates.push({
      queryKey: "PERSON_BRAND",
      queryText: `${quotedName} ${primaryBrand}`
    });
  }

  if (primaryBrand && primaryModel) {
    candidates.push({
      queryKey: "PERSON_MODEL",
      queryText:
        `${quotedName} ${primaryBrand} ${primaryModel}`
    });
  }

  candidates.push({
    queryKey: "PERSON_VEHICLE_TOPIC",
    queryText: `${quotedName} car automotive`
  });

  return candidates.slice(0, maxQueriesPerPerson);
}

function clampInteger(value, { min, max, fallback }) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizeSelectorList(value, transform) {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = [
    ...new Set(
      value
        .map(item => transform(String(item).trim()))
        .filter(Boolean)
    )
  ].slice(0, PERSON_RUN_LIMITS.MAX_PERSON_SELECTORS);

  return normalized.length > 0 ? normalized : null;
}

function normalizePersonRunPayload(payload = {}) {
  const requestedWindow = Number(
    payload.vehicle_window_days
  );

  const vehicleWindowDays =
    PERSON_RUN_LIMITS.VEHICLE_WINDOW_DAYS_ALLOWED.includes(
      requestedWindow
    )
      ? requestedWindow
      : PERSON_RUN_LIMITS.VEHICLE_WINDOW_DAYS_FALLBACK;

  const requestedAgeHours = Number(
    payload.max_age_hours
  );

  const maxAgeHours =
    PERSON_RUN_LIMITS.MAX_AGE_HOURS_ALLOWED.includes(
      requestedAgeHours
    )
      ? requestedAgeHours
      : PERSON_RUN_LIMITS.MAX_AGE_HOURS_FALLBACK;

  return {
    maxPeople: clampInteger(
      payload.max_people,
      PERSON_RUN_LIMITS.MAX_PEOPLE
    ),

    vehicleWindowDays,

    maxQueriesPerPerson: clampInteger(
      payload.max_queries_per_person,
      PERSON_RUN_LIMITS.MAX_QUERIES_PER_PERSON
    ),

    maxItemsPerQuery: clampInteger(
      payload.max_items_per_query,
      PERSON_RUN_LIMITS.MAX_ITEMS_PER_QUERY
    ),

    maxAgeHours,

    personIds: normalizeSelectorList(
      payload.person_ids,
      value => (/^[0-9]+$/.test(value) ? value : null)
    ),

    personSlugs: normalizeSelectorList(
      payload.person_slugs,
      value =>
        /^[a-z0-9-]+$/.test(value) ? value : null
    )
  };
}

module.exports = {
  PERSON_QUERY_KEYS,
  PERSON_RUN_LIMITS,
  buildPersonQueries,
  normalizePersonRunPayload,
  sanitizeQueryTerm
};

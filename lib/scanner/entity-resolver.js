// =========================================================
// VEHICLE ENTITY RESOLVER — Task 3.3C
//
// Deterministic rule-based resolver. It only anchors a
// vehicle entity onto a Short; it never touches views,
// viral tiers, qualification, rank score, or sorting.
// =========================================================

const {
  BRAND_CATALOG,
  MODEL_CATALOG,
  SERIES_CATALOG,
  VEHICLE_TYPES
} = require("./vehicle-catalog");

const RESOLVER_VERSION = "vehicle-rules-v1";

const ENTITY_STATUSES = {
  RESOLVED: "RESOLVED",
  BRAND_ONLY: "BRAND_ONLY",
  AMBIGUOUS: "AMBIGUOUS",
  UNRESOLVED: "UNRESOLVED",
  NOT_APPLICABLE: "NOT_APPLICABLE"
};

const MATCH_METHODS = {
  MODEL_ALIAS: "MODEL_ALIAS",
  SERIES_ALIAS: "SERIES_ALIAS",
  BRAND_ALIAS: "BRAND_ALIAS",
  UNIQUE_MODEL_ALIAS: "UNIQUE_MODEL_ALIAS",
  SOURCE_PRIOR: "SOURCE_PRIOR",
  MANUAL: "MANUAL",
  NONE: "NONE"
};

const VEHICLE_ACTIONS = [
  "RACING",
  "DRIFTING",
  "DRAG_RACING",
  "ACCELERATION",
  "LAUNCH",
  "BURNOUT",
  "CRASH",
  "JUMP",
  "OFF_ROAD",
  "RESTORATION",
  "BUILD",
  "REVEAL",
  "COMPARISON",
  "TESTING",
  "REVIEW",
  "CHASE",
  "OTHER",
  "UNKNOWN"
];

// Deterministic scoring weights. Title beats tags beats
// description beats channel / source priors.
const SCORE_WEIGHTS = {
  MODEL_TITLE: 100,
  MODEL_TAGS: 85,
  MODEL_DESCRIPTION: 70,

  SERIES_TITLE: 80,
  SERIES_TAGS: 65,
  SERIES_DESCRIPTION: 50,

  BRAND_TITLE: 50,
  BRAND_TAGS: 40,
  BRAND_DESCRIPTION: 30,
  BRAND_CHANNEL: 15
};

const CONFIDENCE = {
  BRAND_AND_MODEL_IN_TITLE: 1.0,
  UNIQUE_MODEL_ALIAS: 0.95,
  BRAND_AND_SERIES: 0.85,
  BRAND_ONLY: 0.65,
  NONE: 0
};

// Two distinct top candidates closer than this margin
// cannot be separated reliably.
const AMBIGUITY_MARGIN = 15;

// Anything scoring below this is treated as no evidence.
const MIN_RESOLUTION_SCORE = 15;

// Description text considered by the resolver; evidence
// excerpts stay short so raw_metrics / evidence never
// carry full descriptions.
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_TAGS = 30;
const MAX_EVIDENCE_CANDIDATES = 3;

// Action detection: most specific action first so that
// "drag race" never falls through to generic RACING.
const ACTION_RULES = [
  ["DRAG_RACING", [
    "drag race",
    "drag racing",
    "drag battle",
    "drag strip",
    "quarter mile",
    "1 4 mile"
  ]],
  ["DRIFTING", [
    "drifting",
    "drifts",
    "drift"
  ]],
  ["LAUNCH", [
    "launch control",
    "hard launch",
    "launches",
    "launch"
  ]],
  ["BURNOUT", [
    "burnouts",
    "burnout"
  ]],
  ["CHASE", [
    "police chase",
    "car chase",
    "chase"
  ]],
  ["CRASH", [
    "crashes",
    "crashed",
    "crash",
    "wrecked",
    "wreck"
  ]],
  ["JUMP", [
    "jumps",
    "jumped",
    "jump"
  ]],
  ["OFF_ROAD", [
    "off roading",
    "off road",
    "offroad",
    "offroading"
  ]],
  ["RESTORATION", [
    "barn find",
    "restoration",
    "restored",
    "restoring",
    "rebuild"
  ]],
  ["BUILD", [
    "building",
    "build",
    "built"
  ]],
  ["REVEAL", [
    "world premiere",
    "first look",
    "revealed",
    "reveal",
    "unveiled",
    "debut"
  ]],
  ["COMPARISON", [
    "head to head",
    "comparison",
    "compared",
    "versus",
    "vs"
  ]],
  ["RACING", [
    "track battle",
    "racing",
    "races",
    "race"
  ]],
  ["ACCELERATION", [
    "acceleration",
    "top speed",
    "0 60",
    "0 100"
  ]],
  ["TESTING", [
    "testing",
    "tested",
    "test"
  ]],
  ["REVIEW", [
    "reviewed",
    "review"
  ]]
];

// Conflict keywords: canonical form first, then the raw
// variants that map to it. Output order is this catalog
// order, deduplicated.
const CONFLICT_KEYWORD_RULES = [
  ["comparison", ["vs", "versus"]],
  ["battle", ["battle"]],
  ["challenge", ["challenge"]],
  ["race", ["race", "racing"]],
  ["fastest", ["fastest"]],
  ["slowest", ["slowest"]],
  ["illegal", ["illegal"]],
  ["banned", ["banned"]],
  ["failure", ["fail", "fails", "failure"]],
  ["crash", ["crash", "crashes", "crashed"]],
  ["destroyed", ["destroyed", "destroys"]],
  ["broken", ["broken"]],
  ["dangerous", ["dangerous"]],
  ["extreme", ["extreme"]],
  ["insane", ["insane"]],
  ["secret", ["secret"]],
  ["rare", ["rare"]],
  ["last", ["last"]],
  ["first", ["first"]],
  ["unexpected", ["unexpected"]],
  ["police", ["police"]],
  ["chase", ["chase"]],
  ["cheap", ["cheap"]],
  ["expensive", ["expensive"]],
  ["stock", ["stock"]],
  ["modified", ["modified", "modded"]],
  ["electric", ["electric"]],
  ["combustion", ["combustion"]]
];

// Fallback vehicle-type keywords, used only when the model
// catalog does not already define a type. Brands never
// imply a type.
const VEHICLE_TYPE_KEYWORDS = [
  ["HYPERCAR", ["hypercar"]],
  ["SUPERCAR", ["supercar"]],
  ["MUSCLE_CAR", ["muscle car"]],
  ["RALLY_CAR", ["rally car", "rally"]],
  ["DRAG_CAR", ["drag car"]],
  ["OFF_ROAD", ["off roader", "off road truck"]],
  ["SUV", ["suv", "crossover"]],
  ["TRUCK", ["pickup truck", "pickup", "truck"]],
  ["WAGON", ["wagon", "estate"]],
  ["HATCHBACK", ["hatchback", "hot hatch"]],
  ["SEDAN", ["sedan", "saloon"]],
  ["COUPE", ["coupe"]],
  ["EV", ["electric car", "ev"]],
  ["CLASSIC", ["classic car", "barn find"]],
  ["SPORTS_CAR", ["sports car"]]
];

// ---------------------------------------------------------
// Normalization
// ---------------------------------------------------------

function normalizeEntityText(value) {
  return String(value ?? "")
    // Strip trademark symbols before NFKC turns them into
    // plain "tm" / "r" / "c" letters.
    .replace(/[™®©]/g, " ")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑‒–—―−-]/g, " ")
    .replace(/[/\\|_]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function padTokens(normalized) {
  return normalized ? ` ${normalized} ` : "";
}

function containsPhrase(paddedText, normalizedPhrase) {
  if (!paddedText || !normalizedPhrase) {
    return false;
  }

  return paddedText.includes(` ${normalizedPhrase} `);
}

// ---------------------------------------------------------
// Alias index
// ---------------------------------------------------------

function buildAliasList(entries, level) {
  const list = [];

  entries.forEach((entry, index) => {
    for (const alias of entry.aliases) {
      const normalized = normalizeEntityText(alias);

      if (!normalized) {
        continue;
      }

      list.push({
        alias,
        normalized,
        tokenCount: normalized.split(" ").length,
        level,
        entryIndex: index,
        entry
      });
    }
  });

  // Longest alias first: token count, then raw length.
  list.sort((a, b) =>
    b.tokenCount - a.tokenCount ||
    b.normalized.length - a.normalized.length
  );

  return list;
}

const MODEL_ALIASES = buildAliasList(MODEL_CATALOG, "model");
const SERIES_ALIASES = buildAliasList(SERIES_CATALOG, "series");
const BRAND_ALIASES = buildAliasList(BRAND_CATALOG, "brand");

// alias text -> how many distinct models share it
const MODEL_ALIAS_OWNERS = MODEL_ALIASES.reduce(
  (owners, item) => {
    const models =
      owners.get(item.normalized) ?? new Set();

    models.add(
      `${item.entry.brand}::${item.entry.model}`
    );

    owners.set(item.normalized, models);

    return owners;
  },
  new Map()
);

// ---------------------------------------------------------
// Span-consuming matcher: longest alias wins, a consumed
// span can never be re-matched by a shorter alias.
// ---------------------------------------------------------

function findMatches(aliasList, paddedText, consumedRanges) {
  const matches = [];

  if (!paddedText) {
    return matches;
  }

  for (const item of aliasList) {
    const needle = ` ${item.normalized} `;

    let searchFrom = 0;

    while (searchFrom < paddedText.length) {
      const start = paddedText.indexOf(needle, searchFrom);

      if (start === -1) {
        break;
      }

      // Exclude the padding spaces so two aliases that sit
      // next to each other do not falsely overlap.
      const tokenStart = start + 1;
      const tokenEnd = start + needle.length - 1;

      const overlaps = consumedRanges.some(
        range =>
          tokenStart < range.end &&
          tokenEnd > range.start
      );

      if (!overlaps) {
        consumedRanges.push({
          start: tokenStart,
          end: tokenEnd
        });
        matches.push(item);
        break;
      }

      searchFrom = start + 1;
    }
  }

  return matches;
}

function matchBrandsAnywhere(paddedText) {
  const matched = [];

  for (const item of BRAND_ALIASES) {
    if (containsPhrase(paddedText, item.normalized)) {
      matched.push(item);
    }
  }

  return matched;
}

// ---------------------------------------------------------
// Action, conflict keywords, vehicle type
// ---------------------------------------------------------

function detectAction(paddedFields) {
  for (const [action, phrases] of ACTION_RULES) {
    for (const phrase of phrases) {
      const normalized = normalizeEntityText(phrase);

      for (const padded of paddedFields) {
        if (containsPhrase(padded, normalized)) {
          return {
            action,
            matchedPhrase: phrase
          };
        }
      }
    }
  }

  return {
    action: "UNKNOWN",
    matchedPhrase: null
  };
}

function extractConflictKeywords(paddedFields) {
  const canonical = [];
  const rawTerms = [];

  for (const [keyword, variants] of CONFLICT_KEYWORD_RULES) {
    let hit = false;

    for (const variant of variants) {
      const normalized = normalizeEntityText(variant);

      for (const padded of paddedFields) {
        if (containsPhrase(padded, normalized)) {
          hit = true;

          if (!rawTerms.includes(variant)) {
            rawTerms.push(variant);
          }

          break;
        }
      }
    }

    if (hit && !canonical.includes(keyword)) {
      canonical.push(keyword);
    }
  }

  return {
    canonical,
    rawTerms
  };
}

function detectVehicleType(catalogType, paddedFields) {
  if (
    catalogType &&
    catalogType !== "UNKNOWN" &&
    VEHICLE_TYPES.includes(catalogType)
  ) {
    return catalogType;
  }

  for (const [type, phrases] of VEHICLE_TYPE_KEYWORDS) {
    for (const phrase of phrases) {
      const normalized = normalizeEntityText(phrase);

      for (const padded of paddedFields) {
        if (containsPhrase(padded, normalized)) {
          return type;
        }
      }
    }
  }

  return "UNKNOWN";
}

// ---------------------------------------------------------
// Candidate scoring
// ---------------------------------------------------------

function brandBonus(brand, brandMatchesByField) {
  if (brandMatchesByField.title.has(brand)) {
    return SCORE_WEIGHTS.BRAND_TITLE;
  }

  if (brandMatchesByField.tags.has(brand)) {
    return SCORE_WEIGHTS.BRAND_TAGS;
  }

  if (brandMatchesByField.description.has(brand)) {
    return SCORE_WEIGHTS.BRAND_DESCRIPTION;
  }

  if (brandMatchesByField.channel.has(brand)) {
    return SCORE_WEIGHTS.BRAND_CHANNEL;
  }

  return 0;
}

function candidateKey(candidate) {
  return [
    candidate.brand,
    candidate.series ?? "",
    candidate.model ?? "",
    candidate.level
  ].join("::");
}

function isCompatible(top, other) {
  if (top.brand !== other.brand) {
    return false;
  }

  if (other.level !== "model") {
    // Same-brand series / brand candidate supports the
    // model candidate instead of competing with it.
    return true;
  }

  return top.model === other.model;
}

// ---------------------------------------------------------
// Main resolver
// ---------------------------------------------------------

function resolveVehicleEntity(input = {}) {
  const {
    isShort = true,
    title = "",
    channelTitle = "",
    sourceName = "",
    description = "",
    tags = []
  } = input;

  if (!isShort) {
    return {
      status: ENTITY_STATUSES.NOT_APPLICABLE,
      confidence: null,
      matchMethod: MATCH_METHODS.NONE,
      brand: null,
      series: null,
      model: null,
      countryCode: null,
      vehicleType: null,
      action: null,
      conflictKeywords: [],
      matchedAliases: [],
      candidates: [],
      evidence: {
        reason: "NOT_SHORT"
      },
      resolverVersion: RESOLVER_VERSION
    };
  }

  const safeTags = (Array.isArray(tags) ? tags : [])
    .slice(0, MAX_TAGS)
    .map(tag => normalizeEntityText(tag))
    .filter(Boolean);

  const normalizedTitle = normalizeEntityText(title);

  const normalizedDescription = normalizeEntityText(
    String(description ?? "").slice(
      0,
      MAX_DESCRIPTION_LENGTH
    )
  );

  const normalizedChannel = normalizeEntityText(
    [channelTitle, sourceName]
      .filter(Boolean)
      .join(" ")
  );

  const paddedTitle = padTokens(normalizedTitle);
  const paddedTags = safeTags.map(padTokens);
  const paddedDescription = padTokens(normalizedDescription);
  const paddedChannel = padTokens(normalizedChannel);

  const textFields = [
    paddedTitle,
    ...paddedTags,
    paddedDescription
  ];

  // --- model + series alias matching (span consuming) ---

  const matchedAliases = [];

  function collectEntityMatches(padded, fieldName) {
    const consumed = [];

    const modelMatches = findMatches(
      MODEL_ALIASES,
      padded,
      consumed
    );

    const seriesMatches = findMatches(
      SERIES_ALIASES,
      padded,
      consumed
    );

    for (const match of [...modelMatches, ...seriesMatches]) {
      matchedAliases.push({
        alias: match.alias,
        level: match.level,
        field: fieldName,
        brand: match.entry.brand
      });
    }

    return {
      modelMatches,
      seriesMatches
    };
  }

  const titleMatches = collectEntityMatches(
    paddedTitle,
    "title"
  );

  const tagMatches = paddedTags.map(padded =>
    collectEntityMatches(padded, "tags")
  );

  const descriptionMatches = collectEntityMatches(
    paddedDescription,
    "description"
  );

  // --- brand matching (independent, no consumption) ---

  const brandMatchesByField = {
    title: new Set(),
    tags: new Set(),
    description: new Set(),
    channel: new Set()
  };

  for (const item of matchBrandsAnywhere(paddedTitle)) {
    brandMatchesByField.title.add(item.entry.brand);

    matchedAliases.push({
      alias: item.alias,
      level: "brand",
      field: "title",
      brand: item.entry.brand
    });
  }

  for (const padded of paddedTags) {
    for (const item of matchBrandsAnywhere(padded)) {
      brandMatchesByField.tags.add(item.entry.brand);

      matchedAliases.push({
        alias: item.alias,
        level: "brand",
        field: "tags",
        brand: item.entry.brand
      });
    }
  }

  for (const item of matchBrandsAnywhere(paddedDescription)) {
    brandMatchesByField.description.add(item.entry.brand);

    matchedAliases.push({
      alias: item.alias,
      level: "brand",
      field: "description",
      brand: item.entry.brand
    });
  }

  for (const item of matchBrandsAnywhere(paddedChannel)) {
    brandMatchesByField.channel.add(item.entry.brand);

    matchedAliases.push({
      alias: item.alias,
      level: "brand",
      field: "channel",
      brand: item.entry.brand
    });
  }

  // --- build candidates ---

  const candidateMap = new Map();

  function addCandidate(candidate) {
    const key = candidateKey(candidate);
    const existing = candidateMap.get(key);

    if (!existing || candidate.score > existing.score) {
      candidateMap.set(key, {
        ...existing,
        ...candidate,
        aliasInTitle:
          (existing?.aliasInTitle ?? false) ||
          candidate.aliasInTitle
      });
    } else if (candidate.aliasInTitle) {
      existing.aliasInTitle = true;
    }
  }

  function addModelOrSeriesMatches(
    matches,
    fieldWeights,
    fromTitle
  ) {
    for (const match of matches.modelMatches) {
      const entry = match.entry;

      addCandidate({
        level: "model",
        brand: entry.brand,
        series: entry.series,
        model: entry.model,
        countryCode: entry.countryCode,
        vehicleType: entry.vehicleType,
        matchedAlias: match.normalized,
        aliasInTitle: fromTitle,
        score:
          fieldWeights.model +
          brandBonus(entry.brand, brandMatchesByField)
      });
    }

    for (const match of matches.seriesMatches) {
      const entry = match.entry;

      addCandidate({
        level: "series",
        brand: entry.brand,
        series: entry.series,
        model: null,
        countryCode: entry.countryCode,
        vehicleType: entry.vehicleType ?? null,
        matchedAlias: match.normalized,
        aliasInTitle: fromTitle,
        score: fieldWeights.series
      });
    }
  }

  addModelOrSeriesMatches(
    titleMatches,
    {
      model: SCORE_WEIGHTS.MODEL_TITLE,
      series: SCORE_WEIGHTS.SERIES_TITLE
    },
    true
  );

  for (const matches of tagMatches) {
    addModelOrSeriesMatches(
      matches,
      {
        model: SCORE_WEIGHTS.MODEL_TAGS,
        series: SCORE_WEIGHTS.SERIES_TAGS
      },
      false
    );
  }

  addModelOrSeriesMatches(
    descriptionMatches,
    {
      model: SCORE_WEIGHTS.MODEL_DESCRIPTION,
      series: SCORE_WEIGHTS.SERIES_DESCRIPTION
    },
    false
  );

  // Brand-only candidates.
  const brandEntryByName = new Map(
    BRAND_CATALOG.map(entry => [entry.brand, entry])
  );

  const allMatchedBrands = new Set([
    ...brandMatchesByField.title,
    ...brandMatchesByField.tags,
    ...brandMatchesByField.description,
    ...brandMatchesByField.channel
  ]);

  for (const brand of allMatchedBrands) {
    const entry = brandEntryByName.get(brand);

    const score = brandBonus(
      brand,
      brandMatchesByField
    );

    const viaContentText =
      brandMatchesByField.title.has(brand) ||
      brandMatchesByField.tags.has(brand) ||
      brandMatchesByField.description.has(brand);

    addCandidate({
      level: "brand",
      brand,
      series: null,
      model: null,
      countryCode: entry.countryCode,
      vehicleType: null,
      matchedAlias: normalizeEntityText(brand),
      aliasInTitle: brandMatchesByField.title.has(brand),
      viaContentText,
      score
    });
  }

  const candidates = [...candidateMap.values()].sort(
    (a, b) => b.score - a.score
  );

  // --- action / conflict / shared evidence ---

  const actionResult = detectAction(textFields);
  const conflictResult = extractConflictKeywords(textFields);

  const evidence = {
    matched_aliases: matchedAliases.slice(0, 20),
    candidates: candidates
      .slice(0, MAX_EVIDENCE_CANDIDATES)
      .map(candidate => ({
        level: candidate.level,
        brand: candidate.brand,
        series: candidate.series,
        model: candidate.model,
        score: candidate.score
      })),
    action_phrase: actionResult.matchedPhrase,
    conflict_terms_raw: conflictResult.rawTerms,
    title_excerpt: String(title ?? "").slice(0, 120)
  };

  const base = {
    action: actionResult.action,
    conflictKeywords: conflictResult.canonical,
    matchedAliases,
    candidates: candidates.slice(0, 5),
    evidence,
    resolverVersion: RESOLVER_VERSION
  };

  const top = candidates[0];

  if (!top || top.score < MIN_RESOLUTION_SCORE) {
    return {
      status: ENTITY_STATUSES.UNRESOLVED,
      confidence: CONFIDENCE.NONE,
      matchMethod: MATCH_METHODS.NONE,
      brand: null,
      series: null,
      model: null,
      countryCode: null,
      vehicleType: detectVehicleType(null, textFields),
      ...base
    };
  }

  // Ambiguity: an incompatible candidate too close to the
  // top one means no reliable single answer.
  const rival = candidates.find(
    candidate =>
      candidate !== top &&
      !isCompatible(top, candidate) &&
      top.score - candidate.score < AMBIGUITY_MARGIN
  );

  if (rival) {
    evidence.ambiguous_between = [
      candidateKey(top),
      candidateKey(rival)
    ];

    return {
      status: ENTITY_STATUSES.AMBIGUOUS,
      confidence: CONFIDENCE.NONE,
      matchMethod: MATCH_METHODS.NONE,
      brand: null,
      series: null,
      model: null,
      countryCode: null,
      vehicleType: detectVehicleType(null, textFields),
      ...base
    };
  }

  const brandMatched = allMatchedBrands.has(top.brand);

  if (top.level === "model") {
    const aliasOwners =
      MODEL_ALIAS_OWNERS.get(top.matchedAlias);

    const aliasIsUnique =
      aliasOwners !== undefined &&
      aliasOwners.size === 1;

    let confidence;
    let matchMethod;

    if (brandMatched && top.aliasInTitle) {
      confidence = CONFIDENCE.BRAND_AND_MODEL_IN_TITLE;
      matchMethod = MATCH_METHODS.MODEL_ALIAS;
    } else if (aliasIsUnique) {
      confidence = CONFIDENCE.UNIQUE_MODEL_ALIAS;
      matchMethod = MATCH_METHODS.UNIQUE_MODEL_ALIAS;
    } else {
      confidence = CONFIDENCE.UNIQUE_MODEL_ALIAS;
      matchMethod = MATCH_METHODS.MODEL_ALIAS;
    }

    return {
      status: ENTITY_STATUSES.RESOLVED,
      confidence,
      matchMethod,
      brand: top.brand,
      series: top.series,
      model: top.model,
      countryCode: top.countryCode,
      vehicleType: detectVehicleType(
        top.vehicleType,
        textFields
      ),
      ...base
    };
  }

  if (top.level === "series") {
    return {
      status: ENTITY_STATUSES.RESOLVED,
      confidence: CONFIDENCE.BRAND_AND_SERIES,
      matchMethod: MATCH_METHODS.SERIES_ALIAS,
      brand: top.brand,
      series: top.series,
      model: null,
      countryCode: top.countryCode,
      vehicleType: detectVehicleType(
        top.vehicleType,
        textFields
      ),
      ...base
    };
  }

  // Brand only.
  return {
    status: ENTITY_STATUSES.BRAND_ONLY,
    confidence: CONFIDENCE.BRAND_ONLY,
    matchMethod: top.viaContentText
      ? MATCH_METHODS.BRAND_ALIAS
      : MATCH_METHODS.SOURCE_PRIOR,
    brand: top.brand,
    series: null,
    model: null,
    countryCode: top.countryCode,
    vehicleType: detectVehicleType(null, textFields),
    ...base
  };
}

module.exports = {
  ACTION_RULES,
  AMBIGUITY_MARGIN,
  CONFIDENCE,
  CONFLICT_KEYWORD_RULES,
  ENTITY_STATUSES,
  MATCH_METHODS,
  MIN_RESOLUTION_SCORE,
  RESOLVER_VERSION,
  SCORE_WEIGHTS,
  VEHICLE_ACTIONS,
  normalizeEntityText,
  resolveVehicleEntity
};

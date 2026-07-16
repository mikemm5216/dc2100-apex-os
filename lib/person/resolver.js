// =========================================================
// VEHICLE-PERSON RESOLVER — Task 3.3E
//
// Deterministic rule-based resolver from vehicle Shorts to
// catalog public people. Resolution order:
//
//   exact full alias in title
//   → alias in tags
//   → alias in description
//   → model association
//   → series association
//   → brand association
//
// Only canonical catalog people can be resolved. No free
// NER, no guessing of unknown private identities.
// =========================================================

const {
  PERSON_CATALOG
} = require("./person-catalog");

const {
  aliasMatchesNormalizedText,
  normalizePersonText
} = require("./normalization");

const PERSON_RESOLVER_VERSION =
  "vehicle-person-rules-v1";

// Direct-mention confidence by field, applied when the
// signal's vehicle matches one of the person's catalog
// associations. Without a matching vehicle the confidence
// is capped at NO_VEHICLE_MATCH_CAP.
const DIRECT_MENTION_CONFIDENCE = {
  TITLE: 1.0,
  TAGS: 0.95,
  DESCRIPTION: 0.85
};

const ASSOCIATION_CONFIDENCE = {
  MODEL: 0.85,
  SERIES: 0.75,
  BRAND: 0.65
};

const NO_VEHICLE_MATCH_CAP = 0.8;

// When only a brand association ties people to a signal,
// at most this many catalog people are kept per brand,
// ranked by association confidence, catalog priority, and
// name.
const MAX_BRAND_ASSOCIATION_PEOPLE_PER_BRAND = 3;

const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_TAGS = 30;

function normalizeValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function associationMatchesVehicle(
  association,
  { brand, series, model }
) {
  const associationBrand = normalizeValue(
    association.brand
  );

  if (
    !associationBrand ||
    associationBrand !== normalizeValue(brand)
  ) {
    return { matches: false, level: null };
  }

  const associationModel = normalizeValue(
    association.model
  );

  if (
    associationModel &&
    associationModel === normalizeValue(model)
  ) {
    return { matches: true, level: "model" };
  }

  const associationSeries = normalizeValue(
    association.series
  );

  if (
    associationSeries &&
    associationSeries === normalizeValue(series)
  ) {
    return { matches: true, level: "series" };
  }

  // Brand matches, but the association is narrower than
  // the signal (or the signal is broader). A brand-level
  // association (no series/model) is a plain brand match;
  // a narrower association still counts as brand-level
  // evidence.
  return { matches: true, level: "brand" };
}

function bestAssociationMatch(person, vehicle) {
  let best = null;

  for (const association of person.associations) {
    const match = associationMatchesVehicle(
      association,
      vehicle
    );

    if (!match.matches) {
      continue;
    }

    const rank =
      match.level === "model"
        ? 3
        : match.level === "series"
          ? 2
          : 1;

    if (
      !best ||
      rank > best.rank ||
      (rank === best.rank &&
        Number(association.confidence) >
          Number(best.association.confidence))
    ) {
      best = { association, level: match.level, rank };
    }
  }

  return best;
}

// Resolves catalog people for ONE vehicle signal. Returns
// an array of independent candidates; multiple plausible
// people are all kept, each with its own confidence and
// evidence.
function resolvePersonsForVehicleSignal(input = {}) {
  const {
    title = "",
    description = "",
    tags = [],
    channelTitle = "",
    sourceName = "",
    vehicleBrand = null,
    vehicleSeries = null,
    vehicleModel = null,
    resolvedVehicleId = null,
    vehicleAction = null,
    vehicleCountryCode = null,
    catalog = PERSON_CATALOG
  } = input;

  const normalizedTitle = normalizePersonText(title);

  const normalizedDescription = normalizePersonText(
    String(description ?? "").slice(
      0,
      MAX_DESCRIPTION_LENGTH
    )
  );

  const normalizedTags = (Array.isArray(tags) ? tags : [])
    .slice(0, MAX_TAGS)
    .map(tag => normalizePersonText(tag))
    .filter(Boolean);

  const vehicle = {
    brand: vehicleBrand,
    series: vehicleSeries,
    model: vehicleModel
  };

  const results = [];
  const brandOnlyBuckets = new Map();

  for (const person of catalog) {
    const associationMatch = bestAssociationMatch(
      person,
      vehicle
    );

    // --- direct mention detection ---

    let directField = null;
    let matchedAlias = null;

    for (const alias of person.aliases) {
      if (
        aliasMatchesNormalizedText(
          normalizedTitle,
          alias
        )
      ) {
        directField = "title";
        matchedAlias = alias;
        break;
      }
    }

    if (!directField) {
      for (const alias of person.aliases) {
        if (
          normalizedTags.some(tag =>
            aliasMatchesNormalizedText(tag, alias)
          )
        ) {
          directField = "tags";
          matchedAlias = alias;
          break;
        }
      }
    }

    if (!directField) {
      for (const alias of person.aliases) {
        if (
          aliasMatchesNormalizedText(
            normalizedDescription,
            alias
          )
        ) {
          directField = "description";
          matchedAlias = alias;
          break;
        }
      }
    }

    if (directField) {
      const fieldConfidence =
        directField === "title"
          ? DIRECT_MENTION_CONFIDENCE.TITLE
          : directField === "tags"
            ? DIRECT_MENTION_CONFIDENCE.TAGS
            : DIRECT_MENTION_CONFIDENCE.DESCRIPTION;

      const vehicleMatched = Boolean(associationMatch);

      const linkConfidence = vehicleMatched
        ? fieldConfidence
        : Math.min(
            fieldConfidence,
            NO_VEHICLE_MATCH_CAP
          );

      const association = vehicleMatched
        ? associationMatch.association
        : person.associations[0];

      results.push({
        person,
        directMention: true,
        linkedVehicles: [
          {
            brand: vehicleMatched
              ? vehicleBrand
              : association.brand,
            series: vehicleMatched
              ? vehicleSeries
              : association.series,
            model: vehicleMatched
              ? vehicleModel
              : association.model,
            resolvedVehicleId: vehicleMatched
              ? resolvedVehicleId
              : null
          }
        ],
        relationTypes: [association.relationType],
        linkConfidence,
        linkMethod: "DIRECT_MENTION",
        evidence: {
          matched_alias: matchedAlias,
          field: directField,
          vehicle_matched: vehicleMatched,
          vehicle_brand: vehicleBrand,
          vehicle_model: vehicleModel,
          vehicle_action: vehicleAction,
          vehicle_country: vehicleCountryCode,
          title_excerpt: String(title ?? "").slice(
            0,
            120
          ),
          association_source: association.source || null
        },
        resolverVersion: PERSON_RESOLVER_VERSION
      });

      continue;
    }

    // --- association-only candidates ---

    if (!associationMatch) {
      continue;
    }

    const { association, level } = associationMatch;

    const linkConfidence =
      level === "model"
        ? ASSOCIATION_CONFIDENCE.MODEL
        : level === "series"
          ? ASSOCIATION_CONFIDENCE.SERIES
          : ASSOCIATION_CONFIDENCE.BRAND;

    const candidate = {
      person,
      directMention: false,
      linkedVehicles: [
        {
          brand: vehicleBrand,
          series: vehicleSeries,
          model: vehicleModel,
          resolvedVehicleId
        }
      ],
      relationTypes: [association.relationType],
      linkConfidence: Math.min(
        linkConfidence,
        Number(association.confidence)
      ),
      linkMethod:
        level === "brand"
          ? "BRAND_ASSOCIATION"
          : "MODEL_ASSOCIATION",
      evidence: {
        association_level: level,
        association_brand: association.brand,
        association_series: association.series,
        association_model: association.model,
        association_confidence: Number(
          association.confidence
        ),
        association_source: association.source || null,
        vehicle_brand: vehicleBrand,
        vehicle_series: vehicleSeries,
        vehicle_model: vehicleModel,
        vehicle_action: vehicleAction,
        vehicle_country: vehicleCountryCode,
        title_excerpt: String(title ?? "").slice(
          0,
          120
        )
      },
      resolverVersion: PERSON_RESOLVER_VERSION
    };

    if (level === "brand") {
      const brandKey = normalizeValue(vehicleBrand);

      if (!brandOnlyBuckets.has(brandKey)) {
        brandOnlyBuckets.set(brandKey, []);
      }

      brandOnlyBuckets.get(brandKey).push(candidate);
    } else {
      results.push(candidate);
    }
  }

  // Brand-only associations are capped per brand so a
  // popular brand never floods the radar with every
  // loosely related catalog person.
  for (const bucket of brandOnlyBuckets.values()) {
    bucket.sort(
      (a, b) =>
        b.linkConfidence - a.linkConfidence ||
        a.person.priority - b.person.priority ||
        a.person.canonicalName.localeCompare(
          b.person.canonicalName
        )
    );

    results.push(
      ...bucket.slice(
        0,
        MAX_BRAND_ASSOCIATION_PEOPLE_PER_BRAND
      )
    );
  }

  results.sort(
    (a, b) =>
      Number(b.directMention) -
        Number(a.directMention) ||
      b.linkConfidence - a.linkConfidence ||
      a.person.canonicalName.localeCompare(
        b.person.canonicalName
      )
  );

  return results;
}

// =========================================================
// RSS MENTION VERIFICATION
// =========================================================

const MENTION_MATCH_METHODS = {
  TITLE_ALIAS: "TITLE_ALIAS",
  SNIPPET_ALIAS: "SNIPPET_ALIAS",
  QUERY_CONTEXT: "QUERY_CONTEXT"
};

const MENTION_MATCH_CONFIDENCE = {
  TITLE_ALIAS: 1.0,
  SNIPPET_ALIAS: 0.8,
  QUERY_CONTEXT: 0.5
};

function resolvePersonMentionEvidence({
  title,
  snippet,
  aliases
}) {
  const normalizedTitle = normalizePersonText(title);

  for (const alias of aliases || []) {
    if (
      aliasMatchesNormalizedText(normalizedTitle, alias)
    ) {
      return {
        matchMethod:
          MENTION_MATCH_METHODS.TITLE_ALIAS,
        confidence:
          MENTION_MATCH_CONFIDENCE.TITLE_ALIAS,
        evidence: {
          matched_alias: alias,
          field: "title"
        }
      };
    }
  }

  const normalizedSnippet = normalizePersonText(snippet);

  for (const alias of aliases || []) {
    if (
      aliasMatchesNormalizedText(
        normalizedSnippet,
        alias
      )
    ) {
      return {
        matchMethod:
          MENTION_MATCH_METHODS.SNIPPET_ALIAS,
        confidence:
          MENTION_MATCH_CONFIDENCE.SNIPPET_ALIAS,
        evidence: {
          matched_alias: alias,
          field: "snippet"
        }
      };
    }
  }

  // No alias evidence: only the query context ties this
  // article to the person. Confidence is capped at 0.5 and
  // such mentions can never dominate the representative
  // headline.
  return {
    matchMethod: MENTION_MATCH_METHODS.QUERY_CONTEXT,
    confidence:
      MENTION_MATCH_CONFIDENCE.QUERY_CONTEXT,
    evidence: {
      matched_alias: null,
      field: "query"
    }
  };
}

module.exports = {
  ASSOCIATION_CONFIDENCE,
  DIRECT_MENTION_CONFIDENCE,
  MAX_BRAND_ASSOCIATION_PEOPLE_PER_BRAND,
  MENTION_MATCH_CONFIDENCE,
  MENTION_MATCH_METHODS,
  NO_VEHICLE_MATCH_CAP,
  PERSON_RESOLVER_VERSION,
  resolvePersonMentionEvidence,
  resolvePersonsForVehicleSignal
};

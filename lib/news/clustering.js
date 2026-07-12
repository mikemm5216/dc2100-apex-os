// =========================================================
// STORY CLUSTERING — Task 3.3D
//
// Deterministic same-story clustering. Mentions merge only
// within the same country, first by exact normalized
// headline, then by token similarity within a compatible
// publication window. Reruns attach to existing clusters
// instead of creating duplicates.
// =========================================================

const { createHash } = require("node:crypto");

const { tokenizeHeadline } = require("./normalization");

const CLUSTERING_RULES = {
  // Jaccard similarity required for a fuzzy merge.
  SIMILARITY_THRESHOLD: 0.78,

  // A headline must carry at least this many meaningful
  // tokens before fuzzy merging is allowed at all.
  MIN_MEANINGFUL_TOKENS: 3,

  // Mentions published farther apart than this cannot be
  // fuzzy-merged into the same story.
  MAX_MERGE_WINDOW_HOURS: 48,

  // Existing clusters newer than this are loaded and
  // reused on rerun.
  EXISTING_CLUSTER_WINDOW_DAYS: 7
};

function storyHash(countryCode, normalizedTitle) {
  return createHash("sha256")
    .update(
      `${String(countryCode).toUpperCase()}:${normalizedTitle}`
    )
    .digest("hex");
}

function jaccardSimilarity(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) {
    return 0;
  }

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersection = 0;

  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }

  const union = setA.size + setB.size - intersection;

  return union === 0 ? 0 : intersection / union;
}

function hoursBetween(dateA, dateB) {
  const timeA = new Date(dateA).getTime();
  const timeB = new Date(dateB).getTime();

  if (Number.isNaN(timeA) || Number.isNaN(timeB)) {
    return null;
  }

  return Math.abs(timeA - timeB) / 3600000;
}

// Numbers are strong event identity: two headlines whose
// numeric facts diverge describe different events and must
// not merge.
function extractNumbers(tokens) {
  return new Set(
    tokens.filter(token => /^[0-9][0-9.,%]*$/.test(token))
  );
}

function numbersCompatible(tokensA, tokensB) {
  const numbersA = extractNumbers(tokensA);
  const numbersB = extractNumbers(tokensB);

  if (numbersA.size === 0 || numbersB.size === 0) {
    return true;
  }

  for (const value of numbersA) {
    if (numbersB.has(value)) {
      return true;
    }
  }

  return false;
}

function canFuzzyMerge(candidate, cluster) {
  const candidateTokens = candidate.tokens;
  const clusterTokens = cluster.tokens;

  if (
    candidateTokens.length <
      CLUSTERING_RULES.MIN_MEANINGFUL_TOKENS ||
    clusterTokens.length <
      CLUSTERING_RULES.MIN_MEANINGFUL_TOKENS
  ) {
    return false;
  }

  if (
    candidate.publishedAt &&
    cluster.publishedAt
  ) {
    const gap = hoursBetween(
      candidate.publishedAt,
      cluster.publishedAt
    );

    if (
      gap !== null &&
      gap > CLUSTERING_RULES.MAX_MERGE_WINDOW_HOURS
    ) {
      return false;
    }
  }

  if (
    !numbersCompatible(candidateTokens, clusterTokens)
  ) {
    return false;
  }

  return (
    jaccardSimilarity(candidateTokens, clusterTokens) >=
    CLUSTERING_RULES.SIMILARITY_THRESHOLD
  );
}

// Assigns every mention of ONE country to a story cluster.
//
// mentions: [{
//   externalKey, normalizedTitle, title, publishedAt, ...
// }]
//
// existingClusters: [{
//   id, storyHash, canonicalTitle, publishedAt
// }] — previously persisted clusters for the same country.
//
// Returns { clusters } where each cluster carries:
//   storyHash, canonicalTitle, publishedAt, mentions,
//   existingClusterId (null when new), isNew
function clusterMentions(
  countryCode,
  mentions,
  existingClusters = []
) {
  const clusters = [];
  const byHash = new Map();

  for (const existing of existingClusters) {
    const canonical = existing.canonicalTitle;

    const cluster = {
      storyHash:
        existing.storyHash ||
        storyHash(countryCode, canonical),
      canonicalTitle: canonical,
      tokens: tokenizeHeadline(canonical),
      publishedAt: existing.publishedAt || null,
      mentions: [],
      existingClusterId: existing.id,
      isNew: false
    };

    clusters.push(cluster);
    byHash.set(cluster.storyHash, cluster);
  }

  // Deterministic input order: oldest first, ties by
  // external key, so canonical titles never depend on feed
  // arrival order.
  const orderedMentions = [...mentions].sort((a, b) => {
    const timeA = a.publishedAt
      ? new Date(a.publishedAt).getTime()
      : 0;

    const timeB = b.publishedAt
      ? new Date(b.publishedAt).getTime()
      : 0;

    if (timeA !== timeB) {
      return timeA - timeB;
    }

    return String(a.externalKey).localeCompare(
      String(b.externalKey)
    );
  });

  for (const mention of orderedMentions) {
    const candidate = {
      tokens: tokenizeHeadline(mention.normalizedTitle),
      publishedAt: mention.publishedAt || null
    };

    // Layer 1: exact normalized headline.
    const exactHash = storyHash(
      countryCode,
      mention.normalizedTitle
    );

    let target = byHash.get(exactHash) || null;

    // Layer 2: token similarity within the merge window.
    if (!target) {
      for (const cluster of clusters) {
        if (canFuzzyMerge(candidate, cluster)) {
          target = cluster;
          break;
        }
      }
    }

    if (!target) {
      target = {
        storyHash: exactHash,
        canonicalTitle: mention.normalizedTitle,
        tokens: candidate.tokens,
        publishedAt: mention.publishedAt || null,
        mentions: [],
        existingClusterId: null,
        isNew: true
      };

      clusters.push(target);
      byHash.set(exactHash, target);
    }

    target.mentions.push(mention);

    if (
      !target.publishedAt &&
      mention.publishedAt
    ) {
      target.publishedAt = mention.publishedAt;
    }
  }

  return {
    clusters: clusters.filter(
      cluster => cluster.mentions.length > 0
    )
  };
}

module.exports = {
  CLUSTERING_RULES,
  canFuzzyMerge,
  clusterMentions,
  jaccardSimilarity,
  storyHash
};

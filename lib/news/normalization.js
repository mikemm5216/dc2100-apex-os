// =========================================================
// HEADLINE NORMALIZATION — Task 3.3D
//
// Deterministic headline normalization used for exact
// dedup and story clustering. Publisher suffixes are only
// stripped when they match the RSS <source> name, so a
// headline that legitimately ends with another publisher
// name is never mutilated.
// =========================================================

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“"
};

function decodeEntities(value) {
  return String(value || "").replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (match, entity) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) {
        const codePoint = Number.parseInt(
          entity.slice(2),
          16
        );

        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }

      if (entity.startsWith("#")) {
        const codePoint = Number.parseInt(
          entity.slice(1),
          10
        );

        return Number.isFinite(codePoint)
          ? String.fromCodePoint(codePoint)
          : match;
      }

      return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
    }
  );
}

function stripHtml(value) {
  return decodeEntities(
    String(value || "").replace(/<[^>]*>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

// Removes a trailing " - Publisher" / " — Publisher" /
// " | Publisher" segment ONLY when it matches the feed's
// declared source name.
function stripPublisherSuffix(title, sourceName) {
  const cleanTitle = String(title || "").trim();
  const source = String(sourceName || "").trim();

  if (!cleanTitle || !source) {
    return cleanTitle;
  }

  const separators = /\s+(?:-|–|—|\|)\s+/g;

  let lastIndex = -1;
  let match;

  while ((match = separators.exec(cleanTitle)) !== null) {
    lastIndex = match.index;
  }

  if (lastIndex === -1) {
    return cleanTitle;
  }

  const suffix = cleanTitle
    .slice(lastIndex)
    .replace(/^\s+(?:-|–|—|\|)\s+/, "")
    .trim();

  if (
    suffix.toLowerCase() === source.toLowerCase()
  ) {
    return cleanTitle.slice(0, lastIndex).trim();
  }

  return cleanTitle;
}

function normalizeHeadline(title, sourceName) {
  let value = stripHtml(title);

  value = stripPublisherSuffix(value, sourceName);

  value = value
    // Trademark symbols must go BEFORE NFKC, which would
    // otherwise expand ™ into the letters "tm".
    .replace(/[™®©]/g, "")
    .normalize("NFKC")
    .toLowerCase()
    // Normalize every dash variant to a plain hyphen.
    .replace(/[‐-―−]/g, "-")
    // Normalize curly quotes.
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // Protect separators inside numbers (5,000 / 3.5) so
    // meaningful numbers survive punctuation removal.
    .replace(/([0-9])[.,]([0-9])/g, "$1\u0001$2")
    // Remove punctuation that carries no story identity,
    // keeping digits, letters, and intra-word symbols.
    .replace(/[!?.,:;"'`´(){}\[\]<>#*_~^\\\/|@%+=]/g, " ")
    .replace(/\u0001/g, ",")
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return value;
}

// Low-information words removed before token similarity:
// articles, prepositions, and generic news verbs and
// fillers that carry no story identity. Country names,
// people, organizations, numbers, and technical nouns all
// survive.
const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on",
  "at", "to", "for", "from", "with", "by", "as", "is",
  "are", "was", "were", "be", "been", "being", "it", "its",
  "this", "that", "these", "those", "will", "would",
  "could", "should", "has", "have", "had", "may", "might",
  "can", "into", "over", "after", "before", "amid", "amidst",
  "about", "up", "down", "out", "off", "new", "says", "say",
  "said", "-",
  // Generic news verbs and fillers.
  "announce", "announces", "announced", "announcement",
  "unveil", "unveils", "unveiled", "reveal", "reveals",
  "revealed", "launch", "launches", "launched", "report",
  "reports", "reported", "reportedly", "update", "updates",
  "latest", "breaking", "major", "big", "top", "key",
  "industry", "industries", "sector"
]);

// Light suffix stemming so plural / singular variants of
// the same noun compare equal (subsidies vs subsidy).
function lightStem(token) {
  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  if (
    token.length > 3 &&
    token.endsWith("s") &&
    !token.endsWith("ss")
  ) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenizeHeadline(normalizedTitle) {
  return String(normalizedTitle || "")
    .split(/\s+/)
    .filter(
      token =>
        token.length > 1 &&
        !STOP_WORDS.has(token)
    )
    .map(lightStem);
}

const MAX_SNIPPET_LENGTH = 500;

function normalizeSnippet(value) {
  return stripHtml(value).slice(0, MAX_SNIPPET_LENGTH);
}

module.exports = {
  MAX_SNIPPET_LENGTH,
  STOP_WORDS,
  decodeEntities,
  lightStem,
  normalizeHeadline,
  normalizeSnippet,
  stripHtml,
  stripPublisherSuffix,
  tokenizeHeadline
};

// =========================================================
// PERSON TEXT NORMALIZATION — Task 3.3E
//
// Deterministic normalization + token-boundary alias
// matching for public person names. Latin aliases require
// full token boundaries ("block the road" never matches
// "ken block"); CJK aliases match as contiguous substrings
// because CJK text carries no token separators.
// =========================================================

const { containsCjk } = require("./person-catalog");

function normalizePersonText(value) {
  return String(value ?? "")
    // Trademark symbols go BEFORE NFKC, which would expand
    // ™ into the letters "tm".
    .replace(/[™®©]/g, " ")
    .normalize("NFKC")
    .toLowerCase()
    // Every dash variant becomes a space.
    .replace(/[‐‑‒–—―−-]/g, " ")
    // Curly apostrophes become plain apostrophes, then
    // apostrophes become token boundaries so a possessive
    // ("Lei Jun's") never glues tokens together ("juns").
    .replace(/[’‘]/g, "'")
    .replace(/'/g, " ")
    // Everything that is not a letter or number becomes a
    // space. CJK letters survive (\p{L}).
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function padTokens(normalized) {
  return normalized ? ` ${normalized} ` : "";
}

// Matches one alias against already-normalized text.
// Latin aliases need full token boundaries; CJK aliases
// use contiguous substring containment.
function aliasMatchesNormalizedText(
  normalizedText,
  alias
) {
  if (!normalizedText || !alias) {
    return false;
  }

  const normalizedAlias = normalizePersonText(alias);

  if (!normalizedAlias) {
    return false;
  }

  if (containsCjk(normalizedAlias)) {
    return normalizedText.includes(normalizedAlias);
  }

  return padTokens(normalizedText).includes(
    ` ${normalizedAlias} `
  );
}

// Returns the first alias (catalog order) found in the
// raw text, or null.
function findAliasInText(rawText, aliases) {
  const normalizedText = normalizePersonText(rawText);

  if (!normalizedText) {
    return null;
  }

  for (const alias of aliases || []) {
    if (
      aliasMatchesNormalizedText(normalizedText, alias)
    ) {
      return alias;
    }
  }

  return null;
}

module.exports = {
  aliasMatchesNormalizedText,
  findAliasInText,
  normalizePersonText,
  padTokens
};

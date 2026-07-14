// =========================================================
// CANON AUTHORITY LOADER — Task 3.4E
//
// Every Story Pipeline generation stage (Directions, Outline,
// Scripts) must load a fresh CanonBundle before calling the
// LLM provider. This module fails closed: any missing file,
// unapproved status, version mismatch, or unresolved conflict
// throws instead of returning a partial bundle.
// =========================================================

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const CANON_DIR = path.join(
  __dirname,
  "..",
  "..",
  "docs",
  "canon"
);

const CANON_FILES = {
  story_bible: "DC2100_STORY_BIBLE_V1.md",
  apex_rules: "APEX_RULES_V1.md",
  season_outline: "SEASON_1_GLOBAL_QUALIFIERS.md",
  state_model: "CANON_STATE_MODEL.md"
};

const REQUIRED_APPROVED_BY = "michael";

class CanonError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CanonError";
    this.code = code;
  }
}

function readFrontMatterField(content, fieldName) {
  const pattern = new RegExp(
    `^${fieldName}:\\s*(.+)\\s*$`,
    "m"
  );

  const match = content.match(pattern);

  return match ? match[1].trim() : null;
}

function parseCanonDocument(key, filename, canonDir) {
  const filePath = path.join(canonDir, filename);

  if (!fs.existsSync(filePath)) {
    throw new CanonError(
      "CANON_FILE_MISSING",
      `Canon file missing: ${filename}`
    );
  }

  let content;

  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new CanonError(
      "CANON_PARSE_FAILED",
      `Failed to read canon file ${filename}: ${error.message}`
    );
  }

  const documentStatus = readFrontMatterField(
    content,
    "document_status"
  );

  const approvedBy = readFrontMatterField(
    content,
    "approved_by"
  );

  const approvalEffectiveOnMerge = readFrontMatterField(
    content,
    "approval_effective_on_merge"
  );

  const canonVersion = readFrontMatterField(
    content,
    "canon_version"
  );

  if (!documentStatus || !approvedBy || !canonVersion) {
    throw new CanonError(
      "CANON_PARSE_FAILED",
      `Failed to parse required front-matter fields in ${filename}`
    );
  }

  if (documentStatus === "DRAFT_AWAITING_APPROVAL") {
    throw new CanonError(
      "CANON_NOT_APPROVED",
      `Canon file ${filename} is DRAFT_AWAITING_APPROVAL, not APPROVED_V1.`
    );
  }

  if (documentStatus !== "APPROVED_V1") {
    throw new CanonError(
      "CANON_NOT_APPROVED",
      `Canon file ${filename} has document_status ${documentStatus}, expected APPROVED_V1.`
    );
  }

  if (approvedBy !== REQUIRED_APPROVED_BY) {
    throw new CanonError(
      "CANON_NOT_APPROVED",
      `Canon file ${filename} is approved_by ${approvedBy}, expected ${REQUIRED_APPROVED_BY}.`
    );
  }

  if (approvalEffectiveOnMerge !== "true") {
    throw new CanonError(
      "CANON_NOT_APPROVED",
      `Canon file ${filename} does not have approval_effective_on_merge: true.`
    );
  }

  if (/CANON_CONFLICT/.test(content)) {
    // The four approved canon docs themselves describe the
    // CANON_CONFLICT escalation rule in prose (expected). A
    // real unresolved conflict is signalled by an explicit
    // marker line, never by the rule description alone.
    if (/^\s*CANON_CONFLICT_UNRESOLVED\s*:/m.test(content)) {
      throw new CanonError(
        "CANON_CONFLICT",
        `Canon file ${filename} contains an unresolved CANON_CONFLICT marker.`
      );
    }
  }

  return {
    key,
    filename,
    content,
    documentStatus,
    approvedBy,
    canonVersion
  };
}

function loadCanonBundle({ canonDir = CANON_DIR } = {}) {
  const documents = {};

  for (const [key, filename] of Object.entries(CANON_FILES)) {
    documents[key] = parseCanonDocument(key, filename, canonDir);
  }

  const versions = new Set(
    Object.values(documents).map(doc => doc.canonVersion)
  );

  if (versions.size > 1) {
    throw new CanonError(
      "CANON_VERSION_MISMATCH",
      `Canon documents disagree on canon_version: ${[...versions].join(", ")}`
    );
  }

  const canonVersion = [...versions][0];

  const rulesVersionMatch =
    documents.state_model.content.match(
      /"rules_version":\s*"([^"]+)"/
    );

  const seasonVersionMatch =
    documents.state_model.content.match(
      /"season_version":\s*"([^"]+)"/
    );

  const rulesVersion = rulesVersionMatch
    ? rulesVersionMatch[1]
    : canonVersion;

  const seasonVersion = seasonVersionMatch
    ? seasonVersionMatch[1]
    : canonVersion;

  const combined = Object.values(CANON_FILES)
    .map(filename => documents[
      Object.keys(CANON_FILES).find(
        key => CANON_FILES[key] === filename
      )
    ].content)
    .join("\n---\n");

  const canonHash = crypto
    .createHash("sha256")
    .update(combined)
    .digest("hex");

  return {
    canon_version: canonVersion,
    rules_version: rulesVersion,
    season_version: seasonVersion,
    canon_hash: `sha256:${canonHash}`,
    story_bible: documents.story_bible.content,
    apex_rules: documents.apex_rules.content,
    season_outline: documents.season_outline.content,
    state_model: documents.state_model.content
  };
}

module.exports = {
  CanonError,
  CANON_FILES,
  loadCanonBundle
};

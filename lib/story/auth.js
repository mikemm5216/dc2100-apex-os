// =========================================================
// STORY API AUTHENTICATION — Task 3.4E Production Hardening
//
// Every /api/story/* route requires `Authorization: Bearer
// <STORY_ADMIN_TOKEN>`. The token is compared with
// crypto.timingSafeEqual so a wrong-length or wrong-value guess
// can't be distinguished by response timing, and it is never
// echoed back in a response, error, event, or log line -- only
// the two fixed response bodies below are ever returned to the
// caller. This module owns both the route predicate and the
// check itself so server.js stays thin wiring and both pieces
// are unit-testable without starting a real HTTP server.
// =========================================================

const crypto = require("node:crypto");

const STORY_API_PATH_PATTERN = /^\/api\/story(\/|$)/;

function isStoryApiPath(pathname) {
  return STORY_API_PATH_PATTERN.test(pathname);
}

function notConfiguredResponse() {
  return {
    ok: false,
    statusCode: 503,
    body: {
      error: "STORY_AUTH_NOT_CONFIGURED",
      message: "Story API authentication is not configured."
    }
  };
}

function unauthorizedResponse() {
  return {
    ok: false,
    statusCode: 401,
    body: {
      error: "UNAUTHORIZED",
      message: "Valid Story API authorization is required."
    }
  };
}

function extractBearerToken(headers) {
  const raw = headers && (headers.authorization || headers.Authorization);

  if (typeof raw !== "string") {
    return null;
  }

  const match = raw.match(/^Bearer (.+)$/);

  return match ? match[1] : null;
}

// Hash both values first so timingSafeEqual always receives two
// fixed-length buffers. Besides avoiding its different-length
// exception, this keeps the comparison path identical for short
// and long token guesses.
function timingSafeTokenEquals(provided, expected) {
  const providedDigest = crypto
    .createHash("sha256")
    .update(String(provided), "utf8")
    .digest();
  const expectedDigest = crypto
    .createHash("sha256")
    .update(String(expected), "utf8")
    .digest();

  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

function checkStoryAuth(
  headers,
  { token = process.env.STORY_ADMIN_TOKEN } = {}
) {
  if (!token) {
    return notConfiguredResponse();
  }

  const provided = extractBearerToken(headers);

  if (!provided) {
    return unauthorizedResponse();
  }

  if (!timingSafeTokenEquals(provided, token)) {
    return unauthorizedResponse();
  }

  // Every Story Gate already requires body.approved_by ===
  // "michael" independently (engine.js) -- this actor is purely
  // informational for callers that want to know who a
  // successfully authenticated request is attributed to.
  return { ok: true, actor: "michael" };
}

module.exports = {
  STORY_API_PATH_PATTERN,
  isStoryApiPath,
  checkStoryAuth,
  extractBearerToken
};

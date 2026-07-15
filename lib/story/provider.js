// =========================================================
// STORY LLM PROVIDER — Task 3.4E
//
// Thin wrapper around Gemini's structured JSON generation
// using Node 20's native fetch. No SDK dependency. Accepts
// dependency injection everywhere so tests never reach a real
// network call. Fails closed on any ambiguity: at most one
// repair retry, no markdown fences accepted, no infinite
// retry loop.
// =========================================================

const PROVIDER_ERROR_CODES = {
  PROVIDER_CONFIG_MISSING: "PROVIDER_CONFIG_MISSING",
  PROVIDER_UNSUPPORTED: "PROVIDER_UNSUPPORTED",
  PROVIDER_TIMEOUT: "PROVIDER_TIMEOUT",
  PROVIDER_RATE_LIMITED: "PROVIDER_RATE_LIMITED",
  PROVIDER_UPSTREAM_ERROR: "PROVIDER_UPSTREAM_ERROR",
  PROVIDER_INVALID_JSON: "PROVIDER_INVALID_JSON",
  PROVIDER_SCHEMA_INVALID: "PROVIDER_SCHEMA_INVALID",
  PROVIDER_EMPTY_RESPONSE: "PROVIDER_EMPTY_RESPONSE",
  PROVIDER_RESPONSE_SCHEMA_REQUIRED: "PROVIDER_RESPONSE_SCHEMA_REQUIRED"
};

const SUPPORTED_PROVIDERS = new Set(["gemini"]);

// Belt-and-suspenders secret redaction: applied to any error
// message before it is thrown, logged, or persisted to
// story_generation_attempts.error_message. Redacts a known
// secret value verbatim, plus generic ?key=... query params
// and Authorization / x-goog-api-key header-shaped text, so a
// leak is caught even if the exact secret string isn't passed
// in (e.g. a future header-based auth scheme).
const SECRET_QUERY_PARAM_PATTERN = /([?&]key=)[^&\s"']+/gi;
const AUTH_HEADER_PATTERN =
  /((?:authorization|x-goog-api-key)["']?\s*[:=]\s*["']?)([^\s"',}]+)/gi;

function redactSecrets(text, secrets = []) {
  if (typeof text !== "string" || text.length === 0) {
    return text;
  }

  let redacted = text;

  for (const secret of secrets) {
    if (secret) {
      redacted = redacted.split(secret).join("***REDACTED***");
    }
  }

  redacted = redacted.replace(SECRET_QUERY_PARAM_PATTERN, "$1***REDACTED***");
  redacted = redacted.replace(AUTH_HEADER_PATTERN, "$1***REDACTED***");

  return redacted;
}

const DEFAULT_TIMEOUT_MS = 90000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 300000;
const HARD_MAX_ATTEMPTS = 2;

// Independent transport-level retry for TRANSIENT HTTP 429 only --
// separate from the JSON-repair retry above (HARD_MAX_ATTEMPTS). A
// rate limit is not a content problem: the exact same request must be
// resent unchanged, it must never consume a repair attempt, and it
// must never re-enter the Engine's validator-guided retry loop.
// Google's guidance for 429 RESOURCE_EXHAUSTED is bounded exponential
// backoff, honoring Retry-After when the server provides one.
const RATE_LIMIT_MAX_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 15000;
const RATE_LIMIT_MAX_DELAY_MS = 60000;
// Small jitter only, additive on top of the bounded backoff/Retry-After
// delay -- deliberately tiny so it never risks pushing a delay past a
// test's ">=" assertions, and always zero when randomImpl is injected
// as `() => 0` in tests.
const RATE_LIMIT_JITTER_MAX_MS = 250;

// Accepts either form RFC 9110 allows: a number of seconds ("30") or
// an HTTP-date. Returns null (never throws) for anything absent,
// malformed, or already in the past -- callers fall back to the
// exponential backoff schedule in that case.
function parseRetryAfterMs(value, nowMs = Date.now()) {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();

  if (trimmed.length === 0) {
    return null;
  }

  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) ? seconds * 1000 : null;
  }

  const parsedDate = Date.parse(trimmed);

  if (Number.isNaN(parsedDate)) {
    return null;
  }

  const deltaMs = parsedDate - nowMs;

  return deltaMs > 0 ? deltaMs : null;
}

function computeRateLimitDelayMs(retryIndex, retryAfterMs, randomImpl) {
  const backoffMs = Math.min(
    RATE_LIMIT_MAX_DELAY_MS,
    RATE_LIMIT_BASE_DELAY_MS * 2 ** retryIndex
  );

  const baseDelayMs = Math.max(retryAfterMs || 0, backoffMs);
  const jitterMs = Math.floor(randomImpl() * RATE_LIMIT_JITTER_MAX_MS);

  return baseDelayMs + jitterMs;
}

class ProviderError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.details = details;
  }
}

function clampInteger(value, { min, max, fallback }) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

// Reads config fresh every call -- never memoized at module
// load, so tests can flip process.env between cases and the
// worker picks up rotated keys without a restart.
function readProviderConfig() {
  const provider = process.env.STORY_LLM_PROVIDER || "gemini";

  if (!SUPPORTED_PROVIDERS.has(String(provider).toLowerCase())) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_UNSUPPORTED,
      `Unsupported STORY_LLM_PROVIDER "${provider}" -- only "gemini" is supported in V1.`
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.STORY_GEMINI_MODEL;

  if (!apiKey || !model) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_CONFIG_MISSING,
      "GEMINI_API_KEY and STORY_GEMINI_MODEL must both be set."
    );
  }

  const timeoutMs = clampInteger(
    process.env.STORY_LLM_TIMEOUT_MS,
    {
      min: MIN_TIMEOUT_MS,
      max: MAX_TIMEOUT_MS,
      fallback: DEFAULT_TIMEOUT_MS
    }
  );

  const maxAttempts = Math.min(
    HARD_MAX_ATTEMPTS,
    clampInteger(
      process.env.STORY_LLM_MAX_ATTEMPTS,
      { min: 1, max: HARD_MAX_ATTEMPTS, fallback: HARD_MAX_ATTEMPTS }
    )
  );

  return { provider, apiKey, model, timeoutMs, maxAttempts };
}

// Markdown fences are rejected outright -- never stripped and
// retried within the same attempt. A fenced response is
// treated as an invalid-JSON attempt, consuming one of the
// (at most 2) attempts.
function looksLikeMarkdownFence(text) {
  return /^\s*```/.test(text);
}

function parseModelJson(text) {
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_EMPTY_RESPONSE,
      "Provider returned an empty response."
    );
  }

  if (looksLikeMarkdownFence(text)) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_INVALID_JSON,
      "Provider response was wrapped in a markdown code fence, which is not accepted."
    );
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_INVALID_JSON,
      `Provider response was not valid JSON: ${error.message}`
    );
  }
}

async function callGeminiOnce({
  apiKey,
  model,
  timeoutMs,
  systemPrompt,
  input,
  temperature,
  responseJsonSchema,
  fetchImpl,
  nowImpl = () => Date.now()
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let response;

  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: systemPrompt }]
        },
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify(input) }]
          }
        ],
        generationConfig: {
          temperature,
          responseMimeType: "application/json",
          responseJsonSchema
        }
      })
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new ProviderError(
        PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT,
        `Provider request timed out after ${timeoutMs}ms.`
      );
    }

    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_UPSTREAM_ERROR,
      redactSecrets(`Provider request failed: ${error.message}`, [apiKey])
    );
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 429) {
    const retryAfterHeader =
      response.headers && typeof response.headers.get === "function"
        ? response.headers.get("retry-after")
        : null;

    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED,
      "Provider responded 429 Too Many Requests.",
      { retryAfterMs: parseRetryAfterMs(retryAfterHeader, nowImpl()) }
    );
  }

  if (response.status >= 500) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_UPSTREAM_ERROR,
      `Provider responded with upstream error ${response.status}.`
    );
  }

  if (!response.ok) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_UPSTREAM_ERROR,
      `Provider responded with status ${response.status}.`
    );
  }

  let body;

  try {
    body = await response.json();
  } catch (error) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_EMPTY_RESPONSE,
      "Provider response body was not valid JSON envelope."
    );
  }

  const text =
    body &&
    body.candidates &&
    body.candidates[0] &&
    body.candidates[0].content &&
    body.candidates[0].content.parts &&
    body.candidates[0].content.parts[0] &&
    body.candidates[0].content.parts[0].text;

  const inputTokens =
    body && body.usageMetadata && body.usageMetadata.promptTokenCount;

  const outputTokens =
    body &&
    body.usageMetadata &&
    body.usageMetadata.candidatesTokenCount;

  const totalTokens =
    body && body.usageMetadata && body.usageMetadata.totalTokenCount;

  return {
    rawText: text,
    inputTokens: Number.isFinite(Number(inputTokens))
      ? Number(inputTokens)
      : null,
    outputTokens: Number.isFinite(Number(outputTokens))
      ? Number(outputTokens)
      : null,
    totalTokens: Number.isFinite(Number(totalTokens))
      ? Number(totalTokens)
      : null
  };
}

// Single repair pass: on first invalid JSON / schema failure,
// re-ask once with the earlier failure appended as extra input
// context. Never a third attempt. The repair instruction always
// asks for the complete JSON value again -- never "just the
// missing fields" -- because application code never merges a
// repaired partial response with the original one; whatever the
// model returns on the repair attempt is the entire artifact.
function buildRepairInput(originalInput, failureReason) {
  return {
    ...originalInput,
    _repair_context: {
      previous_attempt_failed: true,
      failure_reason: String(failureReason).slice(0, 500),
      instruction:
        "Regenerate the ENTIRE JSON value from scratch so it fully " +
        "satisfies the response schema. Do not return only the " +
        "fields that were missing or invalid -- your new response " +
        "completely replaces the previous one, so every required " +
        "field must be present in it."
    }
  };
}

// Retries ONLY a transient 429 (PROVIDER_RATE_LIMITED), resending the
// exact same call params every time -- never rebuilding the prompt/
// input, since a rate limit says nothing about the request's content.
// Any other error (including a genuinely exhausted rate limit) is
// thrown as-is, unmodified, straight through to the caller. Returns
// `{ result, retries }` so the caller can report how many transport
// retries this one call needed without polluting callGeminiOnce's own
// return shape.
async function callGeminiWithRateLimitRetry(params, { sleepImpl, randomImpl }) {
  let lastError = null;

  for (let retryIndex = 0; retryIndex <= RATE_LIMIT_MAX_RETRIES; retryIndex += 1) {
    try {
      const result = await callGeminiOnce(params);
      return { result, retries: retryIndex };
    } catch (error) {
      if (
        !(error instanceof ProviderError) ||
        error.code !== PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED
      ) {
        throw error;
      }

      lastError = error;

      if (retryIndex >= RATE_LIMIT_MAX_RETRIES) {
        throw lastError;
      }

      const delayMs = computeRateLimitDelayMs(
        retryIndex,
        error.details && error.details.retryAfterMs,
        randomImpl
      );

      await sleepImpl(delayMs);
    }
  }

  throw lastError;
}

async function generateJson({
  task,
  systemPrompt,
  input,
  schemaName,
  responseJsonSchema,
  temperature = 0.7,
  validate = null,
  fetchImpl = typeof fetch === "function" ? fetch : null,
  config = null,
  sleepImpl = ms => new Promise(resolve => setTimeout(resolve, ms)),
  randomImpl = Math.random,
  nowImpl = () => Date.now()
}) {
  const resolvedConfig = config || readProviderConfig();

  if (!fetchImpl) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_CONFIG_MISSING,
      "No fetch implementation is available."
    );
  }

  if (!responseJsonSchema) {
    throw new ProviderError(
      PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_SCHEMA_REQUIRED,
      `generateJson requires responseJsonSchema for task "${task}" -- Story generation is never sent to Gemini without a structured-output schema.`
    );
  }

  let lastError = null;
  let currentInput = input;
  let rateLimitRetries = 0;

  for (
    let attempt = 1;
    attempt <= resolvedConfig.maxAttempts;
    attempt += 1
  ) {
    const startedAt = Date.now();

    try {
      const { result, retries } = await callGeminiWithRateLimitRetry(
        {
          apiKey: resolvedConfig.apiKey,
          model: resolvedConfig.model,
          timeoutMs: resolvedConfig.timeoutMs,
          systemPrompt,
          input: currentInput,
          temperature,
          responseJsonSchema,
          fetchImpl,
          nowImpl
        },
        { sleepImpl, randomImpl }
      );

      rateLimitRetries += retries;

      const latencyMs = Date.now() - startedAt;
      const parsed = parseModelJson(result.rawText);

      if (validate) {
        const validation = validate(parsed);

        if (validation && validation.valid === false) {
          throw new ProviderError(
            PROVIDER_ERROR_CODES.PROVIDER_SCHEMA_INVALID,
            `Provider JSON failed schema validation: ${
              (validation.errors || []).join("; ")
            }`
          );
        }
      }

      return {
        task,
        schemaName,
        data: parsed,
        attempt,
        provider: resolvedConfig.provider,
        model: resolvedConfig.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        totalTokens: result.totalTokens,
        latencyMs,
        rateLimitRetries
      };
    } catch (error) {
      lastError = error;

      const retryable =
        error instanceof ProviderError &&
        (error.code === PROVIDER_ERROR_CODES.PROVIDER_INVALID_JSON ||
          error.code === PROVIDER_ERROR_CODES.PROVIDER_SCHEMA_INVALID ||
          error.code === PROVIDER_ERROR_CODES.PROVIDER_EMPTY_RESPONSE);

      if (!retryable || attempt >= resolvedConfig.maxAttempts) {
        throw error;
      }

      currentInput = buildRepairInput(input, error.message);
    }
  }

  throw lastError;
}

module.exports = {
  PROVIDER_ERROR_CODES,
  ProviderError,
  DEFAULT_TIMEOUT_MS,
  HARD_MAX_ATTEMPTS,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  SUPPORTED_PROVIDERS,
  redactSecrets,
  readProviderConfig,
  parseRetryAfterMs,
  generateJson
};

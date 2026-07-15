const assert = require("node:assert/strict");

const {
  ProviderError,
  PROVIDER_ERROR_CODES,
  RATE_LIMIT_MAX_RETRIES,
  RATE_LIMIT_BASE_DELAY_MS,
  RATE_LIMIT_MAX_DELAY_MS,
  readProviderConfig,
  redactSecrets,
  parseRetryAfterMs,
  generateJson
} = require("../lib/story/provider");

const {
  STORY_DIRECTIONS_RESPONSE_JSON_SCHEMA,
  STORY_OUTLINE_RESPONSE_JSON_SCHEMA,
  STORY_SCRIPTS_RESPONSE_JSON_SCHEMA
} = require("../lib/story/schemas");

const MINIMAL_TEST_SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false
};

// ---------------------------------------------------------
// No real network call is made anywhere in this file --
// every case injects its own fetchImpl. Real Gemini is never
// reached.
// ---------------------------------------------------------

function fakeGeminiResponse({ ok = true, status = 200, text, headers = {} }) {
  const lowercasedHeaders = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
  );

  return {
    ok,
    status,
    headers: {
      get: name => lowercasedHeaders[String(name).toLowerCase()] ?? null
    },
    async json() {
      if (text === undefined) {
        return {};
      }

      return {
        candidates: [
          { content: { parts: [{ text }] } }
        ],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 20,
          totalTokenCount: 30
        }
      };
    }
  };
}

// Every rate-limit test injects these so no test actually waits --
// sleepImpl just records the requested delay instead of really
// sleeping, and randomImpl is fixed at 0 so the small additive jitter
// never perturbs an exact-value assertion.
function noWaitRateLimitDeps() {
  const sleeps = [];

  return {
    sleeps,
    sleepImpl: async ms => {
      sleeps.push(ms);
    },
    randomImpl: () => 0
  };
}

function abortAwareFetch() {
  return (url, options) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      });
    });
}

const BASE_CONFIG = {
  provider: "gemini",
  apiKey: "secret-test-api-key-should-never-leak",
  model: "test-model",
  timeoutMs: 5000,
  maxAttempts: 2
};

async function run() {
  // -------------------------------------------------------
  // PROVIDER_CONFIG_MISSING
  // -------------------------------------------------------
  {
    const previousKey = process.env.GEMINI_API_KEY;
    const previousModel = process.env.STORY_GEMINI_MODEL;

    delete process.env.GEMINI_API_KEY;
    delete process.env.STORY_GEMINI_MODEL;

    assert.throws(
      () => readProviderConfig(),
      error => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.code, PROVIDER_ERROR_CODES.PROVIDER_CONFIG_MISSING);
        return true;
      }
    );

    if (previousKey !== undefined) process.env.GEMINI_API_KEY = previousKey;
    if (previousModel !== undefined) process.env.STORY_GEMINI_MODEL = previousModel;
  }

  // -------------------------------------------------------
  // PROVIDER_TIMEOUT
  // -------------------------------------------------------
  {
    await assert.rejects(
      generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, timeoutMs: 30, maxAttempts: 1 },
        fetchImpl: abortAwareFetch()
      }),
      error => {
        assert.equal(error.code, PROVIDER_ERROR_CODES.PROVIDER_TIMEOUT);
        return true;
      }
    );
  }

  // -------------------------------------------------------
  // PROVIDER_RATE_LIMITED (429) -- eventually still throws once its
  // own independent transport retries are exhausted. sleepImpl is
  // injected so this never actually waits through the real backoff
  // schedule.
  // -------------------------------------------------------
  {
    const { sleeps, sleepImpl, randomImpl } = noWaitRateLimitDeps();
    let calls = 0;

    await assert.rejects(
      generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, maxAttempts: 1 },
        sleepImpl,
        randomImpl,
        fetchImpl: async () => {
          calls += 1;
          return fakeGeminiResponse({ ok: false, status: 429 });
        }
      }),
      error => {
        assert.equal(
          error.code,
          PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED
        );
        return true;
      }
    );

    assert.equal(calls, RATE_LIMIT_MAX_RETRIES + 1, "initial request + 3 retries");
    assert.equal(sleeps.length, RATE_LIMIT_MAX_RETRIES);
  }

  // =========================================================
  // Transient Gemini rate-limit retry (PR #12 Live Acceptance fix):
  // a bounded, independent transport-level retry for HTTP 429 only,
  // never consuming a JSON-repair attempt, never rebuilding the
  // prompt/input, never touching Engine/validator retry state.
  // =========================================================

  // Test 1 -- first request succeeds: fetch called once, sleep never
  // called, result unchanged from today's behavior.
  {
    const { sleeps, sleepImpl, randomImpl } = noWaitRateLimitDeps();
    let calls = 0;

    const result = await generateJson({
      task: "TEST",
      systemPrompt: "sp",
      input: { a: 1 },
      schemaName: "test",
      responseJsonSchema: MINIMAL_TEST_SCHEMA,
      config: { ...BASE_CONFIG, maxAttempts: 1 },
      sleepImpl,
      randomImpl,
      fetchImpl: async () => {
        calls += 1;
        return fakeGeminiResponse({ text: JSON.stringify({ ok: true }) });
      }
    });

    assert.equal(calls, 1);
    assert.equal(sleeps.length, 0);
    assert.equal(result.attempt, 1);
    assert.deepEqual(result.data, { ok: true });
    assert.equal(result.rateLimitRetries, 0);
  }

  // Test 2 -- first request 429, second succeeds: fetch called twice
  // with the identical URL/body, sleep called exactly once, result
  // still succeeds.
  {
    const { sleeps, sleepImpl, randomImpl } = noWaitRateLimitDeps();
    const seenUrls = [];
    const seenBodies = [];

    const result = await generateJson({
      task: "TEST",
      systemPrompt: "sp",
      input: { a: 1 },
      schemaName: "test",
      responseJsonSchema: MINIMAL_TEST_SCHEMA,
      config: { ...BASE_CONFIG, maxAttempts: 1 },
      sleepImpl,
      randomImpl,
      fetchImpl: async (url, options) => {
        seenUrls.push(url);
        seenBodies.push(options.body);

        if (seenUrls.length === 1) {
          return fakeGeminiResponse({ ok: false, status: 429 });
        }

        return fakeGeminiResponse({ text: JSON.stringify({ ok: true }) });
      }
    });

    assert.equal(seenUrls.length, 2);
    assert.equal(seenUrls[0], seenUrls[1], "the exact same request must be resent");
    assert.equal(seenBodies[0], seenBodies[1], "the exact same request body must be resent, never a rebuilt repair prompt");
    assert.equal(sleeps.length, 1);
    assert.deepEqual(result.data, { ok: true });
    assert.equal(result.attempt, 1, "a rate-limit retry must never consume a JSON-repair attempt");
    assert.equal(result.rateLimitRetries, 1);
  }

  // Test 3 -- Retry-After in seconds form is honored: the actual
  // delay used must be at least that many milliseconds.
  {
    const { sleeps, sleepImpl, randomImpl } = noWaitRateLimitDeps();
    let calls = 0;

    await generateJson({
      task: "TEST",
      systemPrompt: "sp",
      input: {},
      schemaName: "test",
      responseJsonSchema: MINIMAL_TEST_SCHEMA,
      config: { ...BASE_CONFIG, maxAttempts: 1 },
      sleepImpl,
      randomImpl,
      fetchImpl: async () => {
        calls += 1;

        if (calls === 1) {
          return fakeGeminiResponse({
            ok: false,
            status: 429,
            headers: { "retry-after": "30" }
          });
        }

        return fakeGeminiResponse({ text: JSON.stringify({ ok: true }) });
      }
    });

    assert.ok(sleeps[0] >= 30000, `expected delay >= 30000ms, got ${sleeps[0]}`);
  }

  // Test 4 -- Retry-After as an HTTP-date is honored: with a fixed
  // injected nowImpl, the computed delay must match the date's
  // distance from "now".
  {
    const { sleeps, sleepImpl, randomImpl } = noWaitRateLimitDeps();
    const fixedNowMs = Date.UTC(2026, 0, 1, 0, 0, 0);
    const retryAfterDate = new Date(fixedNowMs + 45000);
    let calls = 0;

    await generateJson({
      task: "TEST",
      systemPrompt: "sp",
      input: {},
      schemaName: "test",
      responseJsonSchema: MINIMAL_TEST_SCHEMA,
      config: { ...BASE_CONFIG, maxAttempts: 1 },
      sleepImpl,
      randomImpl,
      nowImpl: () => fixedNowMs,
      fetchImpl: async () => {
        calls += 1;

        if (calls === 1) {
          return fakeGeminiResponse({
            ok: false,
            status: 429,
            headers: { "retry-after": retryAfterDate.toUTCString() }
          });
        }

        return fakeGeminiResponse({ text: JSON.stringify({ ok: true }) });
      }
    });

    assert.equal(
      sleeps[0],
      45000,
      `expected the exact 45000ms gap between the fixed now and the Retry-After date, got ${sleeps[0]}`
    );
    assert.equal(
      parseRetryAfterMs(retryAfterDate.toUTCString(), fixedNowMs),
      45000
    );
  }

  // Test 5 -- no Retry-After header falls back to the exponential
  // backoff schedule: 15000, 30000, 60000.
  {
    const { sleeps, sleepImpl, randomImpl } = noWaitRateLimitDeps();
    let calls = 0;

    await assert.rejects(
      generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, maxAttempts: 1 },
        sleepImpl,
        randomImpl,
        fetchImpl: async () => {
          calls += 1;
          return fakeGeminiResponse({ ok: false, status: 429 });
        }
      }),
      error => {
        assert.equal(error.code, PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED);
        return true;
      }
    );

    assert.deepEqual(sleeps, [
      RATE_LIMIT_BASE_DELAY_MS,
      RATE_LIMIT_BASE_DELAY_MS * 2,
      RATE_LIMIT_MAX_DELAY_MS
    ]);
    assert.deepEqual(sleeps, [15000, 30000, 60000]);
  }

  // Test 6 -- repeated 429 exhausts retries: total fetch calls = 4
  // (initial + 3 retries), final error is still PROVIDER_RATE_LIMITED
  // (never rewritten to a generic upstream error), never a 5th call.
  {
    const { sleeps, sleepImpl, randomImpl } = noWaitRateLimitDeps();
    let calls = 0;

    await assert.rejects(
      generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, maxAttempts: 1 },
        sleepImpl,
        randomImpl,
        fetchImpl: async () => {
          calls += 1;
          return fakeGeminiResponse({ ok: false, status: 429 });
        }
      }),
      error => {
        assert.equal(error.code, PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED);
        return true;
      }
    );

    assert.equal(calls, 4);
    assert.equal(sleeps.length, 3, "no sleep after the final, exhausted attempt");
  }

  // Test 7 -- HTTP 400 is never retried by the rate-limit layer:
  // fetch called once, sleep never called.
  {
    const { sleeps, sleepImpl, randomImpl } = noWaitRateLimitDeps();
    let calls = 0;

    await assert.rejects(
      generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, maxAttempts: 1 },
        sleepImpl,
        randomImpl,
        fetchImpl: async () => {
          calls += 1;
          return fakeGeminiResponse({ ok: false, status: 400 });
        }
      }),
      error => {
        assert.equal(error.code, PROVIDER_ERROR_CODES.PROVIDER_UPSTREAM_ERROR);
        return true;
      }
    );

    assert.equal(calls, 1);
    assert.equal(sleeps.length, 0);
  }

  // Test 8 -- a rate-limit retry inside attempt 1, followed by a real
  // JSON-repair retry (attempt 2), proves the two mechanisms are
  // fully isolated: the repair attempt counter only advances for the
  // actual content failure, never for the transport-level 429.
  {
    const { sleeps, sleepImpl, randomImpl } = noWaitRateLimitDeps();
    let calls = 0;

    const result = await generateJson({
      task: "TEST",
      systemPrompt: "sp",
      input: { a: 1 },
      schemaName: "test",
      responseJsonSchema: MINIMAL_TEST_SCHEMA,
      config: { ...BASE_CONFIG, maxAttempts: 2 },
      sleepImpl,
      randomImpl,
      fetchImpl: async () => {
        calls += 1;

        if (calls === 1) {
          return fakeGeminiResponse({ ok: false, status: 429 });
        }

        if (calls === 2) {
          return fakeGeminiResponse({ text: "not valid json {" });
        }

        return fakeGeminiResponse({ text: JSON.stringify({ ok: true }) });
      }
    });

    assert.equal(calls, 3, "429 retry + invalid-JSON attempt + repair attempt");
    assert.equal(sleeps.length, 1, "only the transport-level 429 sleeps, never the JSON-repair retry");
    assert.equal(result.attempt, 2, "the repair attempt counter only reflects the real content failure, not the 429");
    assert.equal(result.rateLimitRetries, 1);
    assert.deepEqual(result.data, { ok: true });
  }

  console.log("PROVIDER LIMIT FIX STORY PROVIDER TESTS PASSED: transient 429 transport retry isolated from JSON-repair retry, Retry-After honored, bounded exponential fallback, HTTP 400 unaffected");

  // -------------------------------------------------------
  // PROVIDER_UPSTREAM_ERROR (5xx)
  // -------------------------------------------------------
  {
    await assert.rejects(
      generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, maxAttempts: 1 },
        fetchImpl: async () => fakeGeminiResponse({ ok: false, status: 503 })
      }),
      error => {
        assert.equal(
          error.code,
          PROVIDER_ERROR_CODES.PROVIDER_UPSTREAM_ERROR
        );
        return true;
      }
    );
  }

  // -------------------------------------------------------
  // PROVIDER_INVALID_JSON (single attempt, no repair)
  // -------------------------------------------------------
  {
    await assert.rejects(
      generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, maxAttempts: 1 },
        fetchImpl: async () =>
          fakeGeminiResponse({ text: "not valid json {" })
      }),
      error => {
        assert.equal(
          error.code,
          PROVIDER_ERROR_CODES.PROVIDER_INVALID_JSON
        );
        return true;
      }
    );
  }

  // -------------------------------------------------------
  // Markdown code fence rejected as invalid JSON, never
  // stripped-and-parsed.
  // -------------------------------------------------------
  {
    await assert.rejects(
      generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, maxAttempts: 1 },
        fetchImpl: async () =>
          fakeGeminiResponse({ text: "```json\n{\"a\":1}\n```" })
      }),
      error => {
        assert.equal(
          error.code,
          PROVIDER_ERROR_CODES.PROVIDER_INVALID_JSON
        );
        return true;
      }
    );
  }

  // -------------------------------------------------------
  // PROVIDER_EMPTY_RESPONSE
  // -------------------------------------------------------
  {
    await assert.rejects(
      generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, maxAttempts: 1 },
        fetchImpl: async () => fakeGeminiResponse({ text: "" })
      }),
      error => {
        assert.equal(
          error.code,
          PROVIDER_ERROR_CODES.PROVIDER_EMPTY_RESPONSE
        );
        return true;
      }
    );
  }

  // -------------------------------------------------------
  // First attempt invalid JSON, repair (2nd attempt) succeeds.
  // -------------------------------------------------------
  {
    let callCount = 0;

    const result = await generateJson({
      task: "TEST",
      systemPrompt: "sp",
      input: { hello: "world" },
      schemaName: "test",
      responseJsonSchema: MINIMAL_TEST_SCHEMA,
      config: { ...BASE_CONFIG, maxAttempts: 2 },
      fetchImpl: async () => {
        callCount += 1;

        if (callCount === 1) {
          return fakeGeminiResponse({ text: "{not json" });
        }

        return fakeGeminiResponse({ text: JSON.stringify({ ok: true }) });
      }
    });

    assert.equal(callCount, 2);
    assert.equal(result.attempt, 2);
    assert.deepEqual(result.data, { ok: true });
  }

  // -------------------------------------------------------
  // Both attempts invalid -> fails closed after exactly 2
  // attempts, never a 3rd.
  // -------------------------------------------------------
  {
    let callCount = 0;

    await assert.rejects(
      generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, maxAttempts: 2 },
        fetchImpl: async () => {
          callCount += 1;
          return fakeGeminiResponse({ text: "still not json" });
        }
      }),
      error => {
        assert.equal(
          error.code,
          PROVIDER_ERROR_CODES.PROVIDER_INVALID_JSON
        );
        return true;
      }
    );

    assert.equal(callCount, 2);
  }

  // -------------------------------------------------------
  // API key must never appear in a thrown error's message.
  // -------------------------------------------------------
  {
    try {
      await generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, maxAttempts: 1 },
        fetchImpl: async () => {
          throw new Error("simulated network failure");
        }
      });
      assert.fail("expected generateJson to throw");
    } catch (error) {
      assert.ok(!String(error.message).includes(BASE_CONFIG.apiKey));
      assert.ok(!String(error.stack || "").includes(BASE_CONFIG.apiKey));
    }
  }

  // -------------------------------------------------------
  // STORY_LLM_MAX_ATTEMPTS is hard-clamped to 2, even if the
  // environment requests more.
  // -------------------------------------------------------
  {
    const previousKey = process.env.GEMINI_API_KEY;
    const previousModel = process.env.STORY_GEMINI_MODEL;
    const previousAttempts = process.env.STORY_LLM_MAX_ATTEMPTS;

    process.env.GEMINI_API_KEY = "test-key";
    process.env.STORY_GEMINI_MODEL = "test-model";
    process.env.STORY_LLM_MAX_ATTEMPTS = "5";

    const config = readProviderConfig();
    assert.equal(config.maxAttempts, 2);

    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;

    if (previousModel === undefined) delete process.env.STORY_GEMINI_MODEL;
    else process.env.STORY_GEMINI_MODEL = previousModel;

    if (previousAttempts === undefined) delete process.env.STORY_LLM_MAX_ATTEMPTS;
    else process.env.STORY_LLM_MAX_ATTEMPTS = previousAttempts;
  }

  // -------------------------------------------------------
  // Unsupported provider name rejected -- never silently
  // falls through to calling the Gemini endpoint anyway.
  // -------------------------------------------------------
  {
    const previousProvider = process.env.STORY_LLM_PROVIDER;
    const previousKey = process.env.GEMINI_API_KEY;
    const previousModel = process.env.STORY_GEMINI_MODEL;

    process.env.STORY_LLM_PROVIDER = "openai";
    process.env.GEMINI_API_KEY = "test-key";
    process.env.STORY_GEMINI_MODEL = "test-model";

    assert.throws(
      () => readProviderConfig(),
      error => {
        assert.ok(error instanceof ProviderError);
        assert.equal(error.code, PROVIDER_ERROR_CODES.PROVIDER_UNSUPPORTED);
        return true;
      }
    );

    if (previousProvider === undefined) delete process.env.STORY_LLM_PROVIDER;
    else process.env.STORY_LLM_PROVIDER = previousProvider;

    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;

    if (previousModel === undefined) delete process.env.STORY_GEMINI_MODEL;
    else process.env.STORY_GEMINI_MODEL = previousModel;
  }

  // -------------------------------------------------------
  // redactSecrets(): a known secret value is masked verbatim.
  // -------------------------------------------------------
  {
    const redacted = redactSecrets(
      "Provider request failed: secret-test-api-key-should-never-leak was rejected",
      ["secret-test-api-key-should-never-leak"]
    );

    assert.ok(!redacted.includes("secret-test-api-key-should-never-leak"));
    assert.ok(redacted.includes("***REDACTED***"));
  }

  // -------------------------------------------------------
  // redactSecrets(): a URL containing ?key=SECRET is redacted
  // even without the secret value being passed explicitly.
  // -------------------------------------------------------
  {
    const redacted = redactSecrets(
      "Provider request failed: fetch to https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5:generateContent?key=SECRET_VALUE_123 timed out"
    );

    assert.ok(!redacted.includes("SECRET_VALUE_123"));
    assert.ok(redacted.includes("key=***REDACTED***"));
  }

  // -------------------------------------------------------
  // redactSecrets(): Authorization / x-goog-api-key header
  // shaped text is redacted.
  // -------------------------------------------------------
  {
    const redacted = redactSecrets(
      'Upstream error: {"x-goog-api-key": "SECRET_HEADER_VALUE"}'
    );

    assert.ok(!redacted.includes("SECRET_HEADER_VALUE"));
  }

  // -------------------------------------------------------
  // End-to-end: a fetch failure whose message happens to leak
  // the request URL (with ?key=...) must come out of
  // generateJson() already redacted, never raw.
  // -------------------------------------------------------
  {
    const leakyApiKey = "leaky-key-in-url-abc123";

    try {
      await generateJson({
        task: "TEST",
        systemPrompt: "sp",
        input: {},
        schemaName: "test",
        responseJsonSchema: MINIMAL_TEST_SCHEMA,
        config: { ...BASE_CONFIG, apiKey: leakyApiKey, maxAttempts: 1 },
        fetchImpl: async url => {
          throw new Error(`fetch failed for ${url}`);
        }
      });
      assert.fail("expected generateJson to throw");
    } catch (error) {
      assert.ok(!String(error.message).includes(leakyApiKey));
    }
  }

  // =========================================================
  // Task 3.4E structured-output hotfix: Gemini is always sent a
  // responseJsonSchema, never asked to "just return valid JSON"
  // and validated only after the fact.
  // =========================================================

  // -------------------------------------------------------
  // D. Missing responseJsonSchema fails closed -- generateJson
  // must never silently fall back to schema-less generation for
  // a Story task.
  // -------------------------------------------------------
  {
    await assert.rejects(
      generateJson({
        task: "STORY_DIRECTIONS",
        systemPrompt: "sp",
        input: {},
        schemaName: "story_directions_v1",
        config: { ...BASE_CONFIG, maxAttempts: 1 },
        fetchImpl: async () => fakeGeminiResponse({ text: "{}" })
      }),
      error => {
        assert.ok(error instanceof ProviderError);
        assert.equal(
          error.code,
          PROVIDER_ERROR_CODES.PROVIDER_RESPONSE_SCHEMA_REQUIRED
        );
        return true;
      }
    );
  }

  // -------------------------------------------------------
  // A. The actual Gemini request carries responseMimeType
  // "application/json" AND responseJsonSchema, with the exact
  // directions/scripts minItems/maxItems and required nested
  // fields -- not just "ask for JSON and hope".
  // -------------------------------------------------------
  {
    let capturedBody = null;

    await generateJson({
      task: "STORY_DIRECTIONS",
      systemPrompt: "sp",
      input: {},
      schemaName: "story_directions_v1",
      responseJsonSchema: STORY_DIRECTIONS_RESPONSE_JSON_SCHEMA,
      config: { ...BASE_CONFIG, maxAttempts: 1 },
      fetchImpl: async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return fakeGeminiResponse({
          text: JSON.stringify({ directions: [] })
        });
      }
    });

    assert.ok(capturedBody);
    assert.equal(
      capturedBody.generationConfig.responseMimeType,
      "application/json"
    );

    const sentSchema = capturedBody.generationConfig.responseJsonSchema;
    assert.deepEqual(sentSchema, STORY_DIRECTIONS_RESPONSE_JSON_SCHEMA);
    assert.equal(sentSchema.properties.directions.minItems, 3);
    assert.equal(sentSchema.properties.directions.maxItems, 4);

    const directionItemSchema = sentSchema.properties.directions.items;

    // Task 3.5E: direction_type is fixed to INTEGRATED_STORY --
    // Vehicle/Country/Person/APEX are evidence layers every
    // direction must fuse, never four separate direction_type
    // values to choose between.
    assert.deepEqual(directionItemSchema.properties.direction_type.enum, [
      "INTEGRATED_STORY"
    ]);

    for (const field of [
      "narrative_emphasis",
      "signal_contributions",
      "vehicle_transformation",
      "character_concept",
      "causal_chain",
      "driver_choice",
      "risk_flags",
      "canon_connections",
      "coverage_status",
      "proposed_state_changes"
    ]) {
      assert.ok(
        directionItemSchema.required.includes(field),
        `Direction schema must require ${field}`
      );
    }

    assert.equal(directionItemSchema.properties.canon_connections.type, "array");
    assert.equal(directionItemSchema.properties.risk_flags.type, "array");
    assert.ok(directionItemSchema.properties.causal_chain.minItems >= 5);

    const signalContributions = directionItemSchema.properties.signal_contributions;
    for (const layer of ["vehicle", "country", "person", "apex"]) {
      assert.ok(
        signalContributions.required.includes(layer),
        `signal_contributions must require the ${layer} layer`
      );
    }

    const stateChangeSchema =
      directionItemSchema.properties.proposed_state_changes.items;
    for (const field of [
      "state",
      "previous_state",
      "target_state",
      "entity_type",
      "reason",
      "evidence_refs"
    ]) {
      assert.ok(
        stateChangeSchema.required.includes(field),
        `proposed_state_changes entry schema must require ${field}`
      );
    }
  }

  // Scripts: exact minItems/maxItems = 3.
  {
    let capturedBody = null;

    await generateJson({
      task: "STORY_SCRIPTS",
      systemPrompt: "sp",
      input: {},
      schemaName: "story_scripts_v1",
      responseJsonSchema: STORY_SCRIPTS_RESPONSE_JSON_SCHEMA,
      config: { ...BASE_CONFIG, maxAttempts: 1 },
      fetchImpl: async (url, options) => {
        capturedBody = JSON.parse(options.body);
        return fakeGeminiResponse({ text: JSON.stringify({ scripts: [] }) });
      }
    });

    const sentSchema = capturedBody.generationConfig.responseJsonSchema;
    assert.equal(sentSchema.properties.scripts.minItems, 3);
    assert.equal(sentSchema.properties.scripts.maxItems, 3);
  }

  // -------------------------------------------------------
  // C. Outline schema mirrors validateOutlineShape's required
  // fields exactly.
  // -------------------------------------------------------
  {
    const required = STORY_OUTLINE_RESPONSE_JSON_SCHEMA.required;

    for (const field of [
      "outline_title",
      "review_summary",
      "opening_situation",
      "inciting_incident",
      "vehicle_and_driver_introduction",
      "world_conflict",
      "qualifier_challenge",
      "escalation",
      "choice_or_sacrifice",
      "outcome",
      "next_episode_hook",
      "canon_state_impact",
      "evidence_map",
      "canon_constraints",
      "forbidden_elements_respected",
      "short_structure"
    ]) {
      assert.ok(
        required.includes(field),
        `Outline schema must require ${field}`
      );
    }
  }

  // Script schema mirrors validateScriptShape / validateScriptBatchShape:
  // exact variant_type enum and shot count bounds.
  {
    const scriptItemSchema = STORY_SCRIPTS_RESPONSE_JSON_SCHEMA.properties.scripts.items;

    assert.deepEqual(scriptItemSchema.properties.variant_type.enum, [
      "VEHICLE_FIRST",
      "WORLD_FIRST",
      "CHARACTER_FIRST"
    ]);

    for (const field of [
      "title",
      "hook",
      "hook_type",
      "vo_text",
      "ending_hook",
      "estimated_duration_seconds",
      "shots",
      "evidence_map",
      "canon_constraints",
      "ip_safety_notes",
      "risk_flags",
      "proposed_state_changes"
    ]) {
      assert.ok(
        scriptItemSchema.required.includes(field),
        `Script schema must require ${field}`
      );
    }

    assert.equal(scriptItemSchema.properties.shots.minItems, 5);
    assert.equal(scriptItemSchema.properties.shots.maxItems, 8);
  }

  // -------------------------------------------------------
  // E. The second (repair) attempt sends the identical
  // responseJsonSchema as the first -- the schema is never
  // relaxed or dropped on retry.
  // -------------------------------------------------------
  {
    const sentSchemas = [];
    const sentInputTexts = [];

    const result = await generateJson({
      task: "STORY_DIRECTIONS",
      systemPrompt: "sp",
      input: { hello: "world" },
      schemaName: "story_directions_v1",
      responseJsonSchema: STORY_DIRECTIONS_RESPONSE_JSON_SCHEMA,
      config: { ...BASE_CONFIG, maxAttempts: 2 },
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        sentSchemas.push(body.generationConfig.responseJsonSchema);
        sentInputTexts.push(body.contents[0].parts[0].text);

        if (sentSchemas.length === 1) {
          return fakeGeminiResponse({ text: "{not json" });
        }

        return fakeGeminiResponse({
          text: JSON.stringify({ directions: [] })
        });
      }
    });

    assert.equal(sentSchemas.length, 2);
    assert.deepEqual(sentSchemas[0], STORY_DIRECTIONS_RESPONSE_JSON_SCHEMA);
    assert.deepEqual(sentSchemas[1], STORY_DIRECTIONS_RESPONSE_JSON_SCHEMA);
    assert.equal(result.attempt, 2);

    // The repair attempt's input asks the model to regenerate
    // the whole value, never to return only the missing fields.
    const secondInput = JSON.parse(sentInputTexts[1]);
    assert.ok(secondInput._repair_context.previous_attempt_failed);
    assert.match(
      secondInput._repair_context.instruction,
      /entire json value/i
    );
    assert.match(
      secondInput._repair_context.instruction,
      /do not return only the/i
    );
  }

  console.log("TASK 3.4E STORY PROVIDER TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

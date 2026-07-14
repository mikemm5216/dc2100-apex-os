const assert = require("node:assert/strict");

const {
  ProviderError,
  PROVIDER_ERROR_CODES,
  readProviderConfig,
  redactSecrets,
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

function fakeGeminiResponse({ ok = true, status = 200, text }) {
  return {
    ok,
    status,
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
  // PROVIDER_RATE_LIMITED (429)
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
        fetchImpl: async () => fakeGeminiResponse({ ok: false, status: 429 })
      }),
      error => {
        assert.equal(
          error.code,
          PROVIDER_ERROR_CODES.PROVIDER_RATE_LIMITED
        );
        return true;
      }
    );
  }

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
    assert.equal(sentSchema.properties.directions.minItems, 4);
    assert.equal(sentSchema.properties.directions.maxItems, 4);

    const directionItemSchema = sentSchema.properties.directions.items;
    for (const field of [
      "beat_connection",
      "vehicle_transformation",
      "character_concept",
      "canon_connections",
      "risk_flags",
      "proposed_state_changes"
    ]) {
      assert.ok(
        directionItemSchema.required.includes(field),
        `Direction schema must require ${field}`
      );
    }

    assert.equal(directionItemSchema.properties.canon_connections.type, "array");
    assert.equal(directionItemSchema.properties.risk_flags.type, "array");

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

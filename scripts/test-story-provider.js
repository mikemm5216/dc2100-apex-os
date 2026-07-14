const assert = require("node:assert/strict");

const {
  ProviderError,
  PROVIDER_ERROR_CODES,
  readProviderConfig,
  generateJson
} = require("../lib/story/provider");

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

  console.log("TASK 3.4E STORY PROVIDER TESTS PASSED");
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});

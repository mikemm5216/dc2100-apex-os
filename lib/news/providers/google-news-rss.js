// =========================================================
// GOOGLE NEWS RSS PROVIDER — Task 3.3D
//
// Reads ONLY public RSS feed metadata: headline, link,
// guid, publish date, source, and a short snippet. It
// never fetches publisher article pages, never scrapes
// full text, and never stores copyrighted article bodies.
// =========================================================

const { XMLParser } = require("fast-xml-parser");

const {
  normalizeSnippet,
  stripHtml
} = require("../normalization");

const PROVIDER_ID = "google-news-rss-v1";

const PROVIDER_LIMITS = {
  TIMEOUT_MS: 10000,
  MAX_RESPONSE_BYTES: 2 * 1024 * 1024,
  CONCURRENCY: 2,
  MAX_RETRIES: 1
};

const USER_AGENT =
  "dc2100-apex-os/0.1 (country-news-radar; metadata-only)";

// DOCTYPE declarations can smuggle entity definitions;
// they are stripped before parsing so no custom entity is
// ever expanded.
function stripDoctype(xml) {
  return String(xml || "").replace(
    /<!DOCTYPE[^>[]*(\[[^\]]*\])?[^>]*>/gi,
    ""
  );
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  // Standard XML entities only; DOCTYPE entities never
  // reach the parser because stripDoctype runs first.
  processEntities: true,
  parseTagValue: false,
  trimValues: true
});

function toArray(value) {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? [value].flat(1) : [value];
}

function textOf(node) {
  if (node === undefined || node === null) {
    return "";
  }

  if (typeof node === "object") {
    return String(node["#text"] ?? "").trim();
  }

  return String(node).trim();
}

function safeHttpUrl(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);

    if (
      parsed.protocol !== "http:" &&
      parsed.protocol !== "https:"
    ) {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function extractDomain(url) {
  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
}

function parsePubDate(value) {
  const raw = String(value || "").trim();

  if (!raw) {
    return null;
  }

  const date = new Date(raw);

  return Number.isNaN(date.getTime())
    ? null
    : date.toISOString();
}

// Parses one RSS document into normalized mention items.
// A malformed item is skipped; it never fails the whole
// query.
function parseRssItems(xml, { queryKey, queryText } = {}) {
  let document;

  try {
    document = parser.parse(stripDoctype(xml));
  } catch (error) {
    const parseError = new Error(
      `RSS parse failed: ${error.message}`
    );

    parseError.code = "RSS_PARSE_FAILED";
    throw parseError;
  }

  const channel = document?.rss?.channel;

  if (!channel) {
    return [];
  }

  const items = toArray(channel.item);
  const results = [];

  let feedRank = 0;

  for (const item of items) {
    feedRank += 1;

    if (!item || typeof item !== "object") {
      continue;
    }

    const title = stripHtml(textOf(item.title));
    const link = safeHttpUrl(textOf(item.link));

    // Items missing a title or a valid HTTP(S) link are
    // skipped.
    if (!title || !link) {
      continue;
    }

    const guidNode = toArray(item.guid)[0];
    const guid = textOf(guidNode) || null;

    const sourceNode = toArray(item.source)[0];
    const sourceName = textOf(sourceNode) || null;

    const sourceUrl =
      sourceNode && typeof sourceNode === "object"
        ? safeHttpUrl(sourceNode["@_url"])
        : null;

    results.push({
      title,
      url: link,
      guid,
      publishedAt: parsePubDate(textOf(item.pubDate)),
      sourceName,
      sourceUrl,
      publisherDomain:
        (sourceUrl && extractDomain(sourceUrl)) ||
        extractDomain(link),
      snippet:
        normalizeSnippet(textOf(item.description)) || null,
      feedRank,
      queryKey: queryKey ?? null,
      queryText: queryText ?? null
    });
  }

  return results;
}

function buildFeedUrl(queryText) {
  const url = new URL(
    "https://news.google.com/rss/search"
  );

  url.searchParams.set("q", queryText);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");

  return url.toString();
}

async function readBodyWithLimit(response, maxBytes) {
  if (!response.body) {
    const text = await response.text();

    if (
      Buffer.byteLength(text, "utf8") > maxBytes
    ) {
      const error = new Error(
        "RSS response exceeded the size limit."
      );

      error.code = "RESPONSE_TOO_LARGE";
      throw error;
    }

    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];

  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    received += value.byteLength;

    if (received > maxBytes) {
      await reader.cancel();

      const error = new Error(
        "RSS response exceeded the size limit."
      );

      error.code = "RESPONSE_TOO_LARGE";
      throw error;
    }

    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function fetchOnce(feedUrl, { timeoutMs }) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    const response = await fetch(feedUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "application/rss+xml, application/xml, text/xml"
      }
    });

    if (!response.ok) {
      const error = new Error(
        `RSS request failed with HTTP ${response.status}.`
      );

      error.code = "RSS_HTTP_ERROR";
      error.statusCode = response.status;
      error.retryable =
        response.status === 429 ||
        response.status >= 500;

      throw error;
    }

    return await readBodyWithLimit(
      response,
      PROVIDER_LIMITS.MAX_RESPONSE_BYTES
    );
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(
        `RSS request timed out after ${timeoutMs}ms.`
      );

      timeoutError.code = "RSS_TIMEOUT";
      timeoutError.retryable = true;
      throw timeoutError;
    }

    if (error.code === undefined) {
      error.code = "RSS_NETWORK_ERROR";
      error.retryable = true;
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Fetches one country query. On failure it retries at most
// once and only for retryable errors (timeout, network,
// 429, 5xx). Every failure carries a structured code.
async function fetchQuery({
  queryKey,
  queryText,
  maxItems = 20,
  timeoutMs = PROVIDER_LIMITS.TIMEOUT_MS
}) {
  const feedUrl = buildFeedUrl(queryText);

  let lastError = null;

  for (
    let attempt = 0;
    attempt <= PROVIDER_LIMITS.MAX_RETRIES;
    attempt += 1
  ) {
    try {
      const xml = await fetchOnce(feedUrl, { timeoutMs });

      const items = parseRssItems(xml, {
        queryKey,
        queryText
      });

      return {
        provider: PROVIDER_ID,
        queryKey,
        queryText,
        items: items.slice(0, maxItems)
      };
    } catch (error) {
      lastError = error;

      if (
        error.retryable !== true ||
        attempt >= PROVIDER_LIMITS.MAX_RETRIES
      ) {
        break;
      }
    }
  }

  throw lastError;
}

// Bounded-concurrency runner used by the engine so a
// country never issues an unbounded burst of requests.
async function mapWithConcurrency(
  inputs,
  limit,
  task
) {
  const results = new Array(inputs.length);
  let nextIndex = 0;

  async function workerLoop() {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;

      if (index >= inputs.length) {
        return;
      }

      try {
        results[index] = {
          ok: true,
          value: await task(inputs[index], index)
        };
      } catch (error) {
        results[index] = {
          ok: false,
          error
        };
      }
    }
  }

  const workerCount = Math.max(
    1,
    Math.min(limit, inputs.length)
  );

  await Promise.all(
    Array.from({ length: workerCount }, workerLoop)
  );

  return results;
}

module.exports = {
  PROVIDER_ID,
  PROVIDER_LIMITS,
  USER_AGENT,
  buildFeedUrl,
  fetchQuery,
  mapWithConcurrency,
  parseRssItems,
  stripDoctype
};

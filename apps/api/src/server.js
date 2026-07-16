const http = require("node:http");
const { URL } = require("node:url");
const pool = require("./db");

const {
  createScannerRun,
  getScannerRun,
  getSignal,
  getVehicleHistoricalDetail,
  listSignals,
  listVehicleHistoricalRanking
} = require("../../../lib/scanner/api");

const {
  createCountryEventVideoRun,
  createCountryNewsRun,
  getCountryDualVideoSignal,
  getCountryEventVideoRun,
  getCountryNewsDetail,
  getCountryNewsRun,
  listCountryDualVideoSignals,
  listCountryNews
} = require("../../../lib/news/api");

const {
  createPersonDirectVideoRun,
  createPersonRadarRun,
  getPersonDirectVideoRun,
  getPersonDualVideoSignal,
  getPersonRadarDetail,
  getPersonRadarRun,
  listPersonDualVideoSignals,
  listPersonRadar
} = require("../../../lib/person/api");

const {
  createFusionRun,
  getFusionCandidateDetail,
  getFusionRun,
  listFusionCandidates,
  listFusionRuns
} = require("../../../lib/fusion/api");

const {
  createAutoFlowRun,
  getAutoFlowRun,
  listAutoFlowRuns,
  cancelAutoFlowRun,
  resumeAutoFlowRun
} = require("../../../lib/autoflow/api");

const {
  createStoryRunHandler,
  listStoryRuns,
  getStoryRun,
  approveCandidateHandler,
  selectDirectionHandler,
  lockOutlineHandler,
  lockScriptHandler,
  regenerateHandler,
  cancelHandler: cancelStoryRunHandler,
  resumeHandler: resumeStoryRunHandler
} = require("../../../lib/story/api");

const { checkStoryAuth, isStoryApiPath } = require("../../../lib/story/auth");

const port = process.env.PORT || 3000;

const VALID_STATUSES = new Set([
  "DISCOVERED",
  "ANALYZED",
  "RECOMMENDED",
  "CEO_APPROVED",
  "PACK_READY",
  "GENERATING",
  "UPLOADED",
  "QA_APPROVED",
  "SCHEDULED",
  "PUBLISHED",
  "ANALYZING",
  "WINNER",
  "RESERVE_SIGNAL",
  "ARCHIVED"
]);

const VALID_TRANSITIONS = {
  DISCOVERED: ["ANALYZED", "ARCHIVED"],
  ANALYZED: ["RECOMMENDED", "ARCHIVED"],
  RECOMMENDED: [
    "CEO_APPROVED",
    "RESERVE_SIGNAL",
    "ARCHIVED"
  ],
  CEO_APPROVED: ["PACK_READY", "ARCHIVED"],
  PACK_READY: ["GENERATING", "ARCHIVED"],
  GENERATING: ["UPLOADED", "PACK_READY", "ARCHIVED"],
  UPLOADED: ["QA_APPROVED", "GENERATING", "ARCHIVED"],
  QA_APPROVED: ["SCHEDULED", "GENERATING", "ARCHIVED"],
  SCHEDULED: ["PUBLISHED", "QA_APPROVED"],
  PUBLISHED: ["ANALYZING"],
  ANALYZING: ["WINNER", "RESERVE_SIGNAL", "ARCHIVED"],
  WINNER: ["ANALYZING"],
  RESERVE_SIGNAL: ["RECOMMENDED", "ARCHIVED"],
  ARCHIVED: []
};

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods":
      "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Idempotency-Key, Authorization"
  });

  res.end(JSON.stringify(data));
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;

    req.on("data", (chunk) => {
      size += chunk.length;

      if (size > 1024 * 1024) {
        reject(new Error("BODY_TOO_LARGE"));
        req.destroy();
        return;
      }

      body += chunk;
    });

    req.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("INVALID_JSON"));
      }
    });

    req.on("error", reject);
  });
}

function validateAutoFlowRunId(runId) {
  return /^[1-9][0-9]*$/.test(runId);
}

function validatePriority(priority) {
  return (
    Number.isInteger(priority) &&
    priority >= 1 &&
    priority <= 5
  );
}

function parseBulkIds(
  input,
  {
    fieldName,
    type
  }
) {
  if (!Array.isArray(input) || input.length === 0) {
    return {
      error: "VALIDATION_ERROR",
      message: `${fieldName} must be a non-empty array.`
    };
  }

  const ids = [
    ...new Set(
      input.map((value) => {
        const normalized = String(value).trim();

        return type === "content"
          ? normalized.toUpperCase()
          : normalized;
      })
    )
  ];

  if (ids.some((id) => !id)) {
    return {
      error: "VALIDATION_ERROR",
      message: `${fieldName} cannot contain empty values.`
    };
  }

  if (ids.length > 500) {
    return {
      error: "BULK_LIMIT_EXCEEDED",
      message:
        "A bulk operation can process at most 500 records."
    };
  }

  if (
    type === "numeric" &&
    ids.some((id) => !/^[0-9]+$/.test(id))
  ) {
    return {
      error: "VALIDATION_ERROR",
      message: `${fieldName} must contain numeric IDs only.`
    };
  }

  if (
    type === "content" &&
    ids.some(
      (id) =>
        !/^P0-[A-Z0-9]+-[A-Z0-9]+-[0-9]{3,}$/.test(id)
    )
  ) {
    return {
      error: "INVALID_CONTENT_ID",
      message:
        `${fieldName} must contain valid P0-{COUNTRY}-{CAR}-{NUMBER} IDs.`
    };
  }

  return {
    ids
  };
}

// Story Pipeline body-parse failures always report the stable
// VALIDATION_ERROR code in the `error` field (never the raw
// readJsonBody() error.message like "INVALID_JSON" or
// "BODY_TOO_LARGE" -- those stay distinguishable only in the
// human-readable `message`).
function storyValidationErrorResponse(res, error) {
  return sendJson(res, 400, {
    error: "VALIDATION_ERROR",
    message:
      error.message === "BODY_TOO_LARGE"
        ? "Request body is too large."
        : "Request body must contain valid JSON."
  });
}

function handleDatabaseError(res, error) {
  console.error("Database error:", error);

  if (error.code === "23505") {
    return sendJson(res, 409, {
      error: "CONFLICT",
      message: "A record with the same unique value already exists."
    });
  }

  if (error.code === "23503") {
    return sendJson(res, 400, {
      error: "INVALID_REFERENCE",
      message: "A referenced record does not exist."
    });
  }

  if (error.code === "23514") {
    return sendJson(res, 400, {
      error: "CONSTRAINT_VIOLATION",
      message: "Submitted data violates a database rule."
    });
  }

  return sendJson(res, 500, {
    error: "INTERNAL_SERVER_ERROR",
    message: "Database operation failed."
  });
}

async function getContentById(queryable, contentId) {
  const contentResult = await queryable.query(
    `
      SELECT
        c.id,
        c.content_id,
        c.title,
        c.status,
        c.priority,
        c.notes,
        c.created_at,
        c.updated_at,

        co.code AS country_code,
        co.name AS country_name,

        v.code AS vehicle_code,
        v.name AS vehicle_name,
        v.manufacturer AS vehicle_manufacturer,
        v.category AS vehicle_category,

        s.id AS signal_id,
        s.external_id AS signal_external_id,
        s.title AS signal_title,
        s.url AS signal_url,
        s.views AS signal_views,
        s.views_per_day AS signal_views_per_day,
        s.growth_velocity AS signal_growth_velocity

      FROM contents c

      LEFT JOIN countries co
        ON co.id = c.country_id

      LEFT JOIN vehicles v
        ON v.id = c.vehicle_id

      LEFT JOIN signals s
        ON s.id = c.signal_id

      WHERE c.content_id = $1
    `,
    [contentId]
  );

  if (contentResult.rowCount === 0) {
    return null;
  }

  const content = contentResult.rows[0];

  const historyResult = await queryable.query(
    `
      SELECT
        id,
        from_status,
        to_status,
        changed_by,
        reason,
        metadata,
        changed_at

      FROM content_status_history

      WHERE content_id = $1

      ORDER BY changed_at ASC, id ASC
    `,
    [content.id]
  );

  return {
    ...content,
    status_history: historyResult.rows
  };
}

async function resolveCountryId(client, countryCode) {
  const result = await client.query(
    `
      SELECT id
      FROM countries
      WHERE code = $1
        AND enabled = TRUE
    `,
    [countryCode]
  );

  return result.rows[0]?.id || null;
}

async function resolveVehicleId(client, vehicleCode) {
  const result = await client.query(
    `
      SELECT id
      FROM vehicles
      WHERE code = $1
        AND enabled = TRUE
    `,
    [vehicleCode]
  );

  return result.rows[0]?.id || null;
}

async function generateContentId(
  client,
  countryCode,
  vehicleCode
) {
  const prefix = `P0-${countryCode}-${vehicleCode}`;

  await client.query(
    `
      SELECT pg_advisory_xact_lock(hashtext($1))
    `,
    [prefix]
  );

  const result = await client.query(
    `
      SELECT COALESCE(
        MAX(
          (
            substring(
              content_id
              from '([0-9]+)$'
            )
          )::integer
        ),
        0
      ) AS max_number

      FROM contents

      WHERE content_id LIKE $1
    `,
    [`${prefix}-%`]
  );

  const nextNumber =
    Number(result.rows[0].max_number) + 1;

  return `${prefix}-${String(nextNumber).padStart(3, "0")}`;
}


async function getSourceById(queryable, sourceId) {
  const result = await queryable.query(
    `
      SELECT
        src.id,
        src.name,
        src.url,
        src.platform,
        src.category,
        src.priority,
        src.enabled,
        src.last_scan_at,
        src.created_at,
        src.updated_at,

        co.code AS country_code,
        co.name AS country_name,

        (
          SELECT COUNT(*)::int
          FROM signals sig
          WHERE sig.source_id = src.id
        ) AS signal_count

      FROM sources src

      LEFT JOIN countries co
        ON co.id = src.country_id

      WHERE src.id = $1
    `,
    [sourceId]
  );

  return result.rows[0] || null;
}

// Wrapped in a factory (rather than built directly against the
// module-level `pool`) so tests can spin up a real http.Server
// bound to an ephemeral port against a mock pool, without a
// live Postgres connection and without the module-load side
// effect of binding the real service port -- see the
// `if (require.main === module)` guard below.
function createRequestHandler(pool) {
  return async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":
        "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Idempotency-Key, Authorization"
    });

    return res.end();
  }

  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  const pathname = requestUrl.pathname;

  // =======================================================
  // STORY API AUTHENTICATION (Task 3.4E Production Hardening)
  //
  // Gated before any other routing -- including before the
  // body is ever read -- so an unauthorized request never
  // reaches a handler and never has its (possibly oversized)
  // payload parsed. Scoped to /api/story/* only: it must never
  // gate Scanner, Country News, Person Radar, Fusion, AutoFlow,
  // or the health endpoints.
  // =======================================================

  if (isStoryApiPath(pathname)) {
    const authResult = checkStoryAuth(req.headers);

    if (!authResult.ok) {
      return sendJson(res, authResult.statusCode, authResult.body);
    }
  }

  // =======================================================
  // HEALTH
  // =======================================================

  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, {
      status: "ok",
      service: "apex-api"
    });
  }

  if (req.method === "GET" && pathname === "/health/db") {
    try {
      await pool.query("SELECT 1");

      return sendJson(res, 200, {
        status: "ok",
        database: "connected"
      });
    } catch (error) {
      console.error(
        "Database health check failed:",
        error.message
      );

      return sendJson(res, 500, {
        status: "error",
        database: "disconnected"
      });
    }
  }

  // =======================================================
  // GET /sources
  // POST /sources
  // =======================================================

  if (req.method === "GET" && pathname === "/sources") {
    try {
      const result = await pool.query(`
        SELECT
          src.id,
          src.name,
          src.url,
          src.platform,
          src.category,
          src.priority,
          src.enabled,
          src.last_scan_at,
          src.created_at,
          src.updated_at,

          co.code AS country_code,
          co.name AS country_name,

          (
            SELECT COUNT(*)::int
            FROM signals sig
            WHERE sig.source_id = src.id
          ) AS signal_count

        FROM sources src

        LEFT JOIN countries co
          ON co.id = src.country_id

        ORDER BY
          src.enabled DESC,
          src.priority ASC,
          src.name ASC
      `);

      return sendJson(res, 200, {
        data: result.rows,
        count: result.rowCount
      });
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  if (req.method === "POST" && pathname === "/sources") {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message: "Request body must contain valid JSON."
      });
    }

    const name = String(body.name || "").trim();
    const sourceUrl = String(body.url || "").trim();
    const platform = String(body.platform || "").trim();
    const category = String(body.category || "").trim();

    const countryCode = body.country_code
      ? String(body.country_code).trim().toUpperCase()
      : null;

    const priority =
      body.priority === undefined ? 3 : body.priority;

    const enabled =
      body.enabled === undefined ? true : body.enabled;

    if (!name || !sourceUrl || !platform || !category) {
      return sendJson(res, 400, {
        error: "VALIDATION_ERROR",
        message:
          "name, url, platform, and category are required."
      });
    }

    try {
      const parsedUrl = new URL(sourceUrl);

      if (
        parsedUrl.protocol !== "http:" &&
        parsedUrl.protocol !== "https:"
      ) {
        throw new Error("Unsupported URL protocol.");
      }
    } catch {
      return sendJson(res, 400, {
        error: "INVALID_URL",
        message: "url must be a valid HTTP or HTTPS URL."
      });
    }

    if (!validatePriority(priority)) {
      return sendJson(res, 400, {
        error: "VALIDATION_ERROR",
        message: "priority must be an integer from 1 to 5."
      });
    }

    if (typeof enabled !== "boolean") {
      return sendJson(res, 400, {
        error: "VALIDATION_ERROR",
        message: "enabled must be a boolean."
      });
    }

    try {
      let countryId = null;

      if (countryCode) {
        countryId = await resolveCountryId(
          pool,
          countryCode
        );

        if (!countryId) {
          return sendJson(res, 400, {
            error: "INVALID_COUNTRY",
            message:
              `Country ${countryCode} does not exist or is disabled.`
          });
        }
      }

      const result = await pool.query(
        `
          INSERT INTO sources (
            name,
            url,
            platform,
            category,
            country_id,
            priority,
            enabled
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7
          )
          RETURNING id
        `,
        [
          name,
          sourceUrl,
          platform,
          category,
          countryId,
          priority,
          enabled
        ]
      );

      const created = await getSourceById(
        pool,
        result.rows[0].id
      );

      return sendJson(res, 201, {
        data: created
      });
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  // =======================================================
  // PATCH /sources/bulk
  // DELETE /sources/bulk
  // =======================================================

  if (
    pathname === "/sources/bulk" &&
    (
      req.method === "PATCH" ||
      req.method === "DELETE"
    )
  ) {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message:
          "Request body must contain valid JSON."
      });
    }

    const parsedIds = parseBulkIds(body.ids, {
      fieldName: "ids",
      type: "numeric"
    });

    if (parsedIds.error) {
      return sendJson(res, 400, parsedIds);
    }

    const ids = parsedIds.ids;

    if (req.method === "PATCH") {
      const action = String(
        body.action || ""
      ).trim();

      try {
        let result;

        if (
          action === "enable" ||
          action === "disable"
        ) {
          result = await pool.query(
            `
              UPDATE sources
              SET enabled = $1
              WHERE id = ANY($2::bigint[])
              RETURNING id
            `,
            [
              action === "enable",
              ids
            ]
          );
        } else if (action === "set_priority") {
          if (!validatePriority(body.priority)) {
            return sendJson(res, 400, {
              error: "VALIDATION_ERROR",
              message:
                "priority must be an integer from 1 to 5."
            });
          }

          result = await pool.query(
            `
              UPDATE sources
              SET priority = $1
              WHERE id = ANY($2::bigint[])
              RETURNING id
            `,
            [
              body.priority,
              ids
            ]
          );
        } else {
          return sendJson(res, 400, {
            error: "INVALID_BULK_ACTION",
            message:
              "action must be enable, disable, or set_priority."
          });
        }

        return sendJson(res, 200, {
          data: {
            requested_count: ids.length,
            updated_count: result.rowCount,
            action,
            source_ids: result.rows.map(
              (row) => String(row.id)
            )
          }
        });
      } catch (error) {
        return handleDatabaseError(res, error);
      }
    }

    try {
      const result = await pool.query(
        `
          DELETE FROM sources
          WHERE id = ANY($1::bigint[])
          RETURNING id, name
        `,
        [ids]
      );

      return sendJson(res, 200, {
        data: {
          requested_count: ids.length,
          deleted_count: result.rowCount,
          deleted_sources: result.rows
        }
      });
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  // =======================================================
  // GET /sources/:id
  // PATCH /sources/:id
  // DELETE /sources/:id
  // =======================================================

  const sourceMatch = pathname.match(
    /^\/sources\/([0-9]+)$/
  );

  if (sourceMatch) {
    const sourceId = sourceMatch[1];

    if (req.method === "GET") {
      try {
        const source = await getSourceById(
          pool,
          sourceId
        );

        if (!source) {
          return sendJson(res, 404, {
            error: "SOURCE_NOT_FOUND",
            message: `Source ${sourceId} was not found.`
          });
        }

        return sendJson(res, 200, {
          data: source
        });
      } catch (error) {
        return handleDatabaseError(res, error);
      }
    }

    if (req.method === "PATCH") {
      let body;

      try {
        body = await readJsonBody(req);
      } catch (error) {
        return sendJson(res, 400, {
          error: error.message,
          message: "Request body must contain valid JSON."
        });
      }

      const updates = [];
      const values = [];

      function addSourceUpdate(column, value) {
        values.push(value);
        updates.push(`${column} = $${values.length}`);
      }

      if (body.name !== undefined) {
        const value = String(body.name).trim();

        if (!value) {
          return sendJson(res, 400, {
            error: "VALIDATION_ERROR",
            message: "name cannot be empty."
          });
        }

        addSourceUpdate("name", value);
      }

      if (body.url !== undefined) {
        const value = String(body.url).trim();

        try {
          const parsedUrl = new URL(value);

          if (
            parsedUrl.protocol !== "http:" &&
            parsedUrl.protocol !== "https:"
          ) {
            throw new Error("Unsupported URL protocol.");
          }
        } catch {
          return sendJson(res, 400, {
            error: "INVALID_URL",
            message:
              "url must be a valid HTTP or HTTPS URL."
          });
        }

        addSourceUpdate("url", value);
      }

      if (body.platform !== undefined) {
        const value = String(body.platform).trim();

        if (!value) {
          return sendJson(res, 400, {
            error: "VALIDATION_ERROR",
            message: "platform cannot be empty."
          });
        }

        addSourceUpdate("platform", value);
      }

      if (body.category !== undefined) {
        const value = String(body.category).trim();

        if (!value) {
          return sendJson(res, 400, {
            error: "VALIDATION_ERROR",
            message: "category cannot be empty."
          });
        }

        addSourceUpdate("category", value);
      }

      if (body.priority !== undefined) {
        if (!validatePriority(body.priority)) {
          return sendJson(res, 400, {
            error: "VALIDATION_ERROR",
            message:
              "priority must be an integer from 1 to 5."
          });
        }

        addSourceUpdate("priority", body.priority);
      }

      if (body.enabled !== undefined) {
        if (typeof body.enabled !== "boolean") {
          return sendJson(res, 400, {
            error: "VALIDATION_ERROR",
            message: "enabled must be a boolean."
          });
        }

        addSourceUpdate("enabled", body.enabled);
      }

      if (body.country_code !== undefined) {
        if (
          body.country_code === null ||
          String(body.country_code).trim() === ""
        ) {
          addSourceUpdate("country_id", null);
        } else {
          const countryCode = String(
            body.country_code
          )
            .trim()
            .toUpperCase();

          const countryId = await resolveCountryId(
            pool,
            countryCode
          );

          if (!countryId) {
            return sendJson(res, 400, {
              error: "INVALID_COUNTRY",
              message:
                `Country ${countryCode} does not exist or is disabled.`
            });
          }

          addSourceUpdate("country_id", countryId);
        }
      }

      if (updates.length === 0) {
        return sendJson(res, 400, {
          error: "NO_UPDATES",
          message:
            "Provide at least one editable source field."
        });
      }

      values.push(sourceId);

      try {
        const updateResult = await pool.query(
          `
            UPDATE sources
            SET ${updates.join(", ")}
            WHERE id = $${values.length}
            RETURNING id
          `,
          values
        );

        if (updateResult.rowCount === 0) {
          return sendJson(res, 404, {
            error: "SOURCE_NOT_FOUND",
            message: `Source ${sourceId} was not found.`
          });
        }

        const updated = await getSourceById(
          pool,
          sourceId
        );

        return sendJson(res, 200, {
          data: updated
        });
      } catch (error) {
        return handleDatabaseError(res, error);
      }
    }

    if (req.method === "DELETE") {
      try {
        const result = await pool.query(
          `
            DELETE FROM sources
            WHERE id = $1
            RETURNING id, name
          `,
          [sourceId]
        );

        if (result.rowCount === 0) {
          return sendJson(res, 404, {
            error: "SOURCE_NOT_FOUND",
            message: `Source ${sourceId} was not found.`
          });
        }

        return sendJson(res, 200, {
          data: result.rows[0],
          deleted: true
        });
      } catch (error) {
        return handleDatabaseError(res, error);
      }
    }
  }

  // =======================================================
  // SCANNER + SIGNALS
  // =======================================================

  if (
    req.method === "POST" &&
    pathname === "/scanner/run"
  ) {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(
        res,
        400,
        {
          error: error.message,
          message:
            "Request body must contain valid JSON."
        }
      );
    }

    try {
      const result =
        await createScannerRun(
          pool,
          body
        );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(
        res,
        error
      );
    }
  }

  const scannerRunMatch =
    pathname.match(
      /^\/scanner\/runs\/([0-9]+)$/
    );

  if (
    req.method === "GET" &&
    scannerRunMatch
  ) {
    try {
      const result =
        await getScannerRun(
          pool,
          scannerRunMatch[1]
        );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(
        res,
        error
      );
    }
  }

  if (
    req.method === "GET" &&
    pathname === "/signals"
  ) {
    try {
      const result =
        await listSignals(
          pool,
          requestUrl.searchParams
        );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(
        res,
        error
      );
    }
  }

  const signalMatch =
    pathname.match(
      /^\/signals\/([0-9]+)$/
    );

  if (
    req.method === "GET" &&
    signalMatch
  ) {
    try {
      const result =
        await getSignal(
          pool,
          signalMatch[1]
        );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(
        res,
        error
      );
    }
  }

  // =======================================================
  // VEHICLE HISTORICAL TOP 10
  // =======================================================

  if (
    req.method === "GET" &&
    pathname === "/vehicle-historical-ranking"
  ) {
    try {
      const result =
        await listVehicleHistoricalRanking(
          pool,
          requestUrl.searchParams
        );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(
        res,
        error
      );
    }
  }

  const vehicleHistoricalDetailMatch =
    pathname.match(
      /^\/vehicle-historical-ranking\/([0-9]+)$/
    );

  if (
    req.method === "GET" &&
    vehicleHistoricalDetailMatch
  ) {
    try {
      const result =
        await getVehicleHistoricalDetail(
          pool,
          vehicleHistoricalDetailMatch[1],
          requestUrl.searchParams
        );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(
        res,
        error
      );
    }
  }

  // =======================================================
  // COUNTRY NEWS
  // =======================================================

  if (
    req.method === "POST" &&
    pathname === "/country-news/run"
  ) {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message:
          "Request body must contain valid JSON."
      });
    }

    try {
      const result =
        await createCountryNewsRun(pool, body);

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const countryNewsRunMatch = pathname.match(
    /^\/country-news\/runs\/([0-9]+)$/
  );

  if (
    req.method === "GET" &&
    countryNewsRunMatch
  ) {
    try {
      const result = await getCountryNewsRun(
        pool,
        countryNewsRunMatch[1]
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  if (
    req.method === "GET" &&
    pathname === "/country-news"
  ) {
    try {
      const result = await listCountryNews(
        pool,
        requestUrl.searchParams
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const countryNewsMatch = pathname.match(
    /^\/country-news\/([0-9]+)$/
  );

  if (
    req.method === "GET" &&
    countryNewsMatch
  ) {
    try {
      const result = await getCountryNewsDetail(
        pool,
        countryNewsMatch[1]
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  // =======================================================
  // COUNTRY DUAL-VIDEO SIGNAL PACK
  // =======================================================

  if (
    req.method === "POST" &&
    pathname === "/country-dual-video-signals/run"
  ) {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message:
          "Request body must contain valid JSON."
      });
    }

    try {
      const result =
        await createCountryEventVideoRun(pool, body);

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const countryEventVideoRunMatch = pathname.match(
    /^\/country-dual-video-signals\/runs\/([0-9]+)$/
  );

  if (
    req.method === "GET" &&
    countryEventVideoRunMatch
  ) {
    try {
      const result = await getCountryEventVideoRun(
        pool,
        countryEventVideoRunMatch[1]
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  if (
    req.method === "GET" &&
    pathname === "/country-dual-video-signals"
  ) {
    try {
      const result = await listCountryDualVideoSignals(
        pool,
        requestUrl.searchParams
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const countryDualVideoMatch = pathname.match(
    /^\/country-dual-video-signals\/([0-9]+)$/
  );

  if (
    req.method === "GET" &&
    countryDualVideoMatch
  ) {
    try {
      const result = await getCountryDualVideoSignal(
        pool,
        countryDualVideoMatch[1],
        requestUrl.searchParams
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  // =======================================================
  // PERSON RADAR
  // =======================================================

  if (
    req.method === "POST" &&
    pathname === "/person-radar/run"
  ) {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message:
          "Request body must contain valid JSON."
      });
    }

    try {
      const result =
        await createPersonRadarRun(pool, body);

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const personRadarRunMatch = pathname.match(
    /^\/person-radar\/runs\/([0-9]+)$/
  );

  if (
    req.method === "GET" &&
    personRadarRunMatch
  ) {
    try {
      const result = await getPersonRadarRun(
        pool,
        personRadarRunMatch[1]
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  if (
    req.method === "GET" &&
    pathname === "/person-radar"
  ) {
    try {
      const result = await listPersonRadar(
        pool,
        requestUrl.searchParams
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const personRadarMatch = pathname.match(
    /^\/person-radar\/([0-9]+)$/
  );

  if (
    req.method === "GET" &&
    personRadarMatch
  ) {
    try {
      const result = await getPersonRadarDetail(
        pool,
        personRadarMatch[1]
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  // =======================================================
  // PERSON DUAL-VIDEO SIGNAL PACK
  // =======================================================

  if (
    req.method === "POST" &&
    pathname === "/person-dual-video-signals/run"
  ) {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message:
          "Request body must contain valid JSON."
      });
    }

    try {
      const result =
        await createPersonDirectVideoRun(pool, body);

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const personDirectVideoRunMatch = pathname.match(
    /^\/person-dual-video-signals\/runs\/([0-9]+)$/
  );

  if (
    req.method === "GET" &&
    personDirectVideoRunMatch
  ) {
    try {
      const result = await getPersonDirectVideoRun(
        pool,
        personDirectVideoRunMatch[1]
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  if (
    req.method === "GET" &&
    pathname === "/person-dual-video-signals"
  ) {
    try {
      const result = await listPersonDualVideoSignals(
        pool,
        requestUrl.searchParams
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const personDualVideoMatch = pathname.match(
    /^\/person-dual-video-signals\/([0-9]+)$/
  );

  if (
    req.method === "GET" &&
    personDualVideoMatch
  ) {
    try {
      const result = await getPersonDualVideoSignal(
        pool,
        personDualVideoMatch[1],
        requestUrl.searchParams
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  // =======================================================
  // FUSION (Task 3.3F)
  // =======================================================

  if (
    req.method === "POST" &&
    pathname === "/fusion/run"
  ) {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message:
          "Request body must contain valid JSON."
      });
    }

    try {
      const result = await createFusionRun(pool, body);

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const fusionRunMatch = pathname.match(
    /^\/fusion\/runs\/([0-9]+)$/
  );

  if (req.method === "GET" && fusionRunMatch) {
    try {
      const result = await getFusionRun(
        pool,
        fusionRunMatch[1]
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  if (req.method === "GET" && pathname === "/fusion/runs") {
    try {
      const result = await listFusionRuns(
        pool,
        requestUrl.searchParams
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const fusionCandidateMatch = pathname.match(
    /^\/fusion\/candidates\/([0-9]+)$/
  );

  if (req.method === "GET" && fusionCandidateMatch) {
    try {
      const result = await getFusionCandidateDetail(
        pool,
        fusionCandidateMatch[1]
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  if (
    req.method === "GET" &&
    pathname === "/fusion/candidates"
  ) {
    try {
      const result = await listFusionCandidates(
        pool,
        requestUrl.searchParams
      );

      return sendJson(
        res,
        result.statusCode,
        result.payload
      );
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  // =======================================================
  // AUTOFLOW (Task 3.3G.3)
  //
  // Create only queues the run and seeds its six fixed steps
  // -- advancing a run (calling into the four domains) is
  // worker territory (3.3G.4), never triggered from a request.
  // =======================================================

  if (
    req.method === "POST" &&
    pathname === "/api/autoflow/runs"
  ) {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message: "Request body must contain valid JSON."
      });
    }

    try {
      const result = await createAutoFlowRun(pool, body, {
        requestedBy: "api",
        idempotencyKey: req.headers["idempotency-key"]
      });

      return sendJson(res, result.statusCode, result.payload);
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  if (
    req.method === "GET" &&
    pathname === "/api/autoflow/runs"
  ) {
    try {
      const result = await listAutoFlowRuns(
        pool,
        requestUrl.searchParams
      );

      return sendJson(res, result.statusCode, result.payload);
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const autoflowCancelMatch = pathname.match(
    /^\/api\/autoflow\/runs\/([^/]+)\/cancel$/
  );

  if (req.method === "POST" && autoflowCancelMatch) {
    const runId = autoflowCancelMatch[1];

    if (!validateAutoFlowRunId(runId)) {
      return sendJson(res, 400, {
        error: "VALIDATION_ERROR",
        message: "runId must be a positive integer."
      });
    }

    try {
      const result = await cancelAutoFlowRun(pool, runId);

      return sendJson(res, result.statusCode, result.payload);
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const autoflowResumeMatch = pathname.match(
    /^\/api\/autoflow\/runs\/([^/]+)\/resume$/
  );

  if (req.method === "POST" && autoflowResumeMatch) {
    const runId = autoflowResumeMatch[1];

    if (!validateAutoFlowRunId(runId)) {
      return sendJson(res, 400, {
        error: "VALIDATION_ERROR",
        message: "runId must be a positive integer."
      });
    }

    try {
      const result = await resumeAutoFlowRun(pool, runId);

      return sendJson(res, result.statusCode, result.payload);
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const autoflowRunMatch = pathname.match(
    /^\/api\/autoflow\/runs\/([^/]+)$/
  );

  if (req.method === "GET" && autoflowRunMatch) {
    const runId = autoflowRunMatch[1];

    if (!validateAutoFlowRunId(runId)) {
      return sendJson(res, 400, {
        error: "VALIDATION_ERROR",
        message: "runId must be a positive integer."
      });
    }

    try {
      const result = await getAutoFlowRun(pool, runId);

      return sendJson(res, result.statusCode, result.payload);
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  // =======================================================
  // STORY PIPELINE (Task 3.4E)
  // =======================================================

  if (req.method === "POST" && pathname === "/api/story/runs") {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return storyValidationErrorResponse(res, error);
    }

    try {
      const result = await createStoryRunHandler(pool, body, {
        idempotencyKey: req.headers["idempotency-key"]
      });

      return sendJson(res, result.statusCode, result.payload);
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  if (req.method === "GET" && pathname === "/api/story/runs") {
    try {
      const result = await listStoryRuns(pool, requestUrl.searchParams);

      return sendJson(res, result.statusCode, result.payload);
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const storyGateMatch = pathname.match(
    /^\/api\/story\/runs\/([0-9]+)\/(approve-candidate|select-direction|lock-outline|lock-script|regenerate|cancel|resume)$/
  );

  if (req.method === "POST" && storyGateMatch) {
    const [, runId, action] = storyGateMatch;

    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return storyValidationErrorResponse(res, error);
    }

    const actionHandlers = {
      "approve-candidate": approveCandidateHandler,
      "select-direction": selectDirectionHandler,
      "lock-outline": lockOutlineHandler,
      "lock-script": lockScriptHandler,
      regenerate: regenerateHandler,
      cancel: cancelStoryRunHandler,
      resume: resumeStoryRunHandler
    };

    try {
      const result = await actionHandlers[action](pool, runId, body);

      return sendJson(res, result.statusCode, result.payload);
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  const storyRunMatch = pathname.match(/^\/api\/story\/runs\/([0-9]+)$/);

  if (req.method === "GET" && storyRunMatch) {
    try {
      const result = await getStoryRun(pool, storyRunMatch[1]);

      return sendJson(res, result.statusCode, result.payload);
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  // =======================================================
  // GET /contents
  // =======================================================

  if (req.method === "GET" && pathname === "/contents") {
    try {
      const result = await pool.query(`
        SELECT
          c.id,
          c.content_id,
          c.title,
          c.status,
          c.priority,
          c.notes,
          c.created_at,
          c.updated_at,

          co.code AS country_code,
          co.name AS country_name,

          v.code AS vehicle_code,
          v.name AS vehicle_name,

          s.id AS signal_id,
          s.title AS signal_title,
          s.url AS signal_url

        FROM contents c

        LEFT JOIN countries co
          ON co.id = c.country_id

        LEFT JOIN vehicles v
          ON v.id = c.vehicle_id

        LEFT JOIN signals s
          ON s.id = c.signal_id

        ORDER BY
          c.priority ASC,
          c.created_at DESC
      `);

      return sendJson(res, 200, {
        data: result.rows,
        count: result.rowCount
      });
    } catch (error) {
      return handleDatabaseError(res, error);
    }
  }

  // =======================================================
  // POST /contents
  // =======================================================

  if (req.method === "POST" && pathname === "/contents") {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message: "Request body must contain valid JSON."
      });
    }

    const countryCode = String(
      body.country_code || ""
    ).toUpperCase();

    const vehicleCode = String(
      body.vehicle_code || ""
    ).toUpperCase();

    const title = String(body.title || "").trim();

    const priority =
      body.priority === undefined ? 3 : body.priority;

    if (!countryCode || !vehicleCode || !title) {
      return sendJson(res, 400, {
        error: "VALIDATION_ERROR",
        message:
          "country_code, vehicle_code, and title are required."
      });
    }

    if (!validatePriority(priority)) {
      return sendJson(res, 400, {
        error: "VALIDATION_ERROR",
        message: "priority must be an integer from 1 to 5."
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const countryId = await resolveCountryId(
        client,
        countryCode
      );

      if (!countryId) {
        await client.query("ROLLBACK");

        return sendJson(res, 400, {
          error: "INVALID_COUNTRY",
          message: `Country ${countryCode} does not exist or is disabled.`
        });
      }

      const vehicleId = await resolveVehicleId(
        client,
        vehicleCode
      );

      if (!vehicleId) {
        await client.query("ROLLBACK");

        return sendJson(res, 400, {
          error: "INVALID_VEHICLE",
          message: `Vehicle ${vehicleCode} does not exist or is disabled.`
        });
      }

      let signalId = null;

      if (body.signal_id !== undefined && body.signal_id !== null) {
        const signalResult = await client.query(
          `
            SELECT id
            FROM signals
            WHERE id = $1
          `,
          [body.signal_id]
        );

        if (signalResult.rowCount === 0) {
          await client.query("ROLLBACK");

          return sendJson(res, 400, {
            error: "INVALID_SIGNAL",
            message: `Signal ${body.signal_id} does not exist.`
          });
        }

        signalId = signalResult.rows[0].id;
      }

      let contentId;

      if (body.content_id) {
        contentId = String(body.content_id).toUpperCase();

        if (
          !/^P0-[A-Z0-9]+-[A-Z0-9]+-[0-9]{3,}$/.test(
            contentId
          )
        ) {
          await client.query("ROLLBACK");

          return sendJson(res, 400, {
            error: "INVALID_CONTENT_ID",
            message:
              "content_id must match P0-{COUNTRY}-{CAR}-{NUMBER}."
          });
        }
      } else {
        contentId = await generateContentId(
          client,
          countryCode,
          vehicleCode
        );
      }

      const insertResult = await client.query(
        `
          INSERT INTO contents (
            content_id,
            signal_id,
            country_id,
            vehicle_id,
            title,
            status,
            priority,
            notes
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            'DISCOVERED',
            $6,
            $7
          )
          RETURNING id
        `,
        [
          contentId,
          signalId,
          countryId,
          vehicleId,
          title,
          priority,
          body.notes ?? null
        ]
      );

      await client.query(
        `
          INSERT INTO content_status_history (
            content_id,
            from_status,
            to_status,
            changed_by,
            reason,
            metadata
          )
          VALUES (
            $1,
            NULL,
            'DISCOVERED',
            $2,
            $3,
            $4::jsonb
          )
        `,
        [
          insertResult.rows[0].id,
          body.changed_by || "api",
          "Content created",
          JSON.stringify({
            source: "POST /contents"
          })
        ]
      );

      await client.query("COMMIT");

      const created = await getContentById(
        pool,
        contentId
      );

      return sendJson(res, 201, {
        data: created
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failure.
      }

      return handleDatabaseError(res, error);
    } finally {
      client.release();
    }
  }

  // =======================================================
  // PATCH /contents/:id/status
  // =======================================================

  const statusMatch = pathname.match(
    /^\/contents\/(?!bulk\/)([^/]+)\/status$/
  );

  if (req.method === "PATCH" && statusMatch) {
    const contentId = decodeURIComponent(statusMatch[1]);

    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message: "Request body must contain valid JSON."
      });
    }

    const nextStatus = String(
      body.status || ""
    ).toUpperCase();

    if (!VALID_STATUSES.has(nextStatus)) {
      return sendJson(res, 400, {
        error: "INVALID_STATUS",
        message: `${nextStatus || "(empty)"} is not a valid workflow status.`
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const currentResult = await client.query(
        `
          SELECT id, status
          FROM contents
          WHERE content_id = $1
          FOR UPDATE
        `,
        [contentId]
      );

      if (currentResult.rowCount === 0) {
        await client.query("ROLLBACK");

        return sendJson(res, 404, {
          error: "CONTENT_NOT_FOUND",
          message: `Content ${contentId} was not found.`
        });
      }

      const contentDbId = currentResult.rows[0].id;
      const currentStatus = currentResult.rows[0].status;

      const allowed =
        VALID_TRANSITIONS[currentStatus] || [];

      if (!allowed.includes(nextStatus)) {
        await client.query("ROLLBACK");

        return sendJson(res, 409, {
          error: "INVALID_STATUS_TRANSITION",
          message:
            `${currentStatus} cannot transition directly to ${nextStatus}.`,
          current_status: currentStatus,
          requested_status: nextStatus,
          allowed_transitions: allowed
        });
      }

      await client.query(
        `
          UPDATE contents
          SET status = $1
          WHERE id = $2
        `,
        [nextStatus, contentDbId]
      );

      await client.query(
        `
          INSERT INTO content_status_history (
            content_id,
            from_status,
            to_status,
            changed_by,
            reason,
            metadata
          )
          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6::jsonb
          )
        `,
        [
          contentDbId,
          currentStatus,
          nextStatus,
          body.changed_by || "api",
          body.reason || null,
          JSON.stringify(body.metadata || {})
        ]
      );

      await client.query("COMMIT");

      const updated = await getContentById(
        pool,
        contentId
      );

      return sendJson(res, 200, {
        data: updated
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failure.
      }

      return handleDatabaseError(res, error);
    } finally {
      client.release();
    }
  }

  // =======================================================
  // PATCH /contents/bulk/status
  // =======================================================

  if (
    req.method === "PATCH" &&
    pathname === "/contents/bulk/status"
  ) {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message:
          "Request body must contain valid JSON."
      });
    }

    const parsedIds = parseBulkIds(
      body.content_ids,
      {
        fieldName: "content_ids",
        type: "content"
      }
    );

    if (parsedIds.error) {
      return sendJson(res, 400, parsedIds);
    }

    const contentIds = parsedIds.ids;

    const nextStatus = String(
      body.status || ""
    )
      .trim()
      .toUpperCase();

    if (!VALID_STATUSES.has(nextStatus)) {
      return sendJson(res, 400, {
        error: "INVALID_STATUS",
        message:
          `${nextStatus || "(empty)"} is not a valid workflow status.`
      });
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const currentResult = await client.query(
        `
          SELECT
            id,
            content_id,
            status
          FROM contents
          WHERE content_id = ANY($1::text[])
          ORDER BY id
          FOR UPDATE
        `,
        [contentIds]
      );

      const foundIds = new Set(
        currentResult.rows.map(
          (row) => row.content_id
        )
      );

      const missingIds = contentIds.filter(
        (contentId) => !foundIds.has(contentId)
      );

      if (missingIds.length > 0) {
        await client.query("ROLLBACK");

        return sendJson(res, 404, {
          error: "CONTENT_NOT_FOUND",
          message:
            "One or more Content Candidates were not found.",
          missing_content_ids: missingIds
        });
      }

      const invalidTransitions =
        currentResult.rows
          .map((row) => {
            const allowed =
              VALID_TRANSITIONS[row.status] || [];

            if (allowed.includes(nextStatus)) {
              return null;
            }

            return {
              content_id: row.content_id,
              current_status: row.status,
              requested_status: nextStatus,
              allowed_transitions: allowed
            };
          })
          .filter(Boolean);

      if (invalidTransitions.length > 0) {
        await client.query("ROLLBACK");

        return sendJson(res, 409, {
          error: "INVALID_STATUS_TRANSITION",
          message:
            "The entire bulk status operation was rejected.",
          invalid_transitions: invalidTransitions
        });
      }

      const updateResult = await client.query(
        `
          UPDATE contents
          SET status = $1
          WHERE content_id = ANY($2::text[])
          RETURNING content_id
        `,
        [
          nextStatus,
          contentIds
        ]
      );

      await client.query(
        `
          INSERT INTO content_status_history (
            content_id,
            from_status,
            to_status,
            changed_by,
            reason,
            metadata
          )
          SELECT
            history.content_id,
            history.from_status,
            $3,
            $4,
            $5,
            $6::jsonb
          FROM unnest(
            $1::bigint[],
            $2::text[]
          ) AS history(
            content_id,
            from_status
          )
        `,
        [
          currentResult.rows.map(
            (row) => row.id
          ),
          currentResult.rows.map(
            (row) => row.status
          ),
          nextStatus,
          String(
            body.changed_by || "api"
          ).trim() || "api",
          body.reason || null,
          JSON.stringify(body.metadata || {})
        ]
      );

      await client.query("COMMIT");

      return sendJson(res, 200, {
        data: {
          requested_count: contentIds.length,
          updated_count: updateResult.rowCount,
          target_status: nextStatus,
          content_ids:
            updateResult.rows.map(
              (row) => row.content_id
            )
        }
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failure.
      }

      return handleDatabaseError(res, error);
    } finally {
      client.release();
    }
  }


  // =======================================================
  // PATCH /contents/bulk
  // DELETE /contents/bulk
  // =======================================================

  if (
    pathname === "/contents/bulk" &&
    (
      req.method === "PATCH" ||
      req.method === "DELETE"
    )
  ) {
    let body;

    try {
      body = await readJsonBody(req);
    } catch (error) {
      return sendJson(res, 400, {
        error: error.message,
        message:
          "Request body must contain valid JSON."
      });
    }

    const parsedIds = parseBulkIds(
      body.content_ids,
      {
        fieldName: "content_ids",
        type: "content"
      }
    );

    if (parsedIds.error) {
      return sendJson(res, 400, parsedIds);
    }

    const contentIds = parsedIds.ids;
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      const existingResult = await client.query(
        `
          SELECT content_id
          FROM contents
          WHERE content_id = ANY($1::text[])
          ORDER BY content_id
          FOR UPDATE
        `,
        [contentIds]
      );

      const foundIds = new Set(
        existingResult.rows.map(
          (row) => row.content_id
        )
      );

      const missingIds = contentIds.filter(
        (contentId) => !foundIds.has(contentId)
      );

      if (missingIds.length > 0) {
        await client.query("ROLLBACK");

        return sendJson(res, 404, {
          error: "CONTENT_NOT_FOUND",
          message:
            "One or more Content Candidates were not found.",
          missing_content_ids: missingIds
        });
      }

      if (req.method === "PATCH") {
        if (!validatePriority(body.priority)) {
          await client.query("ROLLBACK");

          return sendJson(res, 400, {
            error: "VALIDATION_ERROR",
            message:
              "priority must be an integer from 1 to 5."
          });
        }

        const updateResult = await client.query(
          `
            UPDATE contents
            SET priority = $1
            WHERE content_id = ANY($2::text[])
            RETURNING content_id
          `,
          [
            body.priority,
            contentIds
          ]
        );

        await client.query("COMMIT");

        return sendJson(res, 200, {
          data: {
            requested_count: contentIds.length,
            updated_count: updateResult.rowCount,
            priority: body.priority,
            content_ids:
              updateResult.rows.map(
                (row) => row.content_id
              )
          }
        });
      }

      const deleteResult = await client.query(
        `
          DELETE FROM contents
          WHERE content_id = ANY($1::text[])
          RETURNING content_id
        `,
        [contentIds]
      );

      await client.query("COMMIT");

      return sendJson(res, 200, {
        data: {
          requested_count: contentIds.length,
          deleted_count: deleteResult.rowCount,
          content_ids:
            deleteResult.rows.map(
              (row) => row.content_id
            )
        }
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Ignore rollback failure.
      }

      return handleDatabaseError(res, error);
    } finally {
      client.release();
    }
  }

  // =======================================================
  // GET /contents/:id
  // PATCH /contents/:id
  // DELETE /contents/:id
  // =======================================================

  const contentMatch = pathname.match(
    /^\/contents\/([^/]+)$/
  );

  if (contentMatch) {
    const contentId = decodeURIComponent(contentMatch[1]);

    // GET ONE
    if (req.method === "GET") {
      try {
        const content = await getContentById(
          pool,
          contentId
        );

        if (!content) {
          return sendJson(res, 404, {
            error: "CONTENT_NOT_FOUND",
            message: `Content ${contentId} was not found.`
          });
        }

        return sendJson(res, 200, {
          data: content
        });
      } catch (error) {
        return handleDatabaseError(res, error);
      }
    }

    // PATCH CONTENT
    if (req.method === "PATCH") {
      let body;

      try {
        body = await readJsonBody(req);
      } catch (error) {
        return sendJson(res, 400, {
          error: error.message,
          message: "Request body must contain valid JSON."
        });
      }

      const updates = [];
      const values = [];

      function addUpdate(column, value) {
        values.push(value);
        updates.push(`${column} = $${values.length}`);
      }

      if (body.title !== undefined) {
        const title = String(body.title).trim();

        if (!title) {
          return sendJson(res, 400, {
            error: "VALIDATION_ERROR",
            message: "title cannot be empty."
          });
        }

        addUpdate("title", title);
      }

      if (body.priority !== undefined) {
        if (!validatePriority(body.priority)) {
          return sendJson(res, 400, {
            error: "VALIDATION_ERROR",
            message:
              "priority must be an integer from 1 to 5."
          });
        }

        addUpdate("priority", body.priority);
      }

      if (body.notes !== undefined) {
        addUpdate("notes", body.notes);
      }

      if (body.signal_id !== undefined) {
        if (body.signal_id === null) {
          addUpdate("signal_id", null);
        } else {
          try {
            const signalResult = await pool.query(
              `
                SELECT id
                FROM signals
                WHERE id = $1
              `,
              [body.signal_id]
            );

            if (signalResult.rowCount === 0) {
              return sendJson(res, 400, {
                error: "INVALID_SIGNAL",
                message: `Signal ${body.signal_id} does not exist.`
              });
            }

            addUpdate(
              "signal_id",
              signalResult.rows[0].id
            );
          } catch (error) {
            return handleDatabaseError(res, error);
          }
        }
      }

      if (updates.length === 0) {
        return sendJson(res, 400, {
          error: "NO_UPDATES",
          message:
            "Provide at least one editable field: title, priority, notes, or signal_id."
        });
      }

      values.push(contentId);

      try {
        const updateResult = await pool.query(
          `
            UPDATE contents

            SET ${updates.join(", ")}

            WHERE content_id = $${values.length}

            RETURNING content_id
          `,
          values
        );

        if (updateResult.rowCount === 0) {
          return sendJson(res, 404, {
            error: "CONTENT_NOT_FOUND",
            message: `Content ${contentId} was not found.`
          });
        }

        const updated = await getContentById(
          pool,
          contentId
        );

        return sendJson(res, 200, {
          data: updated
        });
      } catch (error) {
        return handleDatabaseError(res, error);
      }
    }

    // DELETE CONTENT
    if (req.method === "DELETE") {
      try {
        const result = await pool.query(
          `
            DELETE FROM contents
            WHERE content_id = $1
            RETURNING content_id, title
          `,
          [contentId]
        );

        if (result.rowCount === 0) {
          return sendJson(res, 404, {
            error: "CONTENT_NOT_FOUND",
            message: `Content ${contentId} was not found.`
          });
        }

        return sendJson(res, 200, {
          data: result.rows[0],
          deleted: true
        });
      } catch (error) {
        return handleDatabaseError(res, error);
      }
    }
  }

  return sendJson(res, 404, {
    error: "NOT_FOUND",
    message: "Route not found."
  });
  };
}

const server = http.createServer(createRequestHandler(pool));

// Binding the real port and registering process-level signal
// handlers is a module-load side effect tests must not trigger
// just by requiring this file for createRequestHandler.
if (require.main === module) {
  server.listen(port, "0.0.0.0", () => {
    console.log(`APEX API listening on port ${port}`);
  });

  const shutdown = async (signal) => {
    console.log(`Received ${signal}. Shutting down API.`);

    await pool.end();

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = { createRequestHandler, server };

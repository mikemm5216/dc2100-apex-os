const http = require("node:http");
const { URL } = require("node:url");
const pool = require("./db");

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
    "Access-Control-Allow-Headers": "Content-Type"
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

function validatePriority(priority) {
  return (
    Number.isInteger(priority) &&
    priority >= 1 &&
    priority <= 5
  );
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

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods":
        "GET, POST, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });

    return res.end();
  }

  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  const pathname = requestUrl.pathname;

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
    /^\/contents\/([^/]+)\/status$/
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
});

server.listen(port, "0.0.0.0", () => {
  console.log(`APEX API listening on port ${port}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}. Shutting down API.`);

  await pool.end();

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

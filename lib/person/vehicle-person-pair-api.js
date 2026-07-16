const {
  normalizePairRunPayload
} = require("./vehicle-person-pair-engine");

function response(statusCode, payload) {
  return { statusCode, payload };
}

function validateRunPayload(body = {}) {
  if (!body || Array.isArray(body) || typeof body !== "object") {
    return response(400, {
      error: "VALIDATION_ERROR",
      message: "Request body must be an object."
    });
  }
  for (const [field, min, max] of [
    ["target_pairs", 1, 50],
    ["max_vehicles", 1, 50],
    ["max_brand_anchors", 1, 100],
    ["brand_batch_size", 5, 25],
    ["max_people_per_vehicle", 1, 10]
  ]) {
    if (
      body[field] !== undefined &&
      (!Number.isInteger(body[field]) || body[field] < min || body[field] > max)
    ) {
      return response(400, {
        error: "VALIDATION_ERROR",
        message: `${field} must be an integer from ${min} to ${max}.`
      });
    }
  }
  const targetPairs = body.target_pairs ?? body.max_vehicles ?? 10;
  if (
    body.max_brand_anchors !== undefined &&
    body.max_brand_anchors < targetPairs
  ) {
    return response(400, {
      error: "VALIDATION_ERROR",
      message: "max_brand_anchors must be greater than or equal to target_pairs."
    });
  }
  if (
    body.history_scope !== undefined &&
    String(body.history_scope).toUpperCase() !== "ALL_TIME"
  ) {
    return response(400, {
      error: "VALIDATION_ERROR",
      message: "history_scope must be ALL_TIME."
    });
  }
  if (
    body.format !== undefined &&
    !["SHORTS", "ALL"].includes(String(body.format).toUpperCase())
  ) {
    return response(400, {
      error: "VALIDATION_ERROR",
      message: "format must be SHORTS or ALL."
    });
  }
  return null;
}

async function createVehiclePersonPairRun(pool, body) {
  const validationError = validateRunPayload(body);
  if (validationError) return validationError;

  const active = await pool.query(`
    SELECT id, status
    FROM vehicle_person_pair_runs
    WHERE status IN ('QUEUED','RUNNING')
    ORDER BY created_at, id
    LIMIT 1
  `);
  if (active.rowCount) {
    return response(409, {
      error: "VEHICLE_PERSON_PAIR_RUN_ACTIVE",
      active_run: active.rows[0]
    });
  }

  const options = normalizePairRunPayload(body);
  const requestPayload = {
    history_scope: options.historyScope,
    format: options.format,
    target_pairs: options.targetPairs,
    max_brand_anchors: options.maxBrandAnchors,
    brand_batch_size: options.brandBatchSize,
    max_people_per_vehicle: options.maxPeoplePerVehicle
  };
  const result = await pool.query(`
    INSERT INTO vehicle_person_pair_runs(status, request_payload)
    VALUES('QUEUED', $1::jsonb)
    RETURNING id, status, request_payload, created_at
  `, [JSON.stringify(requestPayload)]);
  return response(202, { data: result.rows[0] });
}

async function getVehiclePersonPairRun(pool, runId) {
  const result = await pool.query(`
    SELECT * FROM vehicle_person_pair_runs WHERE id=$1
  `, [runId]);
  return result.rowCount
    ? response(200, { data: result.rows[0] })
    : response(404, { error: "PAIR_RUN_NOT_FOUND" });
}

async function listVehiclePersonPairSignals(pool, searchParams) {
  const historyScope = String(searchParams.get("history_scope") || "ALL_TIME").toUpperCase();
  const format = String(searchParams.get("format") || "SHORTS").toUpperCase();
  const pairStatus = String(searchParams.get("pair_status") || "ALL").toUpperCase();
  const selected = String(searchParams.get("selected") || "true").toLowerCase();
  if (historyScope !== "ALL_TIME" || !["SHORTS", "ALL"].includes(format)) {
    return response(400, { error: "VALIDATION_ERROR", message: "Unsupported history_scope or format." });
  }
  if (!["ALL", "PROVEN_PAIR", "CURATED_FOUNDER_FALLBACK", "NO_MATCH"].includes(pairStatus)) {
    return response(400, { error: "VALIDATION_ERROR", message: "Unsupported pair_status." });
  }
  if (!["true", "false", "all"].includes(selected)) {
    return response(400, { error: "VALIDATION_ERROR", message: "selected must be true, false, or all." });
  }

  const runId = searchParams.get("run_id");
  if (runId && !/^[1-9][0-9]*$/.test(runId)) {
    return response(400, { error: "VALIDATION_ERROR", message: "run_id must be a positive integer." });
  }
  const limit = Math.max(1, Math.min(100, Number(searchParams.get("limit")) || 10));
  const offset = Math.max(0, Number(searchParams.get("offset")) || 0);
  const values = [];
  const where = [];
  if (selected !== "all") {
    values.push(selected === "true");
    where.push(`vpps.selected=$${values.length}`);
  }
  if (runId) {
    values.push(runId);
    where.push(`vpps.run_id=$${values.length}`);
  } else {
    where.push("vpps.run_id=(SELECT id FROM vehicle_person_pair_runs WHERE status='COMPLETED' ORDER BY completed_at DESC,id DESC LIMIT 1)");
  }
  if (pairStatus !== "ALL") {
    values.push(pairStatus);
    where.push(`vpps.pair_status=$${values.length}`);
  }
  values.push(limit, offset);

  const result = await pool.query(`
    SELECT vpps.*, v.code AS vehicle_code, v.name AS vehicle_name,
      COALESCE(NULLIF(TRIM(v.manufacturer), ''), vpps.evidence->>'vehicle_brand')
        AS vehicle_brand,
      COALESCE(
        NULLIF(LOWER(REGEXP_REPLACE(TRIM(v.manufacturer), '[[:space:]]+', ' ', 'g')), ''),
        vpps.evidence->>'normalized_vehicle_brand'
      ) AS normalized_vehicle_brand,
      vc.code AS vehicle_country_code, vc.name AS vehicle_country_name,
      p.slug AS person_slug, p.canonical_name,
      pc.code AS person_country_code, pc.name AS person_country_name
    FROM vehicle_person_pair_signals vpps
    JOIN vehicles v ON v.id=vpps.vehicle_id
    JOIN people p ON p.id=vpps.person_id
    LEFT JOIN countries vc ON vc.id=v.country_id
    JOIN countries pc ON pc.id=vpps.person_country_id
    WHERE ${where.join(" AND ")}
    ORDER BY
      CASE vpps.pair_status WHEN 'PROVEN_PAIR' THEN 0 ELSE 1 END,
      vpps.joint_video_views DESC NULLS LAST,
      CASE vpps.pair_specificity
        WHEN 'EXACT_MODEL' THEN 0 WHEN 'SAME_SERIES' THEN 1 ELSE 2
      END,
      vpps.vehicle_anchor_views DESC,
      vpps.joint_video_published_at DESC NULLS LAST,
      COALESCE(
        NULLIF(LOWER(REGEXP_REPLACE(TRIM(v.manufacturer), '[[:space:]]+', ' ', 'g')), ''),
        vpps.evidence->>'normalized_vehicle_brand'
      ) ASC,
      vpps.vehicle_id ASC, vpps.person_id ASC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `, values);
  return response(200, {
    data: result.rows.map((row, index) => ({ rank: offset + index + 1, ...row })),
    count: result.rowCount
  });
}

module.exports = {
  validateRunPayload,
  createVehiclePersonPairRun,
  getVehiclePersonPairRun,
  listVehiclePersonPairSignals
};

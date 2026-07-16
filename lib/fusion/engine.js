// =========================================================
// VEHICLE-CENTERED SIGNAL FUSION ENGINE
// Task 3.3F
//
// Pure aggregation over already-persisted evidence: no
// external fetches happen here. For every vehicle with
// qualified traffic, Fusion pairs its evidence with every
// eligible country-matched news signal and every eligible
// linked person, producing one candidate per evidence
// combination.
//
// A vehicle with no eligible country-matched news produces
// NO candidates at all — country news is mandatory. A
// Pair-backed production candidates always require a person;
// no vehicle-only or NO_PERSON_SIGNAL candidates are created.
// =========================================================

const {
  FUSION_VERSION,
  MISSING_SIGNALS,
  PERSON_LINK_TIER_RANK,
  calculateFusionScore,
  calculateVehicleTrafficScore,
  countryNewsTrafficProxyScore,
  deriveVehiclePersonLinkTier,
  personCurrentTrafficScore,
  personHistoricalResonanceScore,
  transformationPotentialScore,
  vehiclePersonLinkConfidenceScore
} = require("./scoring");

const NO_QUALIFIED_VEHICLE_TRAFFIC_ERROR =
  "NO_QUALIFIED_VEHICLE_TRAFFIC";

const FUSION_RUN_LIMITS = {
  MAX_VEHICLES: { min: 1, max: 100, fallback: 25 },
  VEHICLE_WINDOW_DAYS_ALLOWED: [3, 7, 14, 30],
  VEHICLE_WINDOW_DAYS_FALLBACK: 14,
  NEWS_WINDOW_HOURS_ALLOWED: [24, 72, 168],
  NEWS_WINDOW_HOURS_FALLBACK: 168,
  MAX_NEWS_PER_VEHICLE: { min: 1, max: 5, fallback: 3 },
  MAX_PEOPLE_PER_VEHICLE: { min: 1, max: 5, fallback: 3 },
  MAX_VEHICLE_SELECTORS: 100
};

function clampInteger(value, { min, max, fallback }) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

function normalizeVehicleSelectorList(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = [
    ...new Set(
      value
        .map(item => String(item).trim())
        .filter(item => /^[0-9]+$/.test(item))
    )
  ].slice(0, FUSION_RUN_LIMITS.MAX_VEHICLE_SELECTORS);

  return normalized.length > 0 ? normalized : null;
}

function normalizeFusionRunPayload(payload = {}) {
  const requestedWindow = Number(
    payload.vehicle_window_days
  );

  const vehicleWindowDays =
    FUSION_RUN_LIMITS.VEHICLE_WINDOW_DAYS_ALLOWED.includes(
      requestedWindow
    )
      ? requestedWindow
      : FUSION_RUN_LIMITS.VEHICLE_WINDOW_DAYS_FALLBACK;

  const requestedNewsWindow = Number(
    payload.news_window_hours
  );

  const newsWindowHours =
    FUSION_RUN_LIMITS.NEWS_WINDOW_HOURS_ALLOWED.includes(
      requestedNewsWindow
    )
      ? requestedNewsWindow
      : FUSION_RUN_LIMITS.NEWS_WINDOW_HOURS_FALLBACK;

  return {
    maxVehicles: clampInteger(
      payload.max_vehicles,
      FUSION_RUN_LIMITS.MAX_VEHICLES
    ),

    vehicleWindowDays,
    newsWindowHours,

    maxNewsPerVehicle: clampInteger(
      payload.max_news_per_vehicle,
      FUSION_RUN_LIMITS.MAX_NEWS_PER_VEHICLE
    ),

    maxPeoplePerVehicle: clampInteger(
      payload.max_people_per_vehicle,
      FUSION_RUN_LIMITS.MAX_PEOPLE_PER_VEHICLE
    ),

    vehicleIds: normalizeVehicleSelectorList(
      payload.vehicle_ids
    ),
    pairRunId: /^[1-9][0-9]*$/.test(String(payload.pair_run_id || ''))
      ? String(payload.pair_run_id) : null
  };
}

async function selectSelectedPairs(pool, pairRunId, maxVehicles) {
  let id = pairRunId;
  if (!id) {
    const latest = await pool.query(`
      SELECT id
      FROM vehicle_person_pair_runs
      WHERE status='COMPLETED'
      ORDER BY completed_at DESC, id DESC
      LIMIT 1
    `);
    id = latest.rows[0]?.id;
  }
  if (!id) return [];
  const result = await pool.query(`
    SELECT ps.*, v.code AS vehicle_code, v.name AS vehicle_name,
      v.manufacturer AS vehicle_brand, v.country_id AS vehicle_country_id,
      vc.code AS vehicle_country_code, p.canonical_name,
      pc.code AS person_country_code, pc.name AS person_country_name,
      vpl.link_confidence, vpl.evidence_horizon,
      vpl.historical_resonance_score, vpl.historical_resonance_tier,
      pts.traffic_score AS person_traffic_score,
      pts.transformation_potential AS person_transformation_potential
    FROM vehicle_person_pair_signals ps
    JOIN vehicles v ON v.id=ps.vehicle_id
    JOIN people p ON p.id=ps.person_id
    JOIN countries pc ON pc.id=ps.person_country_id
    LEFT JOIN countries vc ON vc.id=v.country_id
    JOIN vehicle_person_links vpl ON vpl.id=ps.vehicle_person_link_id
    LEFT JOIN person_traffic_signals pts ON pts.person_id=ps.person_id
    WHERE ps.run_id=$1 AND ps.selected=TRUE
      AND ps.pair_status IN ('PROVEN_PAIR','CURATED_FOUNDER_FALLBACK')
    ORDER BY
      CASE ps.pair_status WHEN 'PROVEN_PAIR' THEN 0 ELSE 1 END,
      ps.joint_video_views DESC NULLS LAST,
      CASE ps.pair_specificity
        WHEN 'EXACT_MODEL' THEN 0 WHEN 'SAME_SERIES' THEN 1 ELSE 2
      END,
      ps.vehicle_anchor_views DESC,
      ps.joint_video_published_at DESC NULLS LAST,
      ps.vehicle_id ASC, ps.person_id ASC
    LIMIT $2
  `, [id, maxVehicles]);
  return result.rows;
}

// =========================================================
// RUN QUEUE
// =========================================================

async function claimNextFusionRun(pool, workerId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const queuedResult = await client.query(
      `
        SELECT
          id,
          request_payload
        FROM fusion_runs
        WHERE status = 'QUEUED'
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `
    );

    if (queuedResult.rowCount === 0) {
      await client.query("COMMIT");
      return null;
    }

    const run = queuedResult.rows[0];

    await client.query(
      `
        UPDATE fusion_runs
        SET
          status = 'RUNNING',
          locked_by = $1,
          locked_at = NOW(),
          started_at = COALESCE(started_at, NOW()),
          updated_at = NOW()
        WHERE id = $2
      `,
      [workerId, run.id]
    );

    await client.query("COMMIT");

    return run;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failure.
    }

    throw error;
  } finally {
    client.release();
  }
}

// =========================================================
// VEHICLE TRAFFIC ANCHORS
// =========================================================

async function selectVehicleTrafficAnchors(
  pool,
  { vehicleWindowDays, maxVehicles, vehicleIds }
) {
  const values = [vehicleWindowDays];
  let vehicleFilter = "";

  if (vehicleIds) {
    values.push(vehicleIds.map(Number));
    vehicleFilter =
      `AND sig.resolved_vehicle_id = ANY($${values.length}::bigint[])`;
  }

  values.push(maxVehicles);
  const limitIndex = values.length;

  const result = await pool.query(
    `
      WITH qualified AS (
        SELECT
          sig.resolved_vehicle_id AS vehicle_id,
          sig.resolved_country_id AS country_id,
          sig.views,
          sig.vehicle_brand,
          sig.vehicle_series,
          sig.vehicle_model,
          sig.viral_tier
        FROM signals sig
        WHERE sig.qualified = TRUE
          AND sig.resolved_vehicle_id IS NOT NULL
          AND sig.resolved_country_id IS NOT NULL
          AND sig.published_at >=
            NOW() - make_interval(days => $1::int)
          ${vehicleFilter}
      ),
      ranked AS (
        SELECT
          *,
          ROW_NUMBER() OVER (
            PARTITION BY vehicle_id
            ORDER BY views DESC
          ) AS rn
        FROM qualified
      )
      SELECT
        q.vehicle_id,
        v.code AS vehicle_code,
        v.name AS vehicle_name,
        r.country_id,
        co.code AS country_code,
        co.name AS country_name,
        r.vehicle_brand,
        r.vehicle_series,
        r.vehicle_model,
        r.viral_tier AS representative_viral_tier,
        COUNT(*) AS qualified_vehicle_signal_count,
        COALESCE(SUM(q.views), 0) AS vehicle_views_total,
        COALESCE(MAX(q.views), 0) AS vehicle_views_max
      FROM qualified q
      JOIN ranked r
        ON r.vehicle_id = q.vehicle_id AND r.rn = 1
      JOIN vehicles v
        ON v.id = q.vehicle_id
      LEFT JOIN countries co
        ON co.id = r.country_id
      GROUP BY
        q.vehicle_id, v.code, v.name, r.country_id,
        co.code, co.name, r.vehicle_brand,
        r.vehicle_series, r.vehicle_model, r.viral_tier
      ORDER BY vehicle_views_total DESC
      LIMIT $${limitIndex}
    `,
    values
  );

  return result.rows;
}

// =========================================================
// ELIGIBLE COUNTRY NEWS
// =========================================================

async function selectEligibleCountryNews(
  pool,
  { countryId, newsWindowHours, maxNewsPerVehicle }
) {
  const result = await pool.query(
    `
      SELECT
        id,
        category,
        conflict_archetypes,
        traffic_score,
        transformation_potential
      FROM country_news_signals
      WHERE country_id = $1
        AND last_seen_at >=
          NOW() - make_interval(hours => $2::int)
      ORDER BY traffic_score DESC, id DESC
      LIMIT $3
    `,
    [countryId, newsWindowHours, maxNewsPerVehicle]
  );

  return result.rows;
}

// =========================================================
// ELIGIBLE PERSON LINKS
// =========================================================

async function selectEligiblePersonLinks(
  pool,
  { vehicle, maxPeoplePerVehicle }
) {
  if (!vehicle.vehicle_brand) {
    return [];
  }

  const result = await pool.query(
    `
      SELECT
        vpl.id AS link_id,
        vpl.person_id,
        vpl.vehicle_id,
        vpl.vehicle_brand,
        vpl.vehicle_series,
        vpl.vehicle_model,
        vpl.link_confidence,
        vpl.evidence_horizon,
        vpl.historical_resonance_score,
        vpl.historical_resonance_tier,
        pts.traffic_score AS person_traffic_score,
        pts.transformation_potential
          AS person_transformation_potential
      FROM vehicle_person_links vpl
      JOIN person_traffic_signals pts
        ON pts.person_id = vpl.person_id
      WHERE vpl.vehicle_brand ILIKE $1
      ORDER BY
        vpl.link_confidence DESC NULLS LAST,
        vpl.id ASC
    `,
    [vehicle.vehicle_brand]
  );

  const bestByPerson = new Map();

  for (const link of result.rows) {
    const tier = deriveVehiclePersonLinkTier(
      link,
      vehicle
    );

    if (!tier) {
      continue;
    }

    const candidate = { ...link, tier };
    const existing = bestByPerson.get(link.person_id);

    if (
      !existing ||
      PERSON_LINK_TIER_RANK[tier] >
        PERSON_LINK_TIER_RANK[existing.tier] ||
      (PERSON_LINK_TIER_RANK[tier] ===
        PERSON_LINK_TIER_RANK[existing.tier] &&
        Number(link.link_confidence) >
          Number(existing.link_confidence))
    ) {
      bestByPerson.set(link.person_id, candidate);
    }
  }

  return [...bestByPerson.values()]
    .sort(
      (a, b) =>
        PERSON_LINK_TIER_RANK[b.tier] -
          PERSON_LINK_TIER_RANK[a.tier] ||
        Number(b.link_confidence) -
          Number(a.link_confidence)
    )
    .slice(0, maxPeoplePerVehicle);
}

// =========================================================
// CANDIDATE SCORING + PERSISTENCE
// =========================================================

function buildCandidate({
  vehicle,
  countryNewsSignal,
  personLink,
  selectedPair = null
}) {
  const vehicleTrafficScore = calculateVehicleTrafficScore(
    { vehicleViewsTotal: vehicle.vehicle_views_total }
  );

  const countryScore = countryNewsTrafficProxyScore(
    countryNewsSignal
  );

  const personTrafficSignal = personLink
    ? {
        traffic_score: personLink.person_traffic_score,
        transformation_potential:
          personLink.person_transformation_potential
      }
    : null;

  const transformationScore = transformationPotentialScore(
    {
      countryNewsSignal,
      personTrafficSignal
    }
  );

  const missingSignals = [];

  const currentTrafficScore = personCurrentTrafficScore(
    personTrafficSignal
  );

  const historicalScore = personLink
    ? personHistoricalResonanceScore(personLink)
    : null;

  if (!personLink) {
    missingSignals.push(
      MISSING_SIGNALS.NO_PERSON_SIGNAL
    );
  } else if (historicalScore === null) {
    missingSignals.push(
      MISSING_SIGNALS.NO_HISTORICAL_RESONANCE
    );
  }

  const linkConfidenceScore = personLink
    ? vehiclePersonLinkConfidenceScore(
        personLink,
        personLink.tier
      )
    : null;

  const fusionScore = calculateFusionScore({
    vehicleTrafficScore,
    countryNewsTrafficProxyScore: countryScore,
    transformationPotentialScore: transformationScore,
    personCurrentTrafficScore: currentTrafficScore,
    personHistoricalResonanceScore: historicalScore,
    vehiclePersonLinkConfidenceScore: linkConfidenceScore
  });

  const fusionEvidence = {
    fusion_version: FUSION_VERSION,
    vehicle: {
      vehicle_id: String(vehicle.vehicle_id),
      vehicle_code: vehicle.vehicle_code,
      qualified_vehicle_signal_count:
        vehicle.qualified_vehicle_signal_count,
      vehicle_views_total: String(
        vehicle.vehicle_views_total
      ),
      vehicle_views_max: String(
        vehicle.vehicle_views_max
      ),
      representative_viral_tier:
        vehicle.representative_viral_tier
    },
    country_news: {
      country_news_signal_id: String(
        countryNewsSignal.id
      ),
      category: countryNewsSignal.category,
      conflict_archetypes:
        countryNewsSignal.conflict_archetypes,
      traffic_score: countryNewsSignal.traffic_score
    },
    person_current: personLink
      ? {
          person_id: String(personLink.person_id),
          traffic_score: personLink.person_traffic_score
        }
      : null,
    historical_relationship: personLink
      ? {
          vehicle_person_link_id: String(
            personLink.link_id
          ),
          tier: personLink.tier,
          link_confidence: personLink.link_confidence,
          evidence_horizon: personLink.evidence_horizon,
          historical_resonance_score:
            personLink.historical_resonance_score,
          historical_resonance_tier:
            personLink.historical_resonance_tier
        }
      : null,
    transformation: {
      country_transformation_potential:
        countryNewsSignal.transformation_potential,
      person_transformation_potential: personLink
        ? personLink.person_transformation_potential
        : null
    },
    selected_pair: selectedPair
      ? {
          vehicle_person_pair_signal_id: String(selectedPair.id),
          pair_run_id: String(selectedPair.run_id),
          pair_status: selectedPair.pair_status,
          pair_specificity: selectedPair.pair_specificity,
          joint_video_id: selectedPair.joint_video_id,
          joint_video_views: selectedPair.joint_video_views,
          person_country_id: String(selectedPair.person_country_id),
          vehicle_country_id: selectedPair.vehicle_country_id
            ? String(selectedPair.vehicle_country_id)
            : null,
          cross_country_pair: selectedPair.cross_country_pair,
          country_binding: "PERSON_COUNTRY"
        }
      : null
  };

  return {
    vehicleId: vehicle.vehicle_id,
    countryId: selectedPair
      ? selectedPair.person_country_id
      : (personLink?.person_country_id || vehicle.country_id),
    countryNewsSignalId: countryNewsSignal.id,
    personId: personLink ? personLink.person_id : null,
    vehiclePersonLinkId: personLink
      ? personLink.link_id
      : null,
    personLinkTier: personLink ? personLink.tier : null,

    qualifiedVehicleSignalCount:
      vehicle.qualified_vehicle_signal_count,
    vehicleViewsTotal: vehicle.vehicle_views_total,
    vehicleViewsMax: vehicle.vehicle_views_max,
    vehicleViralTier: vehicle.representative_viral_tier,
    vehicleTrafficScore,

    countryNewsCategory: countryNewsSignal.category,
    countryNewsConflictArchetypes:
      countryNewsSignal.conflict_archetypes,
    countryNewsTrafficProxyScore: countryScore,

    personCurrentTrafficScore: currentTrafficScore,

    personHistoricalResonanceScore: historicalScore,
    personHistoricalResonanceTier: personLink
      ? personLink.historical_resonance_tier
      : null,
    relationshipScope: personLink
      ? personLink.evidence_horizon
      : null,
    vehiclePersonLinkConfidenceScore: linkConfidenceScore,

    transformationPotentialScore: transformationScore,

    fusionScore,
    missingSignals,
    isComplete: missingSignals.length === 0,
    fusionEvidence,
    vehiclePersonPairSignalId: selectedPair?.id || null,
    pairRunId: selectedPair?.run_id || null,
    jointVideoId: selectedPair?.joint_video_id || null,
    jointVideoViews: selectedPair?.joint_video_views || null,
    pairStatus: selectedPair?.pair_status || null,
    pairSpecificity: selectedPair?.pair_specificity || null,
    personCountryId: selectedPair?.person_country_id || null,
    vehicleCountryId: selectedPair?.vehicle_country_id || null,
    crossCountryPair: selectedPair?.cross_country_pair ?? null,
    countryBinding: selectedPair ? 'PERSON_COUNTRY' : null
  };
}

async function upsertFusionCandidate(pool, runId, candidate) {
  const result = await pool.query(
    `
      INSERT INTO vehicle_fusion_candidates (
        run_id, vehicle_id, country_id,
        country_news_signal_id, person_id,
        vehicle_person_link_id, person_link_tier,

        qualified_vehicle_signal_count,
        vehicle_views_total, vehicle_views_max,
        vehicle_viral_tier, vehicle_traffic_score,

        country_news_category,
        country_news_conflict_archetypes,
        country_news_traffic_proxy_score,

        person_current_traffic_score,

        person_historical_resonance_score,
        person_historical_resonance_tier,
        relationship_scope,
        vehicle_person_link_confidence_score,

        transformation_potential_score,

        fusion_score, fusion_version,
        missing_signals, is_complete,
        fusion_evidence,
        vehicle_person_pair_signal_id, pair_run_id,
        joint_video_id, joint_video_views,
        pair_status, pair_specificity,
        person_country_id, vehicle_country_id,
        cross_country_pair, country_binding
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, $11, $12,
        $13, $14::jsonb, $15,
        $16,
        $17, $18, $19, $20,
        $21,
        $22, $23, $24::jsonb, $25,
        $26::jsonb,
        $27,$28,$29,$30,$31,$32,$33,$34,$35,$36
      )
      ON CONFLICT (
        run_id, vehicle_id, country_news_signal_id,
        COALESCE(person_id, -1)
      )
      DO UPDATE
      SET
        vehicle_person_link_id =
          EXCLUDED.vehicle_person_link_id,
        person_link_tier = EXCLUDED.person_link_tier,

        qualified_vehicle_signal_count =
          EXCLUDED.qualified_vehicle_signal_count,
        vehicle_views_total =
          EXCLUDED.vehicle_views_total,
        vehicle_views_max = EXCLUDED.vehicle_views_max,
        vehicle_viral_tier =
          EXCLUDED.vehicle_viral_tier,
        vehicle_traffic_score =
          EXCLUDED.vehicle_traffic_score,

        country_news_category =
          EXCLUDED.country_news_category,
        country_news_conflict_archetypes =
          EXCLUDED.country_news_conflict_archetypes,
        country_news_traffic_proxy_score =
          EXCLUDED.country_news_traffic_proxy_score,

        person_current_traffic_score =
          EXCLUDED.person_current_traffic_score,

        person_historical_resonance_score =
          EXCLUDED.person_historical_resonance_score,
        person_historical_resonance_tier =
          EXCLUDED.person_historical_resonance_tier,
        relationship_scope =
          EXCLUDED.relationship_scope,
        vehicle_person_link_confidence_score =
          EXCLUDED.vehicle_person_link_confidence_score,

        transformation_potential_score =
          EXCLUDED.transformation_potential_score,

        fusion_score = EXCLUDED.fusion_score,
        fusion_version = EXCLUDED.fusion_version,
        missing_signals = EXCLUDED.missing_signals,
        is_complete = EXCLUDED.is_complete,
        fusion_evidence = EXCLUDED.fusion_evidence,
        vehicle_person_pair_signal_id=EXCLUDED.vehicle_person_pair_signal_id,
        pair_run_id=EXCLUDED.pair_run_id,
        joint_video_id=EXCLUDED.joint_video_id,
        joint_video_views=EXCLUDED.joint_video_views,
        pair_status=EXCLUDED.pair_status,
        pair_specificity=EXCLUDED.pair_specificity,
        person_country_id=EXCLUDED.person_country_id,
        vehicle_country_id=EXCLUDED.vehicle_country_id,
        cross_country_pair=EXCLUDED.cross_country_pair,
        country_binding=EXCLUDED.country_binding,
        updated_at = NOW()
      RETURNING id, (xmax = 0) AS inserted
    `,
    [
      runId,
      candidate.vehicleId,
      candidate.countryId,
      candidate.countryNewsSignalId,
      candidate.personId,
      candidate.vehiclePersonLinkId,
      candidate.personLinkTier,

      candidate.qualifiedVehicleSignalCount,
      candidate.vehicleViewsTotal,
      candidate.vehicleViewsMax,
      candidate.vehicleViralTier,
      candidate.vehicleTrafficScore,

      candidate.countryNewsCategory,
      JSON.stringify(
        candidate.countryNewsConflictArchetypes || []
      ),
      candidate.countryNewsTrafficProxyScore,

      candidate.personCurrentTrafficScore,

      candidate.personHistoricalResonanceScore,
      candidate.personHistoricalResonanceTier,
      candidate.relationshipScope,
      candidate.vehiclePersonLinkConfidenceScore,

      candidate.transformationPotentialScore,

      candidate.fusionScore,
      FUSION_VERSION,
      JSON.stringify(candidate.missingSignals),
      candidate.isComplete,
      JSON.stringify(candidate.fusionEvidence),
      candidate.vehiclePersonPairSignalId,
      candidate.pairRunId,
      candidate.jointVideoId,
      candidate.jointVideoViews,
      candidate.pairStatus,
      candidate.pairSpecificity,
      candidate.personCountryId,
      candidate.vehicleCountryId,
      candidate.crossCountryPair,
      candidate.countryBinding
    ]
  );

  return result.rows[0];
}

// =========================================================
// RUN EXECUTION
// =========================================================

function createRunState(options) {
  return {
    vehicleCount: 0,
    completedVehicleCount: 0,
    skippedVehicleCount: 0,
    candidateCount: 0,
    candidateInsertedCount: 0,
    candidateUpdatedCount: 0,

    completeCandidateCount: 0,
    incompleteCandidateCount: 0,

    exactVehicleCount: 0,
    sameSeriesCount: 0,
    sameBrandCount: 0,
    noPersonSignalCount: 0,

    vehicleResults: [],
    errors: [],

    options
  };
}

function buildRunSummary(state) {
  return {
    vehicle_results: state.vehicleResults,
    errors: state.errors,

    complete_candidate_count:
      state.completeCandidateCount,
    incomplete_candidate_count:
      state.incompleteCandidateCount,

    exact_vehicle_tier_count: state.exactVehicleCount,
    same_series_tier_count: state.sameSeriesCount,
    same_brand_tier_count: state.sameBrandCount,
    no_person_signal_count: state.noPersonSignalCount,

    fusion_version: FUSION_VERSION,
    vehicle_window_days: state.options.vehicleWindowDays,
    news_window_hours: state.options.newsWindowHours,
    max_vehicles: state.options.maxVehicles,
    max_news_per_vehicle: state.options.maxNewsPerVehicle,
    max_people_per_vehicle:
      state.options.maxPeoplePerVehicle
  };
}

async function updateRunProgress(pool, runId, state) {
  await pool.query(
    `
      UPDATE fusion_runs
      SET
        vehicle_count = $1,
        completed_vehicle_count = $2,
        skipped_vehicle_count = $3,
        candidate_count = $4,
        candidate_inserted_count = $5,
        candidate_updated_count = $6,
        summary = $7::jsonb,
        updated_at = NOW()
      WHERE id = $8
    `,
    [
      state.vehicleCount,
      state.completedVehicleCount,
      state.skippedVehicleCount,
      state.candidateCount,
      state.candidateInsertedCount,
      state.candidateUpdatedCount,
      JSON.stringify(buildRunSummary(state)),
      runId
    ]
  );
}

async function finalizeRun(pool, runId, state) {
  const completed = state.candidateCount > 0;

  const status = completed ? "COMPLETED" : "FAILED";

  const errorMessage = completed
    ? null
    : (
        state.errors
          .slice(0, 3)
          .map(item =>
            `${item.vehicle_code || item.scope}: ${item.message}`
          )
          .join(" | ") ||
        "No fusion candidates were produced."
      );

  await pool.query(
    `
      UPDATE fusion_runs
      SET
        status = $1,
        vehicle_count = $2,
        completed_vehicle_count = $3,
        skipped_vehicle_count = $4,
        candidate_count = $5,
        candidate_inserted_count = $6,
        candidate_updated_count = $7,
        summary = $8::jsonb,
        error_message = $9,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $10
    `,
    [
      status,
      state.vehicleCount,
      state.completedVehicleCount,
      state.skippedVehicleCount,
      state.candidateCount,
      state.candidateInsertedCount,
      state.candidateUpdatedCount,
      JSON.stringify(buildRunSummary(state)),
      errorMessage,
      runId
    ]
  );

  return {
    runId: String(runId),
    status,
    ...state
  };
}

async function failFusionRun(pool, runId, error) {
  await pool.query(
    `
      UPDATE fusion_runs
      SET
        status = 'FAILED',
        error_message = $1,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `,
    [
      String(
        error?.message || "Unknown fusion failure"
      ).slice(0, 2000),
      runId
    ]
  );
}

async function processSelectedPair(pool, run, pair, state) {
  const news = await selectEligibleCountryNews(pool, {
    countryId: pair.person_country_id,
    newsWindowHours: state.options.newsWindowHours,
    maxNewsPerVehicle: state.options.maxNewsPerVehicle
  });
  if (!news.length) {
    state.skippedVehicleCount += 1;
    state.errors.push({
      vehicle_code: pair.vehicle_code,
      code: "NO_PERSON_COUNTRY_NEWS",
      message: `No news for person country ${pair.person_country_code}`
    });
    state.vehicleResults.push({
      vehicle_code: pair.vehicle_code,
      status: "SKIPPED",
      code: "NO_PERSON_COUNTRY_NEWS"
    });
    return;
  }
  const vehicle = {
    vehicle_id: pair.vehicle_id,
    vehicle_code: pair.vehicle_code,
    vehicle_name: pair.vehicle_name,
    country_id: pair.vehicle_country_id,
    country_code: pair.vehicle_country_code,
    vehicle_brand: pair.vehicle_brand,
    vehicle_series: null,
    vehicle_model: pair.vehicle_name,
    representative_viral_tier: null,
    qualified_vehicle_signal_count: 1,
    vehicle_views_total: pair.vehicle_anchor_views,
    vehicle_views_max: pair.vehicle_anchor_views
  };
  const personLink = {
    link_id: pair.vehicle_person_link_id,
    person_id: pair.person_id,
    person_country_id: pair.person_country_id,
    tier: pair.pair_specificity === "EXACT_MODEL"
      ? "EXACT_VEHICLE"
      : pair.pair_specificity,
    link_confidence: pair.link_confidence,
    evidence_horizon: pair.evidence_horizon,
    historical_resonance_score: pair.historical_resonance_score,
    historical_resonance_tier: pair.historical_resonance_tier,
    person_traffic_score: pair.person_traffic_score,
    person_transformation_potential: pair.person_transformation_potential
  };
  for (const item of news) {
    const candidate = buildCandidate({
      vehicle,
      countryNewsSignal: item,
      personLink,
      selectedPair: pair
    });
    if (!candidate.personId || !candidate.vehicleId || !candidate.countryId) {
      throw new Error("PAIR_CANDIDATE_IDENTITY_INCOMPLETE");
    }
    const saved = await upsertFusionCandidate(pool, run.id, candidate);
    state.candidateCount += 1;
    saved.inserted
      ? state.candidateInsertedCount += 1
      : state.candidateUpdatedCount += 1;
    candidate.isComplete
      ? state.completeCandidateCount += 1
      : state.incompleteCandidateCount += 1;
    if (candidate.personLinkTier === "EXACT_VEHICLE") state.exactVehicleCount += 1;
    else if (candidate.personLinkTier === "SAME_SERIES") state.sameSeriesCount += 1;
    else if (candidate.personLinkTier === "SAME_BRAND") state.sameBrandCount += 1;
  }
  state.completedVehicleCount += 1;
  state.vehicleResults.push({
    vehicle_code: pair.vehicle_code,
    person_id: String(pair.person_id),
    status: "COMPLETED",
    country_binding: "PERSON_COUNTRY",
    person_country_code: pair.person_country_code
  });
}

async function executeFusionRun(
  pool,
  run,
  { onVehicleCompleted = null } = {}
) {
  const options = normalizeFusionRunPayload(
    run.request_payload
  );

  const state = createRunState(options);

  const selectedPairs = await selectSelectedPairs(
    pool,
    options.pairRunId,
    options.maxVehicles
  );
  if (!selectedPairs.length) {
    const error = new Error("NO_VEHICLE_PERSON_PAIR_SIGNALS");
    await failFusionRun(pool, run.id, error);
    return { runId: String(run.id), status: "FAILED", ...state };
  }
  state.vehicleCount = selectedPairs.length;
  await pool.query(
    `UPDATE fusion_runs SET pair_run_id=$1 WHERE id=$2`,
    [selectedPairs[0].run_id, run.id]
  );
  await updateRunProgress(pool, run.id, state);
  for (const pair of selectedPairs) {
    try {
      await processSelectedPair(pool, run, pair, state);
      if (onVehicleCompleted) onVehicleCompleted(pair, state);
    } catch (error) {
      state.errors.push({
        vehicle_code: pair.vehicle_code,
        message: String(error.message).slice(0, 500)
      });
    }
    await updateRunProgress(pool, run.id, state);
  }
  return finalizeRun(pool, run.id, state);
}

async function processNextFusionRun(
  pool,
  { workerId, onRunStarted = null, onVehicleCompleted = null } = {}
) {
  const run = await claimNextFusionRun(pool, workerId);

  if (!run) {
    return null;
  }

  if (onRunStarted) {
    onRunStarted(run);
  }

  try {
    return await executeFusionRun(pool, run, {
      onVehicleCompleted
    });
  } catch (error) {
    await failFusionRun(pool, run.id, error);
    throw error;
  }
}

module.exports = {
  FUSION_RUN_LIMITS,
  NO_QUALIFIED_VEHICLE_TRAFFIC_ERROR,
  buildCandidate,
  claimNextFusionRun,
  executeFusionRun,
  normalizeFusionRunPayload,
  processNextFusionRun,
  selectEligibleCountryNews,
  selectEligiblePersonLinks,
  selectVehicleTrafficAnchors,
  upsertFusionCandidate
};

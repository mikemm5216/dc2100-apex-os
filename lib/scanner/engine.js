const {
  classifyShortFormat,
  classifyViralTier,
  deriveSignalMetrics,
  getDurationBucket,
  parseIso8601Duration
} = require("./metrics");

const {
  fetchAllUploadVideoIds,
  fetchUploadVideoIds,
  fetchVideos,
  resolveChannel
} = require("./youtube");

const {
  ENTITY_STATUSES,
  resolveVehicleEntity
} = require("./entity-resolver");

const {
  GENERIC_UNSAFE_VEHICLE_CODES,
  compactVehicleCode
} = require("./vehicle-catalog");

function clampInteger(
  value,
  {
    minimum,
    maximum,
    fallback
  }
) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.min(
    maximum,
    Math.max(minimum, parsed)
  );
}

const SCAN_MODES = ["CURRENT", "HISTORICAL"];

// Historical mode's ALL_TIME scope: no age cutoff. This is
// only a naming constant for the run summary -- it never
// gates which videos get saved.
const HISTORY_SCOPE = "ALL_TIME";

function normalizeRunPayload(payload = {}) {
  const sourceIds = Array.isArray(
    payload.source_ids
  )
    ? [
        ...new Set(
          payload.source_ids
            .map(value => String(value).trim())
            .filter(value => /^[0-9]+$/.test(value))
        )
      ]
    : null;

  const requestedAgeDays = Number(
    payload.max_age_days
  );

  const maxAgeDays =
    [3, 7, 14, 30].includes(
      requestedAgeDays
    )
      ? requestedAgeDays
      : 30;

  const scanMode = SCAN_MODES.includes(
    payload.scan_mode
  )
    ? payload.scan_mode
    : "CURRENT";

  return {
    sourceIds:
      sourceIds && sourceIds.length > 0
        ? sourceIds
        : null,

    maxResultsPerSource: clampInteger(
      payload.max_results_per_source,
      {
        minimum: 1,
        maximum: 50,
        fallback: 10
      }
    ),

    maxAgeDays,

    forceRefreshChannels:
      payload.force_refresh_channels === true,

    scanMode,

    // HISTORICAL only: safety cap on how many uploads-playlist
    // pages (50 videos each) a single source will walk in one
    // run. Never used by CURRENT mode.
    maxPagesPerSource: clampInteger(
      payload.max_pages_per_source,
      {
        minimum: 1,
        maximum: 200,
        fallback: 40
      }
    )
  };
}

async function claimNextRun(
  pool,
  workerId
) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const queuedResult = await client.query(
      `
        SELECT
          id,
          request_payload
        FROM scanner_runs
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
        UPDATE scanner_runs
        SET
          status = 'RUNNING',
          locked_by = $1,
          locked_at = NOW(),
          started_at = COALESCE(
            started_at,
            NOW()
          ),
          updated_at = NOW()
        WHERE id = $2
      `,
      [
        workerId,
        run.id
      ]
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

async function loadSources(
  pool,
  sourceIds
) {
  const result = await pool.query(
    `
      SELECT
        id,
        name,
        url,
        priority,
        youtube_channel_id,
        youtube_uploads_playlist_id
      FROM sources
      WHERE enabled = TRUE
        AND LOWER(platform) = 'youtube'
        AND (
          $1::bigint[] IS NULL OR
          id = ANY($1::bigint[])
        )
      ORDER BY
        priority ASC,
        id ASC
    `,
    [sourceIds]
  );

  return result.rows;
}

async function markSourceRunning(
  pool,
  sourceId
) {
  await pool.query(
    `
      UPDATE sources
      SET
        last_scan_status = 'RUNNING',
        last_scan_error = NULL,
        updated_at = NOW()
      WHERE id = $1
    `,
    [sourceId]
  );
}

async function markSourceSuccess(
  pool,
  sourceId,
  channel
) {
  await pool.query(
    `
      UPDATE sources
      SET
        youtube_channel_id = $1,
        youtube_uploads_playlist_id = $2,
        last_scan_status = 'SUCCESS',
        last_scan_error = NULL,
        last_scan_at = NOW(),
        updated_at = NOW()
      WHERE id = $3
    `,
    [
      channel.channelId,
      channel.uploadsPlaylistId,
      sourceId
    ]
  );
}

async function markSourceFailed(
  pool,
  sourceId,
  error
) {
  await pool.query(
    `
      UPDATE sources
      SET
        last_scan_status = 'FAILED',
        last_scan_error = $1,
        last_scan_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `,
    [
      String(
        error?.message ||
        "Unknown scanner error"
      ).slice(0, 2000),
      sourceId
    ]
  );
}

// One lookup per scanner run: ISO country code -> id.
async function loadCountryMap(pool) {
  const result = await pool.query(
    `
      SELECT id, code
      FROM countries
    `
  );

  return new Map(
    result.rows.map(row => [
      row.code,
      row.id
    ])
  );
}

// One lookup per scanner run: compact vehicle code -> id.
async function loadVehicleMap(pool) {
  const result = await pool.query(
    `
      SELECT id, code
      FROM vehicles
      WHERE enabled = TRUE
    `
  );

  return new Map(
    result.rows.map(row => [
      String(row.code)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, ""),
      row.id
    ])
  );
}

function lookupResolvedCountryId(
  countryMap,
  entity
) {
  if (!entity.countryCode) {
    return null;
  }

  const countryId = countryMap.get(
    entity.countryCode
  );

  if (countryId === undefined) {
    entity.evidence.country_lookup_failed = true;
    return null;
  }

  return countryId;
}

// Conservative link into the existing vehicles table:
// only an exact compact-code match counts. A near-name
// match is never enough.
//
// A resolved entity with both a brand and a model must use
// the canonical BRAND+MODEL code (compact(brand + model)) and
// nothing else: a real vehicle must never fall through to a
// bare model or series-stripped code, because those short
// codes are exactly what the fictional MVP seed rows
// (MUSTANG, SU7, TTRS, SUPRA, GT3RS, EXIGE, ...) occupy. If
// the canonical code has no matching row, the correct answer
// is "not yet cataloged" (null), never a fictional row.
function lookupResolvedVehicleId(
  vehicleMap,
  entity
) {
  if (!entity.model) {
    return null;
  }

  if (entity.brand) {
    const canonicalCode = compactVehicleCode(
      `${entity.brand}${entity.model}`
    );

    const vehicleId =
      vehicleMap.get(canonicalCode);

    return vehicleId !== undefined
      ? vehicleId
      : null;
  }

  // Legacy fallback path, retained only for callers that
  // resolve a model without a brand. Generic short codes
  // (GT, 86, RS, single digits, ...) are excluded: a wrong
  // vehicle is worse than no vehicle.
  const compactModel = compactVehicleCode(
    entity.model
  );

  const candidates = [compactModel];

  if (entity.series) {
    const compactSeries = compactVehicleCode(
      entity.series
    );

    if (
      compactSeries &&
      compactModel.startsWith(compactSeries) &&
      compactModel.length >
        compactSeries.length
    ) {
      candidates.push(
        compactModel.slice(
          compactSeries.length
        )
      );
    }
  }

  for (const candidate of candidates) {
    if (
      GENERIC_UNSAFE_VEHICLE_CODES.has(
        candidate
      )
    ) {
      continue;
    }

    const vehicleId =
      vehicleMap.get(candidate);

    if (vehicleId !== undefined) {
      return vehicleId;
    }
  }

  return null;
}

async function getPreviousSignalState(
  pool,
  sourceId,
  videoId
) {
  const result = await pool.query(
    `
      SELECT
        sig.id,
        sig.entity_locked,

        COALESCE(
          snapshot.views,
          sig.views
        ) AS previous_views,

        COALESCE(
          snapshot.captured_at,
          sig.last_scanned_at,
          sig.updated_at
        ) AS previous_captured_at

      FROM signals sig

      LEFT JOIN LATERAL (
        SELECT
          views,
          captured_at
        FROM signal_metric_snapshots
        WHERE signal_id = sig.id
        ORDER BY
          captured_at DESC,
          id DESC
        LIMIT 1
      ) snapshot
        ON TRUE

      WHERE sig.source_id = $1
        AND sig.external_id = $2
    `,
    [
      sourceId,
      videoId
    ]
  );

  return result.rows[0] || null;
}

async function upsertSignal(
  pool,
  {
    source,
    video,
    durationSeconds,
    shortInfo,
    tierInfo,
    metrics,
    rawMetrics,
    scannedAt,
    entity,
    resolvedVehicleId,
    resolvedCountryId
  }
) {
  const result = await pool.query(
    `
      INSERT INTO signals (
        source_id,
        external_id,
        title,
        url,
        published_at,
        duration_seconds,
        views,
        views_per_day,
        views_per_hour,
        age_hours,
        growth_velocity,
        is_short,
        short_format,
        short_rejection_reason,
        viral_tier,
        raw_metrics,
        channel_id,
        channel_title,
        thumbnail_url,
        qualified,
        rank_score,
        last_scanned_at,
        vehicle_brand,
        vehicle_series,
        vehicle_model,
        vehicle_type,
        vehicle_action,
        resolved_vehicle_id,
        resolved_country_id,
        conflict_keywords,
        entity_resolution_status,
        entity_confidence,
        entity_match_method,
        entity_evidence,
        entity_resolver_version
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16::jsonb,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24,
        $25,
        $26,
        $27,
        $28,
        $29,
        $30::jsonb,
        $31,
        $32,
        $33,
        $34::jsonb,
        $35
      )

      ON CONFLICT (
        source_id,
        external_id
      )
      DO UPDATE
      SET
        title = EXCLUDED.title,
        url = EXCLUDED.url,
        published_at =
          EXCLUDED.published_at,
        duration_seconds =
          EXCLUDED.duration_seconds,
        views = EXCLUDED.views,
        views_per_day =
          EXCLUDED.views_per_day,
        views_per_hour =
          EXCLUDED.views_per_hour,
        age_hours =
          EXCLUDED.age_hours,
        growth_velocity =
          EXCLUDED.growth_velocity,
        is_short =
          EXCLUDED.is_short,
        short_format =
          EXCLUDED.short_format,
        short_rejection_reason =
          EXCLUDED.short_rejection_reason,
        viral_tier =
          EXCLUDED.viral_tier,
        raw_metrics =
          EXCLUDED.raw_metrics,
        channel_id =
          EXCLUDED.channel_id,
        channel_title =
          EXCLUDED.channel_title,
        thumbnail_url =
          EXCLUDED.thumbnail_url,
        qualified =
          EXCLUDED.qualified,
        rank_score =
          EXCLUDED.rank_score,
        last_scanned_at =
          EXCLUDED.last_scanned_at,

        vehicle_brand = CASE
          WHEN signals.entity_locked
            THEN signals.vehicle_brand
          ELSE EXCLUDED.vehicle_brand
        END,
        vehicle_series = CASE
          WHEN signals.entity_locked
            THEN signals.vehicle_series
          ELSE EXCLUDED.vehicle_series
        END,
        vehicle_model = CASE
          WHEN signals.entity_locked
            THEN signals.vehicle_model
          ELSE EXCLUDED.vehicle_model
        END,
        vehicle_type = CASE
          WHEN signals.entity_locked
            THEN signals.vehicle_type
          ELSE EXCLUDED.vehicle_type
        END,
        vehicle_action = CASE
          WHEN signals.entity_locked
            THEN signals.vehicle_action
          ELSE EXCLUDED.vehicle_action
        END,
        resolved_vehicle_id = CASE
          WHEN signals.entity_locked
            THEN signals.resolved_vehicle_id
          ELSE EXCLUDED.resolved_vehicle_id
        END,
        resolved_country_id = CASE
          WHEN signals.entity_locked
            THEN signals.resolved_country_id
          ELSE EXCLUDED.resolved_country_id
        END,
        conflict_keywords = CASE
          WHEN signals.entity_locked
            THEN signals.conflict_keywords
          ELSE EXCLUDED.conflict_keywords
        END,
        entity_resolution_status = CASE
          WHEN signals.entity_locked
            THEN signals.entity_resolution_status
          ELSE EXCLUDED.entity_resolution_status
        END,
        entity_confidence = CASE
          WHEN signals.entity_locked
            THEN signals.entity_confidence
          ELSE EXCLUDED.entity_confidence
        END,
        entity_match_method = CASE
          WHEN signals.entity_locked
            THEN signals.entity_match_method
          ELSE EXCLUDED.entity_match_method
        END,
        entity_evidence = CASE
          WHEN signals.entity_locked
            THEN signals.entity_evidence
          ELSE EXCLUDED.entity_evidence
        END,
        entity_resolver_version = CASE
          WHEN signals.entity_locked
            THEN signals.entity_resolver_version
          ELSE EXCLUDED.entity_resolver_version
        END,

        updated_at = NOW()

      RETURNING id
    `,
    [
      source.id,
      video.videoId,
      video.title,
      `https://www.youtube.com/watch?v=${video.videoId}`,
      video.publishedAt,
      durationSeconds,
      video.views,
      metrics.viewsPerDay,
      metrics.viewsPerHour,
      metrics.ageHours,
      metrics.growthVelocity,
      shortInfo.isShort,
      shortInfo.shortFormat,
      shortInfo.shortRejectionReason,
      tierInfo.viralTier,
      JSON.stringify(rawMetrics),
      video.channelId,
      video.channelTitle,
      video.thumbnailUrl,
      tierInfo.qualified,
      metrics.rankScore,
      scannedAt,
      entity.brand,
      entity.series,
      entity.model,
      entity.vehicleType,
      entity.action,
      resolvedVehicleId,
      resolvedCountryId,
      JSON.stringify(
        entity.conflictKeywords
      ),
      entity.status,
      entity.confidence,
      entity.matchMethod,
      JSON.stringify(entity.evidence),
      entity.resolverVersion
    ]
  );

  return result.rows[0];
}

async function insertSnapshot(
  pool,
  {
    signalId,
    views,
    rawMetrics,
    capturedAt
  }
) {
  await pool.query(
    `
      INSERT INTO signal_metric_snapshots (
        signal_id,
        views,
        raw_metrics,
        captured_at
      )
      VALUES (
        $1,
        $2,
        $3::jsonb,
        $4
      )
    `,
    [
      signalId,
      views,
      JSON.stringify(rawMetrics),
      capturedAt
    ]
  );
}

async function updateRunProgress(
  pool,
  runId,
  state
) {
  await pool.query(
    `
      UPDATE scanner_runs
      SET
        source_count = $1,
        resolved_source_count = $2,
        failed_source_count = $3,
        video_count = $4,
        inserted_count = $5,
        updated_count = $6,
        qualified_count = $7,
        quota_units_estimated = $8,
        summary = $9::jsonb,
        updated_at = NOW()
      WHERE id = $10
    `,
    [
      state.sourceCount,
      state.resolvedSourceCount,
      state.failedSourceCount,
      state.videoCount,
      state.insertedCount,
      state.updatedCount,
      state.qualifiedCount,
      state.quotaUnits,
      JSON.stringify(
        buildRunSummary(state)
      ),
      runId
    ]
  );
}

function buildRunSummary(state) {
  const summary = {
    scan_mode:
      state.scanMode,

    max_age_days:
      state.maxAgeDays,

    max_results_per_source:
      state.maxResultsPerSource,

    shorts_accepted:
      state.shortsAccepted,

    long_videos_rejected:
      state.longVideosRejected,

    proven_count:
      state.provenCount,

    rising_count:
      state.risingCount,

    watch_count:
      state.watchCount,

    unqualified_count:
      state.unqualifiedCount,

    qualified_count:
      state.qualifiedCount,

    entity_resolved_count:
      state.entityResolvedCount,

    entity_brand_only_count:
      state.entityBrandOnlyCount,

    entity_ambiguous_count:
      state.entityAmbiguousCount,

    entity_unresolved_count:
      state.entityUnresolvedCount,

    entity_not_applicable_count:
      state.entityNotApplicableCount,

    country_resolved_count:
      state.countryResolvedCount,

    vehicle_record_linked_count:
      state.vehicleRecordLinkedCount,

    errors:
      state.errors
  };

  if (state.scanMode === "HISTORICAL") {
    summary.history_scope = HISTORY_SCOPE;
    summary.pages_scanned = state.pagesScanned;
    summary.videos_discovered = state.videosDiscovered;
    summary.videos_processed = state.videosProcessed;

    // Never claim a complete ALL_TIME history while any
    // source failed outright or was truncated by the page cap.
    summary.history_complete =
      state.failedSourceCount === 0 &&
      state.truncatedSources.length === 0;

    summary.truncated_sources = state.truncatedSources;

    summary.oldest_video_published_at =
      state.oldestVideoPublishedAt;

    summary.newest_video_published_at =
      state.newestVideoPublishedAt;
  }

  return summary;
}

async function finalizeRun(
  pool,
  runId,
  state
) {
  const completed =
    state.resolvedSourceCount > 0;

  const status = completed
    ? "COMPLETED"
    : "FAILED";

  const errorMessage = completed
    ? null
    : (
        state.errors
          .slice(0, 3)
          .map(item =>
            `${item.source_name}: ${item.message}`
          )
          .join(" | ") ||
        "No YouTube sources were processed successfully."
      );

  await pool.query(
    `
      UPDATE scanner_runs
      SET
        status = $1,
        source_count = $2,
        resolved_source_count = $3,
        failed_source_count = $4,
        video_count = $5,
        inserted_count = $6,
        updated_count = $7,
        qualified_count = $8,
        quota_units_estimated = $9,
        summary = $10::jsonb,
        error_message = $11,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $12
    `,
    [
      status,
      state.sourceCount,
      state.resolvedSourceCount,
      state.failedSourceCount,
      state.videoCount,
      state.insertedCount,
      state.updatedCount,
      state.qualifiedCount,
      state.quotaUnits,
      JSON.stringify(
        buildRunSummary(state)
      ),
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

async function executeRun(
  pool,
  run,
  {
    apiKey
  }
) {
  const options = normalizeRunPayload(
    run.request_payload
  );

  const state = {
    sourceCount: 0,
    resolvedSourceCount: 0,
    failedSourceCount: 0,
    videoCount: 0,
    insertedCount: 0,
    updatedCount: 0,
    qualifiedCount: 0,
    shortsAccepted: 0,
    longVideosRejected: 0,
    provenCount: 0,
    risingCount: 0,
    watchCount: 0,
    unqualifiedCount: 0,
    entityResolvedCount: 0,
    entityBrandOnlyCount: 0,
    entityAmbiguousCount: 0,
    entityUnresolvedCount: 0,
    entityNotApplicableCount: 0,
    countryResolvedCount: 0,
    vehicleRecordLinkedCount: 0,
    quotaUnits: 0,
    maxAgeDays:
      options.maxAgeDays,
    maxResultsPerSource:
      options.maxResultsPerSource,
    scanMode:
      options.scanMode,
    pagesScanned: 0,
    videosDiscovered: 0,
    videosProcessed: 0,
    truncatedSources: [],
    oldestVideoPublishedAt: null,
    newestVideoPublishedAt: null,
    errors: []
  };

  const sources = await loadSources(
    pool,
    options.sourceIds
  );

  // Cached once per run so the resolver never issues
  // per-video reference lookups.
  const countryMap =
    await loadCountryMap(pool);

  const vehicleMap =
    await loadVehicleMap(pool);

  state.sourceCount = sources.length;

  await updateRunProgress(
    pool,
    run.id,
    state
  );

  for (const source of sources) {
    try {
      await markSourceRunning(
        pool,
        source.id
      );

      const sourceForLookup =
        options.forceRefreshChannels
          ? {
              ...source,
              youtube_channel_id: null,
              youtube_uploads_playlist_id:
                null
            }
          : source;

      const channel = await resolveChannel(
        sourceForLookup,
        {
          apiKey,
          onRequest() {
            state.quotaUnits += 1;
          }
        }
      );

      let videoIds;

      if (options.scanMode === "HISTORICAL") {
        const pagination =
          await fetchAllUploadVideoIds(
            channel.uploadsPlaylistId,
            {
              apiKey,
              maxPages:
                options.maxPagesPerSource,
              onRequest() {
                state.quotaUnits += 1;
              }
            }
          );

        videoIds = pagination.videoIds;
        state.pagesScanned +=
          pagination.pagesScanned;
        state.videosDiscovered +=
          videoIds.length;

        if (pagination.truncated) {
          state.truncatedSources.push(
            source.name
          );
        }
      } else {
        videoIds =
          await fetchUploadVideoIds(
            channel.uploadsPlaylistId,
            options.maxResultsPerSource,
            {
              apiKey,
              onRequest() {
                state.quotaUnits += 1;
              }
            }
          );
      }

      const videos = await fetchVideos(
        videoIds,
        {
          apiKey,
          onRequest() {
            state.quotaUnits += 1;
          }
        }
      );

      const scannedAt = new Date();

      for (const video of videos) {
        if (
          !video.publishedAt ||
          video.privacyStatus !== "public" ||
          video.liveBroadcastContent === "live"
        ) {
          continue;
        }

        const publishedAt = new Date(
          video.publishedAt
        );

        if (
          Number.isNaN(
            publishedAt.getTime()
          )
        ) {
          continue;
        }

        // HISTORICAL mode never applies the current-mode age
        // cutoff: an ALL_TIME historical scan must be able to
        // save a 10-year-old upload.
        if (options.scanMode !== "HISTORICAL") {
          const ageMilliseconds =
            scannedAt.getTime() -
            publishedAt.getTime();

          const maxAgeMilliseconds =
            options.maxAgeDays *
            86400000;

          if (
            ageMilliseconds < 0 ||
            ageMilliseconds >
              maxAgeMilliseconds
          ) {
            continue;
          }
        }

        if (options.scanMode === "HISTORICAL") {
          state.videosProcessed += 1;

          if (
            state.oldestVideoPublishedAt ===
              null ||
            publishedAt <
              state.oldestVideoPublishedAt
          ) {
            state.oldestVideoPublishedAt =
              publishedAt;
          }

          if (
            state.newestVideoPublishedAt ===
              null ||
            publishedAt >
              state.newestVideoPublishedAt
          ) {
            state.newestVideoPublishedAt =
              publishedAt;
          }
        }

        const durationSeconds =
          parseIso8601Duration(
            video.duration
          );

        const shortInfo =
          classifyShortFormat(
            durationSeconds
          );

        const previous =
          await getPreviousSignalState(
            pool,
            source.id,
            video.videoId
          );

        const metrics =
          deriveSignalMetrics({
            views: video.views,
            publishedAt:
              video.publishedAt,

            previousViews:
              previous?.previous_views ??
              null,

            previousCapturedAt:
              previous?.previous_captured_at ??
              null,

            now: scannedAt,
            maxAgeDays:
              options.maxAgeDays
          });

        const tierInfo =
          classifyViralTier({
            isShort:
              shortInfo.isShort,

            views: video.views,

            viewsPerDay:
              metrics.viewsPerDay,

            ageDays:
              metrics.ageDays
          });

        // Vehicle anchor only: never touches views,
        // viral tier, qualification, or rank score.
        const entity =
          resolveVehicleEntity({
            isShort:
              shortInfo.isShort,
            title: video.title,
            channelTitle:
              video.channelTitle,
            sourceName: source.name,
            description:
              video.description,
            tags: video.tags
          });

        const resolvedCountryId =
          lookupResolvedCountryId(
            countryMap,
            entity
          );

        const resolvedVehicleId =
          lookupResolvedVehicleId(
            vehicleMap,
            entity
          );

        const rawMetrics = {
          likes: video.likes,
          comments: video.comments,

          duration_iso:
            video.duration,

          duration_bucket:
            getDurationBucket(
              durationSeconds
            ),

          short_format:
            shortInfo.shortFormat,

          viral_tier:
            tierInfo.viralTier,

          privacy_status:
            video.privacyStatus,

          live_broadcast_content:
            video.liveBroadcastContent,

          source_name:
            source.name,

          scanner_run_id:
            String(run.id)
        };

        const savedSignal =
          await upsertSignal(
            pool,
            {
              source,
              video,
              durationSeconds,
              shortInfo,
              tierInfo,
              metrics,
              rawMetrics,
              scannedAt,
              entity,
              resolvedVehicleId,
              resolvedCountryId
            }
          );

        await insertSnapshot(
          pool,
          {
            signalId:
              savedSignal.id,
            views:
              video.views,
            rawMetrics,
            capturedAt:
              scannedAt
          }
        );

        state.videoCount += 1;

        if (previous) {
          state.updatedCount += 1;
        } else {
          state.insertedCount += 1;
        }

        if (shortInfo.isShort) {
          state.shortsAccepted += 1;
        } else {
          state.longVideosRejected += 1;
        }

        if (
          tierInfo.viralTier === "PROVEN"
        ) {
          state.provenCount += 1;
        } else if (
          tierInfo.viralTier === "RISING"
        ) {
          state.risingCount += 1;
        } else if (
          tierInfo.viralTier === "WATCH"
        ) {
          state.watchCount += 1;
        } else {
          state.unqualifiedCount += 1;
        }

        if (tierInfo.qualified) {
          state.qualifiedCount += 1;
        }

        if (
          entity.status ===
          ENTITY_STATUSES.RESOLVED
        ) {
          state.entityResolvedCount += 1;
        } else if (
          entity.status ===
          ENTITY_STATUSES.BRAND_ONLY
        ) {
          state.entityBrandOnlyCount += 1;
        } else if (
          entity.status ===
          ENTITY_STATUSES.AMBIGUOUS
        ) {
          state.entityAmbiguousCount += 1;
        } else if (
          entity.status ===
          ENTITY_STATUSES.UNRESOLVED
        ) {
          state.entityUnresolvedCount += 1;
        } else {
          state.entityNotApplicableCount += 1;
        }

        if (resolvedCountryId !== null) {
          state.countryResolvedCount += 1;
        }

        if (resolvedVehicleId !== null) {
          state.vehicleRecordLinkedCount += 1;
        }
      }

      await markSourceSuccess(
        pool,
        source.id,
        channel
      );

      state.resolvedSourceCount += 1;
    } catch (error) {
      state.failedSourceCount += 1;

      state.errors.push({
        source_id:
          String(source.id),

        source_name:
          source.name,

        message:
          String(
            error?.message ||
            "Unknown scanner error"
          ).slice(0, 1000)
      });

      await markSourceFailed(
        pool,
        source.id,
        error
      );
    }

    await updateRunProgress(
      pool,
      run.id,
      state
    );
  }

  return finalizeRun(
    pool,
    run.id,
    state
  );
}

async function failRun(
  pool,
  runId,
  error
) {
  await pool.query(
    `
      UPDATE scanner_runs
      SET
        status = 'FAILED',
        error_message = $1,
        completed_at = NOW(),
        updated_at = NOW()
      WHERE id = $2
    `,
    [
      String(
        error?.message ||
        "Unknown scanner failure"
      ).slice(0, 2000),
      runId
    ]
  );
}

async function processNextRun(
  pool,
  {
    workerId,
    apiKey
  }
) {
  const run = await claimNextRun(
    pool,
    workerId
  );

  if (!run) {
    return null;
  }

  try {
    return await executeRun(
      pool,
      run,
      {
        apiKey
      }
    );
  } catch (error) {
    await failRun(
      pool,
      run.id,
      error
    );

    throw error;
  }
}

module.exports = {
  HISTORY_SCOPE,
  SCAN_MODES,
  claimNextRun,
  executeRun,
  lookupResolvedVehicleId,
  normalizeRunPayload,
  processNextRun
};

const {
  deriveSignalMetrics,
  getDurationBucket,
  parseIso8601Duration
} = require("./metrics");

const {
  fetchUploadVideoIds,
  fetchVideos,
  resolveChannel
} = require("./youtube");

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
      payload.force_refresh_channels === true
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

async function getPreviousSignalState(
  pool,
  sourceId,
  videoId
) {
  const result = await pool.query(
    `
      SELECT
        sig.id,

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
    metrics,
    rawMetrics,
    scannedAt
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
        age_hours,
        growth_velocity,
        raw_metrics,
        channel_id,
        channel_title,
        thumbnail_url,
        qualified,
        rank_score,
        last_scanned_at
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
        $11::jsonb,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17
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
        age_hours =
          EXCLUDED.age_hours,
        growth_velocity =
          EXCLUDED.growth_velocity,
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
      metrics.ageHours,
      metrics.growthVelocity,
      JSON.stringify(rawMetrics),
      video.channelId,
      video.channelTitle,
      video.thumbnailUrl,
      metrics.qualified,
      metrics.rankScore,
      scannedAt
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
      JSON.stringify({
        max_age_days:
          state.maxAgeDays,

        max_results_per_source:
          state.maxResultsPerSource,

        errors:
          state.errors
      }),
      runId
    ]
  );
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
      JSON.stringify({
        max_age_days:
          state.maxAgeDays,

        max_results_per_source:
          state.maxResultsPerSource,

        errors:
          state.errors
      }),
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
    quotaUnits: 0,
    maxAgeDays:
      options.maxAgeDays,
    maxResultsPerSource:
      options.maxResultsPerSource,
    errors: []
  };

  const sources = await loadSources(
    pool,
    options.sourceIds
  );

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

      const videoIds =
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

        const durationSeconds =
          parseIso8601Duration(
            video.duration
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
              metrics,
              rawMetrics,
              scannedAt
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

        if (metrics.qualified) {
          state.qualifiedCount += 1;
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
  claimNextRun,
  executeRun,
  normalizeRunPayload,
  processNextRun
};

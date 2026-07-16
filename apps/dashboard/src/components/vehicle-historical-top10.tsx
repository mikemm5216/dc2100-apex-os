"use client";

import { Fragment, useEffect, useState } from "react";

import {
  fetchScannerRun,
  fetchVehicleHistoricalDetail,
  fetchVehicleHistoricalRanking,
  queueScannerRun,
} from "@/lib/api";

import type {
  ScannerRun,
  VehicleHistoricalDetail,
  VehicleHistoricalFormat,
  VehicleHistoricalResponse,
  VehicleHistoryScope,
} from "@/lib/api";

const activeRunStatuses = new Set(["QUEUED", "RUNNING"]);

const scopeOptions: Array<{
  value: VehicleHistoryScope;
  label: string;
}> = [
  { value: "ONE_YEAR", label: "1 Year" },
  { value: "TEN_YEARS", label: "10 Years" },
  { value: "ALL_TIME", label: "All Time" },
];

const formatOptions: Array<{
  value: VehicleHistoricalFormat;
  label: string;
}> = [
  { value: "SHORTS", label: "Shorts" },
  { value: "ALL", label: "All Videos" },
];

function numeric(value: string | number | null | undefined) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactNumber(value: string | number | null | undefined) {
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(numeric(value));
}

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  }).format(date);
}

export function VehicleHistoricalTop10() {
  const [scope, setScope] =
    useState<VehicleHistoryScope>("ALL_TIME");

  const [format, setFormat] =
    useState<VehicleHistoricalFormat>("SHORTS");

  const [response, setResponse] =
    useState<VehicleHistoricalResponse | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [historicalRun, setHistoricalRun] =
    useState<ScannerRun | null>(null);

  const [isQueueing, setIsQueueing] = useState(false);

  const [expandedVehicleId, setExpandedVehicleId] =
    useState<string | null>(null);

  const [detail, setDetail] =
    useState<VehicleHistoricalDetail | null>(null);

  const [isDetailLoading, setIsDetailLoading] =
    useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchVehicleHistoricalRanking(
          {
            history_scope: scope,
            format,
            limit: 10,
            offset: 0,
          },
          controller.signal
        );

        setResponse(payload);
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Failed to load vehicle historical ranking."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => controller.abort();
  }, [scope, format, reloadKey]);

  const runId = historicalRun?.id;
  const runStatus = historicalRun?.status;

  useEffect(() => {
    if (
      !runId ||
      !runStatus ||
      !activeRunStatuses.has(runStatus)
    ) {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const nextRun = await fetchScannerRun(runId);

        setHistoricalRun(nextRun);

        if (!activeRunStatuses.has(nextRun.status)) {
          setReloadKey((value) => value + 1);
        }
      } catch (pollError) {
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll historical scanner run."
        );
      }
    }, 3000);

    return () => window.clearInterval(timer);
  }, [runId, runStatus]);

  async function handleHistoricalScan() {
    setIsQueueing(true);
    setError(null);

    try {
      const run = await queueScannerRun({
        scan_mode: "HISTORICAL",
      });

      setHistoricalRun(run);
    } catch (queueError) {
      setError(
        queueError instanceof Error
          ? queueError.message
          : "Failed to queue historical scan."
      );
    } finally {
      setIsQueueing(false);
    }
  }

  async function handleExpand(vehicleId: string) {
    if (expandedVehicleId === vehicleId) {
      setExpandedVehicleId(null);
      setDetail(null);
      return;
    }

    setExpandedVehicleId(vehicleId);
    setDetail(null);
    setIsDetailLoading(true);

    try {
      const payload = await fetchVehicleHistoricalDetail(
        vehicleId,
        { history_scope: scope, format }
      );

      setDetail(payload);
    } catch (detailError) {
      setError(
        detailError instanceof Error
          ? detailError.message
          : "Failed to load vehicle historical evidence."
      );
    } finally {
      setIsDetailLoading(false);
    }
  }

  const rows = response?.data ?? [];
  const historyComplete = response?.history_complete ?? false;
  const topVideo = detail?.top_video ?? null;

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-950">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-800 bg-gradient-to-r from-sky-950/30 to-neutral-950 px-5 py-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-sky-500">
            Vehicle Historical Top 10 Videos
          </p>

          <h2 className="mt-2 text-2xl font-semibold text-white">
            Vehicle Historical Top 10 Videos
          </h2>

          <p className="mt-1 text-sm text-neutral-400">
            Highest-viewed individual historical video for each
            distinct resolved vehicle.
          </p>
        </div>

        <div className="flex flex-col items-end gap-2">
          <button
            type="button"
            disabled={
              isQueueing ||
              Boolean(
                historicalRun &&
                  activeRunStatuses.has(
                    historicalRun.status
                  )
              )
            }
            onClick={handleHistoricalScan}
            className="h-10 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isQueueing
              ? "Queueing..."
              : historicalRun &&
                  activeRunStatuses.has(
                    historicalRun.status
                  )
                ? `${historicalRun.status} #${historicalRun.id}`
                : "Refresh Historical Scan"}
          </button>

          <span
            className={`rounded-full border px-3 py-1 text-[11px] font-medium ${
              historyComplete
                ? "border-emerald-900 bg-emerald-950/60 text-emerald-300"
                : "border-amber-900 bg-amber-950/60 text-amber-300"
            }`}
          >
            {historyComplete
              ? "ALL_TIME COMPLETE"
              : "PARTIAL HISTORY"}
          </span>
        </div>
      </div>

      {historicalRun && (
        <div className="grid gap-3 border-b border-neutral-800 bg-neutral-900/40 px-5 py-4 sm:grid-cols-2 lg:grid-cols-6">
          <div>
            <p className="text-[11px] uppercase text-neutral-500">
              Run
            </p>
            <p className="mt-1 text-sm text-white">
              #{historicalRun.id}
            </p>
          </div>

          <div>
            <p className="text-[11px] uppercase text-neutral-500">
              Status
            </p>
            <p className="mt-1 text-sm text-sky-400">
              {historicalRun.status}
            </p>
          </div>

          <div>
            <p className="text-[11px] uppercase text-neutral-500">
              Pages Scanned
            </p>
            <p className="mt-1 text-sm text-white">
              {historicalRun.summary?.pages_scanned ?? "—"}
            </p>
          </div>

          <div>
            <p className="text-[11px] uppercase text-neutral-500">
              Videos Discovered
            </p>
            <p className="mt-1 text-sm text-white">
              {historicalRun.summary?.videos_discovered ??
                "—"}
            </p>
          </div>

          <div>
            <p className="text-[11px] uppercase text-neutral-500">
              Videos Processed
            </p>
            <p className="mt-1 text-sm text-white">
              {historicalRun.summary?.videos_processed ??
                "—"}
            </p>
          </div>

          <div>
            <p className="text-[11px] uppercase text-neutral-500">
              Truncated Sources
            </p>
            <p className="mt-1 text-sm text-neutral-300">
              {historicalRun.summary?.truncated_sources
                ?.length ?? 0}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-b border-neutral-800 bg-neutral-900/30 p-4">
        <label className="space-y-1">
          <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
            Scope
          </span>
          <select
            value={scope}
            onChange={(event) =>
              setScope(
                event.target.value as VehicleHistoryScope
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            {scopeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="space-y-1">
          <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
            Format
          </span>
          <select
            value={format}
            onChange={(event) =>
              setFormat(
                event.target
                  .value as VehicleHistoricalFormat
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            {formatOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setReloadKey((value) => value + 1)}
          className="ml-auto h-10 self-end rounded-lg border border-neutral-700 px-4 text-sm text-neutral-300"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="border-b border-red-950 bg-red-950/20 px-5 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-sm text-neutral-500">
          Loading historical ranking...
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-sm font-medium text-neutral-300">
            No vehicles have a resolved historical ranking yet.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Run the historical scan, or widen the scope /
            format filters.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">Rank</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Video Title</th>
                <th className="px-4 py-3 text-right">
                  Single Video Views
                </th>
                <th className="px-4 py-3">Channel</th>
                <th className="px-4 py-3">Published Date</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3">History</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rows.map((row) => (
                <Fragment key={row.vehicle_id}>
                  <tr
                    className="cursor-pointer hover:bg-neutral-900/50"
                    onClick={() =>
                      handleExpand(row.vehicle_id)
                    }
                  >
                    <td className="px-4 py-3 font-mono text-neutral-500">
                      {String(row.rank).padStart(2, "0")}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">
                        {row.vehicle_name}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {row.vehicle_code}
                        {row.manufacturer
                          ? ` · ${row.manufacturer}`
                          : ""}
                      </p>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <a
                        href={row.video_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) =>
                          event.stopPropagation()
                        }
                        className="line-clamp-2 text-xs text-sky-400 hover:text-sky-300"
                      >
                        {row.video_title}
                      </a>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sky-300">
                      {compactNumber(row.video_views)}
                    </td>
                    <td className="px-4 py-3 text-neutral-300">
                      {row.channel_title ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-neutral-300">
                      {formatDate(row.published_at)}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={row.video_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) =>
                          event.stopPropagation()
                        }
                        className="text-xs text-sky-400 hover:text-sky-300"
                      >
                        {row.source_name ?? "Source"}
                      </a>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          row.history_complete
                            ? "border-emerald-900 bg-emerald-950/60 text-emerald-300"
                            : "border-amber-900 bg-amber-950/60 text-amber-300"
                        }`}
                      >
                        {row.history_complete
                          ? "COMPLETE"
                          : "PARTIAL"}
                      </span>
                    </td>
                  </tr>

                  {expandedVehicleId === row.vehicle_id && (
                    <tr>
                      <td
                        colSpan={8}
                        className="border-t border-neutral-900 bg-neutral-900/40 px-4 py-4"
                      >
                        {isDetailLoading ? (
                          <p className="text-xs text-neutral-500">
                            Loading evidence...
                          </p>
                        ) : topVideo ? (
                          <div className="flex flex-wrap gap-4">
                            {topVideo.thumbnail_url && (
                              <img
                                src={topVideo.thumbnail_url}
                                alt={topVideo.video_title}
                                className="h-24 w-40 rounded-lg border border-neutral-800 object-cover"
                              />
                            )}

                            <div className="min-w-0 flex-1 space-y-1 text-xs">
                              <a
                                href={topVideo.video_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-sm font-semibold text-sky-400 hover:text-sky-300"
                              >
                                {topVideo.video_title}
                              </a>
                              <p className="text-neutral-500">
                                {topVideo.video_url}
                              </p>
                              <p className="text-neutral-400">
                                {compactNumber(
                                  topVideo.video_views
                                )}{" "}
                                views ·{" "}
                                {formatDate(
                                  topVideo.published_at
                                )}{" "}
                                ·{" "}
                                {topVideo.source_name ??
                                  topVideo.channel_title ??
                                  "Unknown source"}
                              </p>
                              <p className="text-neutral-500">
                                Match method:{" "}
                                {topVideo.entity_match_method ??
                                  "—"}
                              </p>
                              {topVideo.entity_evidence && (
                                <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-[10px] text-neutral-400">
                                  {JSON.stringify(
                                    topVideo.entity_evidence,
                                    null,
                                    2
                                  )}
                                </pre>
                              )}
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-neutral-500">
                            No evidence available.
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

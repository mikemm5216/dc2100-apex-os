"use client";

import { Fragment, useEffect, useState } from "react";

import {
  fetchCountryDualVideoSignals,
  fetchCountryEventVideoRun,
  queueCountryEventVideoRun,
} from "@/lib/api";

import type {
  CountryDualVideoPack,
  CountryDualVideoResponse,
  CountryEventVideoRun,
  CountryPackFormat,
  CountryPackStatus,
} from "@/lib/api";

const activeRunStatuses = new Set(["QUEUED", "RUNNING"]);

const formatOptions: Array<{
  value: CountryPackFormat;
  label: string;
}> = [
  { value: "SHORTS", label: "Shorts" },
  { value: "ALL", label: "All Videos" },
];

const statusOptions: Array<{
  value: CountryPackStatus;
  label: string;
}> = [
  { value: "COMPLETE", label: "Complete" },
  { value: "VEHICLE_ONLY", label: "Vehicle Only" },
  { value: "EVENT_ONLY", label: "Event Only" },
  { value: "NO_MATCH", label: "No Match" },
  { value: "ALL", label: "All Statuses" },
];

const statusBadgeStyles: Record<CountryPackStatus, string> = {
  ALL: "border-neutral-700 bg-neutral-900 text-neutral-400",
  COMPLETE:
    "border-emerald-900 bg-emerald-950/60 text-emerald-300",
  VEHICLE_ONLY:
    "border-sky-900 bg-sky-950/60 text-sky-300",
  EVENT_ONLY:
    "border-amber-900 bg-amber-950/60 text-amber-300",
  NO_MATCH:
    "border-neutral-700 bg-neutral-900 text-neutral-500",
};

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

export function CountryDualVideoSignals() {
  const [format, setFormat] = useState<CountryPackFormat>(
    "SHORTS"
  );

  const [status, setStatus] = useState<CountryPackStatus>(
    "COMPLETE"
  );

  const [response, setResponse] =
    useState<CountryDualVideoResponse | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [run, setRun] = useState<CountryEventVideoRun | null>(
    null
  );
  const [isQueueing, setIsQueueing] = useState(false);

  const [expandedCountryId, setExpandedCountryId] =
    useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchCountryDualVideoSignals(
          {
            window_hours: 168,
            format,
            status,
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
            : "Failed to load country dual video signals."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => controller.abort();
  }, [format, status, reloadKey]);

  const runId = run?.id;
  const runStatus = run?.status;

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
        const nextRun = await fetchCountryEventVideoRun(
          runId
        );

        setRun(nextRun);

        if (!activeRunStatuses.has(nextRun.status)) {
          setReloadKey((value) => value + 1);
        }
      } catch (pollError) {
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll country event video run."
        );
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [runId, runStatus]);

  async function handleRefresh() {
    setIsQueueing(true);
    setError(null);

    try {
      const nextRun = await queueCountryEventVideoRun({
        window_hours: 168,
        format,
      });

      setRun(nextRun);
    } catch (queueError) {
      setError(
        queueError instanceof Error
          ? queueError.message
          : "Failed to queue country event video run."
      );
    } finally {
      setIsQueueing(false);
    }
  }

  const runIsActive = Boolean(
    run && activeRunStatuses.has(run.status)
  );

  const rows: CountryDualVideoPack[] = response?.data ?? [];

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-950">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-800 bg-gradient-to-r from-emerald-950/30 to-neutral-950 px-5 py-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-emerald-500">
            Country Dual Video Signals
          </p>

          <h2 className="mt-2 text-2xl font-semibold text-white">
            Vehicle Identity + Current Event, Per Country
          </h2>

          <p className="mt-1 text-sm text-neutral-400">
            Every country pack carries TWO independent single-video
            signals: the vehicle-origin identity video and the
            current-event video. Neither replaces the other.
          </p>
        </div>

        <button
          type="button"
          onClick={handleRefresh}
          disabled={isQueueing || runIsActive}
          className="h-10 rounded-lg border border-neutral-700 px-4 text-sm text-neutral-300 disabled:opacity-50"
        >
          {runIsActive
            ? `Running (${run?.status})...`
            : isQueueing
              ? "Queueing..."
              : "Refresh"}
        </button>
      </div>

      {run?.status === "FAILED" && (
        <div className="border-b border-red-950 bg-red-950/20 px-5 py-3 text-sm text-red-300">
          Country event video run failed:{" "}
          {run.error_message ?? "Unknown error."}
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-b border-neutral-800 bg-neutral-900/30 p-4">
        <label className="space-y-1">
          <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
            Format
          </span>
          <select
            value={format}
            onChange={(event) =>
              setFormat(
                event.target.value as CountryPackFormat
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

        <label className="space-y-1">
          <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
            Pack Status
          </span>
          <select
            value={status}
            onChange={(event) =>
              setStatus(
                event.target.value as CountryPackStatus
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div className="border-b border-red-950 bg-red-950/20 px-5 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="p-10 text-center text-sm text-neutral-500">
          Loading country dual video signals...
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-sm font-medium text-neutral-300">
            No country packs match this status yet.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Reserve statuses (VEHICLE_ONLY / EVENT_ONLY / NO_MATCH)
            are kept, not deleted -- try widening the status filter.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">Country</th>
                <th className="px-4 py-3">Vehicle Identity Video</th>
                <th className="px-4 py-3 text-right">Vehicle Views</th>
                <th className="px-4 py-3">Current Event</th>
                <th className="px-4 py-3">Event Video</th>
                <th className="px-4 py-3 text-right">Event Views/Hr</th>
                <th className="px-4 py-3">Pack Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rows.map((pack) => (
                <Fragment key={pack.country_id}>
                  <tr
                    className="cursor-pointer hover:bg-neutral-900/50"
                    onClick={() =>
                      setExpandedCountryId(
                        expandedCountryId === pack.country_id
                          ? null
                          : pack.country_id
                      )
                    }
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">
                        {pack.country_name}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {pack.country_code}
                        {pack.shared_signal ? " · shared signal" : ""}
                      </p>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      {pack.country_vehicle_identity_video ? (
                        <a
                          href={
                            pack.country_vehicle_identity_video
                              .video_url
                          }
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) =>
                            event.stopPropagation()
                          }
                          className="line-clamp-2 text-xs text-sky-400 hover:text-sky-300"
                        >
                          {
                            pack.country_vehicle_identity_video
                              .video_title
                          }
                        </a>
                      ) : (
                        <span className="text-xs text-neutral-600">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sky-300">
                      {pack.country_vehicle_identity_video
                        ? compactNumber(
                            pack.country_vehicle_identity_video
                              .video_views
                          )
                        : "—"}
                    </td>
                    <td className="max-w-xs px-4 py-3 text-xs text-neutral-300">
                      {pack.country_current_event_video
                        ? pack.country_current_event_video
                            .news_title
                        : "—"}
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      {pack.country_current_event_video ? (
                        <a
                          href={
                            pack.country_current_event_video
                              .video_url
                          }
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) =>
                            event.stopPropagation()
                          }
                          className="line-clamp-2 text-xs text-amber-400 hover:text-amber-300"
                        >
                          {
                            pack.country_current_event_video
                              .video_title
                          }
                        </a>
                      ) : (
                        <span className="text-xs text-neutral-600">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-amber-300">
                      {pack.country_current_event_video
                        ?.views_per_hour
                        ? compactNumber(
                            pack.country_current_event_video
                              .views_per_hour
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadgeStyles[pack.status]}`}
                      >
                        {pack.status}
                      </span>
                    </td>
                  </tr>

                  {expandedCountryId === pack.country_id && (
                    <tr>
                      <td
                        colSpan={7}
                        className="border-t border-neutral-900 bg-neutral-900/40 px-4 py-4 text-xs text-neutral-400"
                      >
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <p className="mb-1 text-[11px] uppercase tracking-wider text-sky-500">
                              Vehicle Identity Evidence
                            </p>
                            {pack.country_vehicle_identity_video ? (
                              <pre className="max-h-40 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-[10px]">
                                {JSON.stringify(
                                  pack.country_vehicle_identity_video
                                    .entity_evidence,
                                  null,
                                  2
                                )}
                              </pre>
                            ) : (
                              <p>No vehicle identity video.</p>
                            )}
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] uppercase tracking-wider text-amber-500">
                              Current Event Relevance
                            </p>
                            {pack.country_current_event_video ? (
                              <pre className="max-h-40 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-[10px]">
                                {JSON.stringify(
                                  pack.country_current_event_video
                                    .relevance_evidence,
                                  null,
                                  2
                                )}
                              </pre>
                            ) : (
                              <p>No current event video.</p>
                            )}
                          </div>
                        </div>
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

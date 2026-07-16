"use client";

import { Fragment, useEffect, useState } from "react";

import {
  fetchPersonDirectVideoRun,
  fetchPersonDualVideoSignals,
  queuePersonDirectVideoRun,
} from "@/lib/api";

import type {
  PersonDirectVideoRun,
  PersonDualVideoPack,
  PersonDualVideoResponse,
  PersonPackFormat,
  PersonPackHistoryScope,
  PersonPackStatus,
} from "@/lib/api";

const activeRunStatuses = new Set(["QUEUED", "RUNNING"]);

const scopeOptions: Array<{
  value: PersonPackHistoryScope;
  label: string;
}> = [
  { value: "ONE_YEAR", label: "1 Year" },
  { value: "TEN_YEARS", label: "10 Years" },
  { value: "ALL_TIME", label: "All Time" },
];

const formatOptions: Array<{
  value: PersonPackFormat;
  label: string;
}> = [
  { value: "SHORTS", label: "Shorts" },
  { value: "ALL", label: "All Videos" },
];

const statusOptions: Array<{
  value: PersonPackStatus;
  label: string;
}> = [
  { value: "COMPLETE", label: "Complete" },
  { value: "DIRECT_ONLY", label: "Direct Only" },
  { value: "ASSOCIATION_ONLY", label: "Association Only" },
  { value: "NO_MATCH", label: "No Match" },
  { value: "ALL", label: "All Statuses" },
];

const statusBadgeStyles: Record<PersonPackStatus, string> = {
  ALL: "border-neutral-700 bg-neutral-900 text-neutral-400",
  COMPLETE:
    "border-emerald-900 bg-emerald-950/60 text-emerald-300",
  DIRECT_ONLY:
    "border-purple-900 bg-purple-950/60 text-purple-300",
  ASSOCIATION_ONLY:
    "border-sky-900 bg-sky-950/60 text-sky-300",
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

export function PersonDualVideoSignals() {
  const [scope, setScope] = useState<PersonPackHistoryScope>(
    "ALL_TIME"
  );

  const [format, setFormat] = useState<PersonPackFormat>(
    "SHORTS"
  );

  const [status, setStatus] = useState<PersonPackStatus>(
    "COMPLETE"
  );

  const [response, setResponse] =
    useState<PersonDualVideoResponse | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [run, setRun] = useState<PersonDirectVideoRun | null>(
    null
  );
  const [isQueueing, setIsQueueing] = useState(false);

  const [expandedPersonId, setExpandedPersonId] =
    useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchPersonDualVideoSignals(
          {
            history_scope: scope,
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
            : "Failed to load person dual video signals."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => controller.abort();
  }, [scope, format, status, reloadKey]);

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
        const nextRun = await fetchPersonDirectVideoRun(
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
            : "Failed to poll person direct video run."
        );
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [runId, runStatus]);

  async function handleRefresh() {
    setIsQueueing(true);
    setError(null);

    try {
      const nextRun = await queuePersonDirectVideoRun({});

      setRun(nextRun);
    } catch (queueError) {
      setError(
        queueError instanceof Error
          ? queueError.message
          : "Failed to queue person direct video run."
      );
    } finally {
      setIsQueueing(false);
    }
  }

  const runIsActive = Boolean(
    run && activeRunStatuses.has(run.status)
  );

  const rows: PersonDualVideoPack[] = response?.data ?? [];

  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-950">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-800 bg-gradient-to-r from-purple-950/30 to-neutral-950 px-5 py-5">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-purple-500">
            Person Dual Video Signals
          </p>

          <h2 className="mt-2 text-2xl font-semibold text-white">
            Association + Direct Hook, Per Person
          </h2>

          <p className="mt-1 text-sm text-neutral-400">
            Every person pack carries TWO independent single-video
            signals: the highest-viewed linked-vehicle video and
            the highest-viewed video mentioning the person directly.
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
          Person direct video run failed:{" "}
          {run.error_message ?? "Unknown error."}
        </div>
      )}

      <div className="flex flex-wrap gap-3 border-b border-neutral-800 bg-neutral-900/30 p-4">
        <label className="space-y-1">
          <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
            History Scope
          </span>
          <select
            value={scope}
            onChange={(event) =>
              setScope(
                event.target.value as PersonPackHistoryScope
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
                event.target.value as PersonPackFormat
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
                event.target.value as PersonPackStatus
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
          Loading person dual video signals...
        </div>
      ) : rows.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-sm font-medium text-neutral-300">
            No person packs match this status yet.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            Reserve statuses (ASSOCIATION_ONLY / NO_MATCH) are kept,
            not deleted -- try widening the status filter.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1150px] text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-[11px] uppercase tracking-wider text-neutral-500">
                <th className="px-4 py-3">Person</th>
                <th className="px-4 py-3">Association Video</th>
                <th className="px-4 py-3">Linked Vehicle</th>
                <th className="px-4 py-3">Assoc. Level</th>
                <th className="px-4 py-3">Direct Person Video</th>
                <th className="px-4 py-3 text-right">Direct Views</th>
                <th className="px-4 py-3">Direct Field</th>
                <th className="px-4 py-3">Pack Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rows.map((pack) => (
                <Fragment key={pack.person_id}>
                  <tr
                    className="cursor-pointer hover:bg-neutral-900/50"
                    onClick={() =>
                      setExpandedPersonId(
                        expandedPersonId === pack.person_id
                          ? null
                          : pack.person_id
                      )
                    }
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-white">
                        {pack.canonical_name}
                      </p>
                      <p className="text-xs text-neutral-500">
                        {pack.role_category.replaceAll("_", " ")}
                        {pack.shared_signal ? " · shared signal" : ""}
                      </p>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      {pack.person_association_video ? (
                        <a
                          href={
                            pack.person_association_video.video_url
                          }
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) =>
                            event.stopPropagation()
                          }
                          className="line-clamp-2 text-xs text-sky-400 hover:text-sky-300"
                        >
                          {
                            pack.person_association_video
                              .video_title
                          }
                        </a>
                      ) : (
                        <span className="text-xs text-neutral-600">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-300">
                      {pack.person_association_video
                        ? [
                            pack.person_association_video
                              .vehicle_brand,
                            pack.person_association_video
                              .vehicle_model,
                          ]
                            .filter(Boolean)
                            .join(" ")
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-400">
                      {pack.person_association_video
                        ?.association_level ?? "—"}
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      {pack.person_direct_hook_video ? (
                        <a
                          href={
                            pack.person_direct_hook_video.video_url
                          }
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) =>
                            event.stopPropagation()
                          }
                          className="line-clamp-2 text-xs text-purple-400 hover:text-purple-300"
                        >
                          {
                            pack.person_direct_hook_video
                              .video_title
                          }
                        </a>
                      ) : (
                        <span className="text-xs text-neutral-600">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-purple-300">
                      {pack.person_direct_hook_video
                        ? compactNumber(
                            pack.person_direct_hook_video
                              .video_views
                          )
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-neutral-400">
                      {pack.person_direct_hook_video
                        ?.direct_mention_field ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusBadgeStyles[pack.status]}`}
                      >
                        {pack.status}
                      </span>
                    </td>
                  </tr>

                  {expandedPersonId === pack.person_id && (
                    <tr>
                      <td
                        colSpan={8}
                        className="border-t border-neutral-900 bg-neutral-900/40 px-4 py-4 text-xs text-neutral-400"
                      >
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                            <p className="mb-1 text-[11px] uppercase tracking-wider text-sky-500">
                              Association Evidence
                            </p>
                            {pack.person_association_video ? (
                              <pre className="max-h-40 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-[10px]">
                                {JSON.stringify(
                                  pack.person_association_video
                                    .association_evidence,
                                  null,
                                  2
                                )}
                              </pre>
                            ) : (
                              <p>No association video.</p>
                            )}
                          </div>
                          <div>
                            <p className="mb-1 text-[11px] uppercase tracking-wider text-purple-500">
                              Direct Mention Evidence
                            </p>
                            {pack.person_direct_hook_video ? (
                              <pre className="max-h-40 overflow-auto rounded-lg border border-neutral-800 bg-neutral-950 p-2 text-[10px]">
                                {JSON.stringify(
                                  pack.person_direct_hook_video
                                    .evidence,
                                  null,
                                  2
                                )}
                              </pre>
                            ) : (
                              <p>No direct mention video.</p>
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

"use client";

import { useEffect, useState } from "react";

import {
  ContentCandidate,
  fetchContents,
} from "@/lib/api";

const statusStyles: Record<string, string> = {
  DISCOVERED:
    "border-neutral-700 bg-neutral-800 text-neutral-300",

  ANALYZED:
    "border-blue-900 bg-blue-950 text-blue-300",

  RECOMMENDED:
    "border-violet-900 bg-violet-950 text-violet-300",

  CEO_APPROVED:
    "border-amber-900 bg-amber-950 text-amber-300",

  PACK_READY:
    "border-emerald-900 bg-emerald-950 text-emerald-300",

  GENERATING:
    "border-cyan-900 bg-cyan-950 text-cyan-300",

  UPLOADED:
    "border-sky-900 bg-sky-950 text-sky-300",

  QA_APPROVED:
    "border-green-900 bg-green-950 text-green-300",

  SCHEDULED:
    "border-indigo-900 bg-indigo-950 text-indigo-300",

  PUBLISHED:
    "border-fuchsia-900 bg-fuchsia-950 text-fuchsia-300",

  ANALYZING:
    "border-purple-900 bg-purple-950 text-purple-300",

  WINNER:
    "border-yellow-800 bg-yellow-950 text-yellow-300",

  RESERVE_SIGNAL:
    "border-orange-900 bg-orange-950 text-orange-300",

  ARCHIVED:
    "border-neutral-800 bg-neutral-950 text-neutral-500",
};

function formatDate(value: string) {
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

function priorityLabel(priority: number) {
  const labels: Record<number, string> = {
    1: "Critical",
    2: "High",
    3: "Normal",
    4: "Low",
    5: "Backlog",
  };

  return labels[priority] ?? `P${priority}`;
}

function StatusBadge({
  status,
}: {
  status: string;
}) {
  const style =
    statusStyles[status] ??
    "border-neutral-700 bg-neutral-900 text-neutral-300";

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${style}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3 p-6">
      <p className="text-sm text-neutral-400">
        Loading candidates from APEX API...
      </p>

      {[1, 2, 3, 4, 5].map((item) => (
        <div
          key={item}
          className="h-12 animate-pulse rounded-lg bg-neutral-800/70"
        />
      ))}
    </div>
  );
}

export function CandidatesTable() {
  const [contents, setContents] = useState<
    ContentCandidate[]
  >([]);

  const [isLoading, setIsLoading] =
    useState(true);

  const [error, setError] =
    useState<string | null>(null);

  const [reloadKey, setReloadKey] =
    useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadContents() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchContents(
          controller.signal
        );

        setContents(response.data);
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
            : "Failed to load candidates."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadContents();

    return () => {
      controller.abort();
    };
  }, [reloadKey]);

  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-950 bg-red-950/30 p-5">
          <p className="text-sm font-medium text-red-300">
            Failed to load candidates
          </p>

          <p className="mt-2 text-sm text-red-400/80">
            {error}
          </p>

          <button
            type="button"
            onClick={() =>
              setReloadKey((value) => value + 1)
            }
            className="mt-4 rounded-lg border border-red-900 px-3 py-2 text-sm text-red-300 transition hover:bg-red-950"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (contents.length === 0) {
    return (
      <div className="p-10 text-center">
        <p className="text-sm font-medium text-neutral-300">
          No candidates found.
        </p>

        <p className="mt-2 text-sm text-neutral-500">
          Content candidates will appear here after
          discovery and transformation.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between border-b border-neutral-800 px-6 py-4">
        <div>
          <p className="text-sm font-medium text-neutral-200">
            Content Candidates
          </p>

          <p className="mt-1 text-xs text-neutral-500">
            Live data from APEX API · {contents.length} records
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            setReloadKey((value) => value + 1)
          }
          className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300 transition hover:border-neutral-600 hover:bg-neutral-800 hover:text-white"
        >
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] border-collapse text-left">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-950/70">
              <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
                Content ID
              </th>

              <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
                Country
              </th>

              <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
                Vehicle
              </th>

              <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
                Source Signal
              </th>

              <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
                Status
              </th>

              <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
                Priority
              </th>

              <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
                Created
              </th>

              <th className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
                Updated
              </th>
            </tr>
          </thead>

          <tbody>
            {contents.map((content) => (
              <tr
                key={content.content_id}
                className="border-b border-neutral-900 transition hover:bg-neutral-900/60"
              >
                <td className="px-5 py-4 align-top">
                  <p className="font-mono text-sm font-medium text-white">
                    {content.content_id}
                  </p>

                  <p className="mt-1 max-w-60 text-xs text-neutral-500">
                    {content.title}
                  </p>
                </td>

                <td className="px-5 py-4 align-top">
                  <p className="text-sm text-neutral-200">
                    {content.country_code ?? "—"}
                  </p>

                  <p className="mt-1 text-xs text-neutral-500">
                    {content.country_name ?? "Unknown"}
                  </p>
                </td>

                <td className="px-5 py-4 align-top">
                  <p className="text-sm text-neutral-200">
                    {content.vehicle_code ?? "—"}
                  </p>

                  <p className="mt-1 max-w-48 text-xs text-neutral-500">
                    {content.vehicle_name ?? "Unknown"}
                  </p>
                </td>

                <td className="px-5 py-4 align-top">
                  <p className="max-w-72 text-sm leading-5 text-neutral-300">
                    {content.signal_title ?? "No source signal"}
                  </p>
                </td>

                <td className="px-5 py-4 align-top">
                  <StatusBadge
                    status={content.status}
                  />
                </td>

                <td className="px-5 py-4 align-top">
                  <p className="text-sm text-neutral-300">
                    P{content.priority}
                  </p>

                  <p className="mt-1 text-xs text-neutral-500">
                    {priorityLabel(content.priority)}
                  </p>
                </td>

                <td className="px-5 py-4 align-top text-sm text-neutral-400">
                  {formatDate(content.created_at)}
                </td>

                <td className="px-5 py-4 align-top text-sm text-neutral-400">
                  {formatDate(content.updated_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { FormEvent } from "react";

import {
  fetchScannerRun,
  fetchSignals,
  fetchSources,
  queueScannerRun,
} from "@/lib/api";

import type {
  ScannerRun,
  SignalDurationBucket,
  SignalRecord,
  SignalsResponse,
  SignalSort,
  SignalView,
  SourceRecord,
} from "@/lib/api";

const activeRunStatuses = new Set(["QUEUED", "RUNNING"]);

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

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";

  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;

  return minutes > 0
    ? `${minutes}m ${remaining}s`
    : `${remaining}s`;
}

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function SignalsDashboard() {
  const [response, setResponse] =
    useState<SignalsResponse | null>(null);

  const [sources, setSources] =
    useState<SourceRecord[]>([]);

  const [view, setView] =
    useState<SignalView>("top100");

  const [windowDays, setWindowDays] =
    useState<3 | 7 | 14 | 30>(30);

  const [durationBucket, setDurationBucket] =
    useState<SignalDurationBucket>("ALL");

  const [sort, setSort] =
    useState<SignalSort>("rank_score");

  const [sourceId, setSourceId] =
    useState("");

  const [queryInput, setQueryInput] =
    useState("");

  const [query, setQuery] =
    useState("");

  const [scanLimit, setScanLimit] =
    useState(10);

  const [forceRefresh, setForceRefresh] =
    useState(false);

  const [scannerRun, setScannerRun] =
    useState<ScannerRun | null>(null);

  const [isLoading, setIsLoading] =
    useState(true);

  const [isQueueing, setIsQueueing] =
    useState(false);

  const [error, setError] =
    useState<string | null>(null);

  const [reloadKey, setReloadKey] =
    useState(0);

  const loadSignals = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchSignals(
          {
            view,
            window_days: windowDays,
            duration_bucket: durationBucket,
            sort,
            source_id: sourceId || null,
            q: query,
            limit: view === "top30" ? 30 : 100,
            offset: 0,
          },
          signal
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
            : "Failed to load signals."
        );
      } finally {
        if (!signal?.aborted) {
          setIsLoading(false);
        }
      }
    },
    [
      durationBucket,
      query,
      sort,
      sourceId,
      view,
      windowDays,
    ]
  );

  useEffect(() => {
    const controller = new AbortController();

    loadSignals(controller.signal);

    return () => controller.abort();
  }, [loadSignals, reloadKey]);

  useEffect(() => {
    const controller = new AbortController();

    fetchSources(controller.signal)
      .then((payload) => setSources(payload.data))
      .catch((sourceError) => {
        if (
          sourceError instanceof DOMException &&
          sourceError.name === "AbortError"
        ) {
          return;
        }

        setError(
          sourceError instanceof Error
            ? sourceError.message
            : "Failed to load sources."
        );
      });

    return () => controller.abort();
  }, [reloadKey]);

  const runId = scannerRun?.id;
  const runStatus = scannerRun?.status;

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
        const nextRun =
          await fetchScannerRun(runId);

        setScannerRun(nextRun);

        if (!activeRunStatuses.has(nextRun.status)) {
          setReloadKey((value) => value + 1);
        }
      } catch (pollError) {
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll scanner run."
        );
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [runId, runStatus]);

  const youtubeSourceCount = useMemo(
    () =>
      sources.filter(
        (source) =>
          source.enabled &&
          source.platform.toLowerCase() === "youtube"
      ).length,
    [sources]
  );

  const signals: SignalRecord[] =
    response?.data ?? [];

  const qualifiedVisible = signals.filter(
    (signal) => signal.qualified
  ).length;

  const highestRank = signals.reduce(
    (highest, signal) =>
      Math.max(highest, numeric(signal.rank_score)),
    0
  );

  function handleSearch(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setQuery(queryInput.trim());
  }

  async function handleScannerRun() {
    setIsQueueing(true);
    setError(null);

    try {
      const run = await queueScannerRun({
        max_results_per_source: scanLimit,
        max_age_days: windowDays,
        force_refresh_channels: forceRefresh,
      });

      setScannerRun(run);
    } catch (queueError) {
      setError(
        queueError instanceof Error
          ? queueError.message
          : "Failed to queue scanner run."
      );
    } finally {
      setIsQueueing(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-orange-950 bg-neutral-950">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-orange-950/70 bg-gradient-to-r from-orange-950/40 to-neutral-950 px-5 py-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-orange-500">
              Viral Signal Radar
            </p>

            <h2 className="mt-2 text-2xl font-semibold text-white">
              Live Discovery Engine
            </h2>

            <p className="mt-1 text-sm text-neutral-400">
              Rank emerging automotive topics by velocity,
              reach, and recency.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
                Videos / Source
              </span>

              <select
                value={scanLimit}
                onChange={(event) =>
                  setScanLimit(Number(event.target.value))
                }
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
              >
                {[5, 10, 20, 30].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex h-10 items-center gap-2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-xs text-neutral-300">
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(event) =>
                  setForceRefresh(event.target.checked)
                }
              />
              Refresh channels
            </label>

            <button
              type="button"
              disabled={
                isQueueing ||
                Boolean(
                  scannerRun &&
                    activeRunStatuses.has(
                      scannerRun.status
                    )
                )
              }
              onClick={handleScannerRun}
              className="h-10 rounded-lg bg-orange-600 px-4 text-sm font-semibold text-white transition hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isQueueing
                ? "Queueing..."
                : scannerRun &&
                    activeRunStatuses.has(
                      scannerRun.status
                    )
                  ? `${scannerRun.status} #${scannerRun.id}`
                  : `Scan ${youtubeSourceCount} YouTube Sources`}
            </button>
          </div>
        </div>

        {scannerRun && (
          <div className="grid gap-3 border-b border-neutral-800 bg-neutral-900/40 px-5 py-4 sm:grid-cols-2 lg:grid-cols-6">
            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Run
              </p>
              <p className="mt-1 text-sm text-white">
                #{scannerRun.id}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Status
              </p>
              <p className="mt-1 text-sm text-orange-400">
                {scannerRun.status}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Sources
              </p>
              <p className="mt-1 text-sm text-white">
                {scannerRun.resolved_source_count}/
                {scannerRun.source_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Videos
              </p>
              <p className="mt-1 text-sm text-white">
                {scannerRun.video_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Qualified
              </p>
              <p className="mt-1 text-sm text-emerald-400">
                {scannerRun.qualified_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Quota
              </p>
              <p className="mt-1 text-sm text-white">
                {scannerRun.quota_units_estimated}
              </p>
            </div>
          </div>
        )}

        <div className="grid gap-px bg-neutral-800 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Filtered Signals", response?.total_count ?? 0],
            ["Visible", signals.length],
            ["Qualified", qualifiedVisible],
            ["Highest Rank", highestRank.toFixed(1)],
          ].map(([label, value]) => (
            <div
              key={label}
              className="bg-neutral-950 px-5 py-4"
            >
              <p className="text-[11px] uppercase tracking-wider text-neutral-500">
                {label}
              </p>
              <p className="mt-2 text-2xl font-semibold text-white">
                {value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950">
        <div className="flex flex-wrap gap-2 border-b border-neutral-800 p-4">
          {[
            ["top100", "Top 100"],
            ["qualified", "Qualified"],
            ["top30", "Top 30"],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() =>
                setView(value as SignalView)
              }
              className={
                view === value
                  ? "rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white"
                  : "rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-400 hover:text-white"
              }
            >
              {label}
            </button>
          ))}

          <button
            type="button"
            onClick={() =>
              setReloadKey((value) => value + 1)
            }
            className="ml-auto rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300"
          >
            Refresh
          </button>
        </div>

        <div className="grid gap-3 border-b border-neutral-800 bg-neutral-900/30 p-4 md:grid-cols-2 xl:grid-cols-6">
          <form
            onSubmit={handleSearch}
            className="flex gap-2 md:col-span-2"
          >
            <input
              value={queryInput}
              onChange={(event) =>
                setQueryInput(event.target.value)
              }
              placeholder="Search signal titles..."
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            />

            <button
              type="submit"
              className="rounded-lg border border-orange-900 px-3 py-2 text-sm text-orange-400"
            >
              Search
            </button>
          </form>

          <select
            value={windowDays}
            onChange={(event) =>
              setWindowDays(
                Number(event.target.value) as
                  | 3
                  | 7
                  | 14
                  | 30
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            {[3, 7, 14, 30].map((days) => (
              <option key={days} value={days}>
                Last {days} days
              </option>
            ))}
          </select>

          <select
            value={durationBucket}
            onChange={(event) =>
              setDurationBucket(
                event.target
                  .value as SignalDurationBucket
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="ALL">All durations</option>
            <option value="UNDER_10">Under 10 sec</option>
            <option value="10_TO_20">10–20 sec</option>
            <option value="20_TO_40">21–40 sec</option>
            <option value="OVER_40">Over 40 sec</option>
          </select>

          <select
            value={sort}
            onChange={(event) =>
              setSort(event.target.value as SignalSort)
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="rank_score">Rank score</option>
            <option value="growth_velocity">
              Growth velocity
            </option>
            <option value="views_per_day">
              Views per day
            </option>
            <option value="views">Total views</option>
            <option value="recency">Most recent</option>
          </select>

          <select
            value={sourceId}
            onChange={(event) =>
              setSourceId(event.target.value)
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="">All sources</option>
            {sources
              .filter((source) => source.signal_count > 0)
              .map((source) => (
                <option
                  key={source.id}
                  value={source.id}
                >
                  {source.name}
                </option>
              ))}
          </select>
        </div>

        {error && (
          <div className="border-b border-red-950 bg-red-950/20 px-5 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="p-10 text-center text-sm text-neutral-500">
            Loading signal intelligence...
          </div>
        ) : signals.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-neutral-300">
              No signals match these filters.
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              Run the scanner or widen the time window.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-800">
            {signals.map((signal, index) => (
              <article
                key={signal.id}
                className="grid gap-4 p-4 transition hover:bg-neutral-900/50 md:grid-cols-[40px_180px_minmax(0,1fr)]"
              >
                <div className="pt-1 text-center font-mono text-sm text-neutral-600">
                  {String(index + 1).padStart(2, "0")}
                </div>

                <a
                  href={signal.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900"
                >
                  <div
                    className="aspect-video bg-cover bg-center"
                    style={
                      signal.thumbnail_url
                        ? {
                            backgroundImage: `url("${signal.thumbnail_url}")`,
                          }
                        : undefined
                    }
                  />

                  <div className="flex justify-between px-3 py-2 text-[11px] text-neutral-500">
                    <span>
                      {formatDuration(
                        signal.duration_seconds
                      )}
                    </span>
                    <span>
                      {signal.source_country_code ??
                        "GLOBAL"}
                    </span>
                  </div>
                </a>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {signal.qualified && (
                          <span className="rounded-full border border-emerald-900 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            QUALIFIED
                          </span>
                        )}

                        <span className="text-xs text-neutral-500">
                          {signal.source_name ??
                            signal.channel_title ??
                            "Unknown source"}
                        </span>
                      </div>

                      <a
                        href={signal.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block text-base font-semibold leading-snug text-white hover:text-orange-400"
                      >
                        {signal.title}
                      </a>

                      <p className="mt-2 text-xs text-neutral-500">
                        Published{" "}
                        {formatDate(signal.published_at)}
                        {" · "}
                        Scanned{" "}
                        {formatDate(
                          signal.last_scanned_at
                        )}
                      </p>
                    </div>

                    <div className="rounded-lg border border-orange-950 bg-orange-950/20 px-3 py-2 text-right">
                      <p className="text-[10px] uppercase tracking-wider text-orange-500">
                        Rank
                      </p>
                      <p className="mt-1 font-mono text-xl font-semibold text-orange-300">
                        {numeric(
                          signal.rank_score
                        ).toFixed(1)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      [
                        "Views",
                        compactNumber(signal.views),
                      ],
                      [
                        "Views / Day",
                        compactNumber(
                          signal.views_per_day
                        ),
                      ],
                      [
                        "Velocity / Hr",
                        compactNumber(
                          signal.growth_velocity
                        ),
                      ],
                      [
                        "Age",
                        `${numeric(
                          signal.age_hours
                        ).toFixed(1)}h`,
                      ],
                    ].map(([label, value]) => (
                      <div
                        key={label}
                        className="rounded-lg border border-neutral-800 bg-neutral-900/70 px-3 py-2"
                      >
                        <p className="text-[10px] uppercase tracking-wider text-neutral-600">
                          {label}
                        </p>
                        <p className="mt-1 font-mono text-sm text-neutral-200">
                          {value}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

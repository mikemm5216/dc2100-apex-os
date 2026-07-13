"use client";

import {
  useEffect,
  useState,
} from "react";

import type { FormEvent } from "react";

import {
  fetchCountryNews,
  fetchCountryNewsDetail,
  fetchCountryNewsRun,
  queueCountryNewsRun,
} from "@/lib/api";

import type {
  CountryNewsCategory,
  CountryNewsConflictArchetype,
  CountryNewsDetail,
  CountryNewsRecord,
  CountryNewsResponse,
  CountryNewsRun,
  CountryNewsSort,
  CountryNewsTrafficTier,
  CountryNewsTransformationTier,
  CountryNewsWindowHours,
} from "@/lib/api";

const activeRunStatuses = new Set(["QUEUED", "RUNNING"]);

const categoryOptions: CountryNewsCategory[] = [
  "POLITICS_POLICY",
  "ENERGY",
  "WAR_SECURITY",
  "SANCTIONS_TRADE",
  "RESOURCES",
  "SEMICONDUCTORS_AI",
  "ECONOMY",
  "DISASTER_CLIMATE",
  "INFRASTRUCTURE",
  "INTERNATIONAL_RELATIONS",
  "CULTURE_SOCIETY",
  "OTHER",
];

const trafficTierOptions: CountryNewsTrafficTier[] = [
  "BREAKOUT",
  "ACTIVE",
  "WATCH",
  "LOW_SIGNAL",
];

const transformationTierOptions: CountryNewsTransformationTier[] =
  ["HIGH", "MEDIUM", "LOW"];

const archetypeOptions: CountryNewsConflictArchetype[] = [
  "RESOURCE_SCARCITY",
  "SUPPLY_CHAIN_DISRUPTION",
  "POWER_STRUGGLE",
  "TECHNOLOGY_RACE",
  "SANCTIONS_BLOCKADE",
  "INFRASTRUCTURE_FAILURE",
  "DISASTER_SURVIVAL",
  "ECONOMIC_PRESSURE",
  "BORDER_SECURITY",
  "PROPAGANDA_CULTURE",
];

const trafficTierBadgeStyles: Record<
  CountryNewsTrafficTier,
  string
> = {
  BREAKOUT:
    "border-emerald-900 bg-emerald-950/60 text-emerald-300",
  ACTIVE:
    "border-orange-900 bg-orange-950/60 text-orange-300",
  WATCH:
    "border-sky-900 bg-sky-950/60 text-sky-300",
  LOW_SIGNAL:
    "border-neutral-700 bg-neutral-900 text-neutral-400",
};

const transformationBadgeStyles: Record<
  CountryNewsTransformationTier,
  string
> = {
  HIGH:
    "border-purple-900 bg-purple-950/60 text-purple-300",
  MEDIUM:
    "border-amber-900 bg-amber-950/60 text-amber-300",
  LOW:
    "border-neutral-700 bg-neutral-900 text-neutral-400",
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

function formatAge(ageHours: string | null) {
  const hours = numeric(ageHours);

  if (hours >= 48) {
    return `${Math.round(hours / 24)}d ago`;
  }

  return `${Math.round(hours)}h ago`;
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

export function CountryNewsDashboard() {
  const [response, setResponse] =
    useState<CountryNewsResponse | null>(null);

  const [windowHours, setWindowHours] =
    useState<CountryNewsWindowHours>(72);

  const [countryInput, setCountryInput] = useState("");
  const [countryFilter, setCountryFilter] = useState("");

  const [category, setCategory] =
    useState<CountryNewsCategory | "ALL">("ALL");

  const [trafficTier, setTrafficTier] =
    useState<CountryNewsTrafficTier | "ALL">("ALL");

  const [transformationTier, setTransformationTier] =
    useState<CountryNewsTransformationTier | "ALL">(
      "ALL"
    );

  const [conflictArchetype, setConflictArchetype] =
    useState<CountryNewsConflictArchetype | "ALL">(
      "ALL"
    );

  const [sort, setSort] =
    useState<CountryNewsSort>("traffic_score");

  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");

  const [maxCountries, setMaxCountries] = useState(10);
  const [maxQueries, setMaxQueries] = useState(5);
  const [maxItems, setMaxItems] = useState(20);
  const [maxAgeHours, setMaxAgeHours] =
    useState<CountryNewsWindowHours>(72);

  const [newsRun, setNewsRun] =
    useState<CountryNewsRun | null>(null);

  const [expandedId, setExpandedId] =
    useState<string | null>(null);

  const [detail, setDetail] =
    useState<CountryNewsDetail | null>(null);

  const [isDetailLoading, setIsDetailLoading] =
    useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isQueueing, setIsQueueing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadNews() {
      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchCountryNews(
          {
            window_hours: windowHours,
            country_code: countryFilter,
            category,
            traffic_tier: trafficTier,
            transformation_tier: transformationTier,
            conflict_archetype: conflictArchetype,
            sort,
            q: query,
            limit: 100,
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
            : "Failed to load country news."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadNews();

    return () => controller.abort();
  }, [
    category,
    conflictArchetype,
    countryFilter,
    query,
    reloadKey,
    sort,
    trafficTier,
    transformationTier,
    windowHours,
  ]);

  const runId = newsRun?.id;
  const runStatus = newsRun?.status;

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
        const nextRun = await fetchCountryNewsRun(runId);

        setNewsRun(nextRun);

        if (!activeRunStatuses.has(nextRun.status)) {
          setReloadKey((value) => value + 1);
        }
      } catch (pollError) {
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll country news run."
        );
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [runId, runStatus]);

  useEffect(() => {
    if (!expandedId) {
      // Nothing to fetch. Stale detail is harmless: the
      // panel that reads it is only rendered when
      // expandedId === story.id, which is false here.
      return;
    }

    const controller = new AbortController();

    async function loadDetail() {
      setIsDetailLoading(true);

      try {
        const payload = await fetchCountryNewsDetail(
          expandedId,
          controller.signal
        );

        setDetail(payload);
      } catch (detailError) {
        if (
          detailError instanceof DOMException &&
          detailError.name === "AbortError"
        ) {
          return;
        }

        setError(
          detailError instanceof Error
            ? detailError.message
            : "Failed to load news evidence."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsDetailLoading(false);
        }
      }
    }

    loadDetail();

    return () => controller.abort();
  }, [expandedId]);

  const stories: CountryNewsRecord[] =
    response?.data ?? [];

  const summary = response?.summary ?? {};

  function handleSearch(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setQuery(queryInput.trim());

    const nextCountry = countryInput
      .trim()
      .toUpperCase();

    setCountryFilter(
      /^[A-Z]{2}$/.test(nextCountry) ? nextCountry : ""
    );
  }

  async function handleNewsRun() {
    setIsQueueing(true);
    setError(null);

    try {
      const run = await queueCountryNewsRun({
        max_countries: maxCountries,
        max_queries_per_country: maxQueries,
        max_items_per_query: maxItems,
        max_age_hours: maxAgeHours,
      });

      setNewsRun(run);
    } catch (queueError) {
      setError(
        queueError instanceof Error
          ? queueError.message
          : "Failed to queue country news run."
      );
    } finally {
      setIsQueueing(false);
    }
  }

  const runErrors = newsRun?.summary?.errors ?? [];
  const runIsActive = Boolean(
    newsRun && activeRunStatuses.has(newsRun.status)
  );

  const noActiveCountries =
    newsRun?.status === "FAILED" &&
    (newsRun.error_message ?? "").includes(
      "NO_ACTIVE_VEHICLE_COUNTRIES"
    );

  const partialFailure =
    newsRun?.status === "COMPLETED" &&
    (newsRun.failed_country_count > 0 ||
      runErrors.length > 0);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-sky-950 bg-neutral-950">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-sky-950/70 bg-gradient-to-r from-sky-950/40 to-neutral-950 px-5 py-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-sky-500">
              Country News Traffic Radar
            </p>

            <h2 className="mt-2 text-2xl font-semibold text-white">
              Crisis &amp; Conflict Intelligence
            </h2>

            <p className="mt-1 text-sm text-neutral-400">
              Country-level high-traffic news selected from
              active vehicle countries.
            </p>

            <p className="mt-2 max-w-xl text-xs text-neutral-500">
              News Traffic Score is a coverage-and-recency
              proxy. Publisher article view counts are not
              available.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
                Countries
              </span>

              <select
                value={maxCountries}
                onChange={(event) =>
                  setMaxCountries(Number(event.target.value))
                }
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
              >
                {[1, 3, 5, 10].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
                Queries / Country
              </span>

              <select
                value={maxQueries}
                onChange={(event) =>
                  setMaxQueries(Number(event.target.value))
                }
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
              >
                {[1, 2, 3, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
                Items / Query
              </span>

              <select
                value={maxItems}
                onChange={(event) =>
                  setMaxItems(Number(event.target.value))
                }
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
              >
                {[5, 10, 20, 50].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
                Age Window
              </span>

              <select
                value={maxAgeHours}
                onChange={(event) =>
                  setMaxAgeHours(
                    Number(
                      event.target.value
                    ) as CountryNewsWindowHours
                  )
                }
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
              >
                {[24, 72, 168].map((value) => (
                  <option key={value} value={value}>
                    {value}h
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              disabled={isQueueing || runIsActive}
              onClick={handleNewsRun}
              className="h-10 rounded-lg bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isQueueing
                ? "Queueing..."
                : runIsActive
                  ? `${newsRun?.status} #${newsRun?.id}`
                  : "Run Country News Scan"}
            </button>
          </div>
        </div>

        {newsRun && (
          <div className="grid gap-3 border-b border-neutral-800 bg-neutral-900/40 px-5 py-4 sm:grid-cols-2 lg:grid-cols-8">
            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Run
              </p>
              <p className="mt-1 text-sm text-white">
                #{newsRun.id}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Status
              </p>
              <p className="mt-1 text-sm text-sky-400">
                {newsRun.status}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Countries OK
              </p>
              <p className="mt-1 text-sm text-white">
                {newsRun.completed_country_count}/
                {newsRun.country_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Countries Failed
              </p>
              <p className="mt-1 text-sm text-neutral-300">
                {newsRun.failed_country_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Queries
              </p>
              <p className="mt-1 text-sm text-white">
                {newsRun.succeeded_query_count}/
                {newsRun.query_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Items
              </p>
              <p className="mt-1 text-sm text-white">
                {newsRun.item_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Clusters New
              </p>
              <p className="mt-1 text-sm text-emerald-400">
                {newsRun.cluster_inserted_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Clusters Updated
              </p>
              <p className="mt-1 text-sm text-white">
                {newsRun.cluster_updated_count}
              </p>
            </div>
          </div>
        )}

        {noActiveCountries && (
          <div className="border-b border-amber-950 bg-amber-950/20 px-5 py-3 text-sm text-amber-300">
            No active vehicle countries: run the Vehicle
            Scanner first so recent Shorts can resolve
            countries.
          </div>
        )}

        {newsRun?.status === "FAILED" &&
          !noActiveCountries && (
            <div className="border-b border-red-950 bg-red-950/20 px-5 py-3 text-sm text-red-300">
              Run failed:{" "}
              {newsRun.error_message ??
                "All countries failed. The news provider may be unavailable."}
            </div>
          )}

        {partialFailure && (
          <div className="border-b border-amber-950 bg-amber-950/20 px-5 py-3 text-sm text-amber-300">
            Completed with partial source errors (
            {runErrors.length} recorded).
          </div>
        )}

        <div className="grid gap-px bg-neutral-800 sm:grid-cols-2 lg:grid-cols-5">
          {[
            [
              "Visible Stories",
              summary.total_count ?? 0,
            ],
            ["Breakout", summary.breakout_count ?? 0],
            ["Active", summary.active_count ?? 0],
            ["Watch", summary.watch_count ?? 0],
            [
              "Low Signal",
              summary.low_signal_count ?? 0,
            ],
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

        <div className="grid gap-px border-t border-neutral-800 bg-neutral-800 sm:grid-cols-2 lg:grid-cols-6">
          {[
            [
              "High Potential",
              summary.high_transformation_count ?? 0,
            ],
            [
              "Medium Potential",
              summary.medium_transformation_count ?? 0,
            ],
            [
              "Low Potential",
              summary.low_transformation_count ?? 0,
            ],
            [
              "Active Countries",
              summary.active_country_count ?? 0,
            ],
            [
              "Vehicle Anchors",
              summary.vehicle_anchor_count ?? 0,
            ],
            [
              "Total Vehicle Views",
              compactNumber(summary.vehicle_views_total),
            ],
          ].map(([label, value]) => (
            <div
              key={label}
              className="bg-neutral-950 px-5 py-3"
            >
              <p className="text-[11px] uppercase tracking-wider text-neutral-600">
                {label}
              </p>
              <p className="mt-1 text-lg font-semibold text-neutral-200">
                {value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950">
        <div className="flex flex-wrap gap-2 border-b border-neutral-800 p-4">
          <p className="self-center text-sm font-medium text-neutral-300">
            High-Traffic Country Stories
          </p>

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

        <div className="grid gap-3 border-b border-neutral-800 bg-neutral-900/30 p-4 md:grid-cols-2 xl:grid-cols-4">
          <form
            onSubmit={handleSearch}
            className="flex gap-2 md:col-span-2"
          >
            <input
              value={queryInput}
              onChange={(event) =>
                setQueryInput(event.target.value)
              }
              placeholder="Search headline, publisher, keywords..."
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            />

            <input
              value={countryInput}
              onChange={(event) =>
                setCountryInput(event.target.value)
              }
              placeholder="CC"
              maxLength={2}
              className="w-14 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-center text-sm uppercase text-white"
            />

            <button
              type="submit"
              className="rounded-lg border border-sky-900 px-3 py-2 text-sm text-sky-400"
            >
              Search
            </button>
          </form>

          <select
            value={windowHours}
            onChange={(event) =>
              setWindowHours(
                Number(
                  event.target.value
                ) as CountryNewsWindowHours
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            {[24, 72, 168].map((hours) => (
              <option key={hours} value={hours}>
                Last {hours} hours
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(event) =>
              setSort(
                event.target.value as CountryNewsSort
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="traffic_score">
              Traffic score (proxy)
            </option>
            <option value="recency">Most recent</option>
            <option value="publisher_count">
              Publisher count
            </option>
            <option value="mention_count">
              Mention count
            </option>
            <option value="transformation_potential">
              Transformation potential
            </option>
          </select>

          <select
            value={category}
            onChange={(event) =>
              setCategory(
                event.target.value as
                  | CountryNewsCategory
                  | "ALL"
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="ALL">All categories</option>
            {categoryOptions.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>

          <select
            value={trafficTier}
            onChange={(event) =>
              setTrafficTier(
                event.target.value as
                  | CountryNewsTrafficTier
                  | "ALL"
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="ALL">All traffic tiers</option>
            {trafficTierOptions.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>

          <select
            value={transformationTier}
            onChange={(event) =>
              setTransformationTier(
                event.target.value as
                  | CountryNewsTransformationTier
                  | "ALL"
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="ALL">
              All transformation tiers
            </option>
            {transformationTierOptions.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>

          <select
            value={conflictArchetype}
            onChange={(event) =>
              setConflictArchetype(
                event.target.value as
                  | CountryNewsConflictArchetype
                  | "ALL"
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="ALL">All archetypes</option>
            {archetypeOptions.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
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
            Loading country news intelligence...
          </div>
        ) : stories.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-neutral-300">
              No country news found for these filters.
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              Run a Country News Scan or widen the time
              window. News selection requires recent
              vehicle Shorts with resolved countries.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-800">
            {stories.map((story, index) => (
              <article
                key={story.id}
                className="p-4 transition hover:bg-neutral-900/50"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-neutral-600">
                        {String(index + 1).padStart(2, "0")}
                      </span>

                      <span className="rounded-full border border-neutral-600 bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                        {story.country_code} ·{" "}
                        {story.country_name}
                      </span>

                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          trafficTierBadgeStyles[
                            story.traffic_tier
                          ]
                        }`}
                      >
                        {formatLabel(story.traffic_tier)}
                      </span>

                      <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-neutral-300">
                        {formatLabel(story.category)}
                      </span>

                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          transformationBadgeStyles[
                            story.transformation_tier
                          ]
                        }`}
                      >
                        {story.transformation_tier}{" "}
                        POTENTIAL
                      </span>
                    </div>

                    <h3 className="mt-2 text-base font-semibold leading-snug text-white">
                      {story.title}
                    </h3>

                    <p className="mt-1 text-xs text-neutral-500">
                      {story.representative_source ??
                        story.representative_domain ??
                        "Unknown publisher"}
                      {" · "}
                      {formatAge(story.age_hours)}
                      {" · Country match "}
                      {formatLabel(
                        story.country_match_method
                      )}{" "}
                      (
                      {Math.round(
                        numeric(story.country_confidence) *
                          100
                      )}
                      %)
                    </p>
                  </div>

                  <div className="rounded-lg border border-sky-950 bg-sky-950/20 px-3 py-2 text-right">
                    <p className="text-[10px] uppercase tracking-wider text-sky-500">
                      News Traffic Score
                    </p>
                    <p className="mt-1 font-mono text-3xl font-bold text-sky-300">
                      {Math.round(
                        numeric(story.traffic_score)
                      )}
                      <span className="ml-1 align-middle text-[10px] font-semibold text-sky-500">
                        · PROXY
                      </span>
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  {[
                    [
                      "Publishers",
                      String(story.publisher_count),
                    ],
                    [
                      "Mentions",
                      String(story.mention_count),
                    ],
                    [
                      "Query Coverage",
                      String(story.query_count),
                    ],
                    [
                      "Transform Potential",
                      `${Math.round(
                        numeric(
                          story.transformation_potential
                        )
                      )} / 100`,
                    ],
                    [
                      "Vehicle Anchors",
                      String(story.vehicle_signal_count),
                    ],
                    [
                      "Vehicle Views",
                      compactNumber(
                        story.vehicle_views_total
                      ),
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

                {(story.conflict_archetypes.length > 0 ||
                  story.keywords.length > 0) && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {story.conflict_archetypes.map(
                      (archetype) => (
                        <span
                          key={archetype}
                          className="rounded border border-red-950 bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300"
                        >
                          {formatLabel(archetype)}
                        </span>
                      )
                    )}

                    {story.keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="rounded border border-neutral-800 bg-neutral-900/80 px-1.5 py-0.5 text-[10px] text-neutral-500"
                      >
                        {keyword}
                      </span>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <a
                    href={story.representative_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-sky-900 px-3 py-1.5 text-xs font-medium text-sky-400 hover:text-sky-300"
                  >
                    Open Source ↗
                  </a>

                  <button
                    type="button"
                    onClick={() =>
                      setExpandedId(
                        expandedId === story.id
                          ? null
                          : story.id
                      )
                    }
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
                  >
                    {expandedId === story.id
                      ? "Hide Source Evidence"
                      : "Show Source Evidence"}
                  </button>
                </div>

                {expandedId === story.id && (
                  <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                    {isDetailLoading ? (
                      <p className="text-xs text-neutral-500">
                        Loading source evidence...
                      </p>
                    ) : detail &&
                      detail.id === story.id ? (
                      <div className="space-y-2">
                        {Object.values(
                          detail.mentions.reduce(
                            (byPublisher, item) => {
                              const key =
                                item.publisher_domain ??
                                item.source_name ??
                                item.url;

                              if (!byPublisher[key]) {
                                byPublisher[key] = item;
                              }

                              return byPublisher;
                            },
                            {} as Record<
                              string,
                              (typeof detail.mentions)[number]
                            >
                          )
                        ).map((item) => (
                          <div
                            key={item.id}
                            className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-800/60 pb-2 last:border-b-0 last:pb-0"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-neutral-200">
                                {item.source_name ??
                                  item.publisher_domain ??
                                  "Unknown publisher"}
                              </p>
                              <p className="text-xs text-neutral-400">
                                {item.title}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 text-[10px] text-neutral-500">
                              <span>
                                {item.published_at
                                  ? new Date(
                                      item.published_at
                                    ).toLocaleString()
                                  : "No date"}
                              </span>
                              <span className="rounded border border-neutral-800 px-1 py-0.5">
                                {formatLabel(
                                  item.query_key
                                )}
                              </span>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-sky-500 hover:text-sky-400"
                              >
                                link ↗
                              </a>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-neutral-500">
                        No evidence available.
                      </p>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

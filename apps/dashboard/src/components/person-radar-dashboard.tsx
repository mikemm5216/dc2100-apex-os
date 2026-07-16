"use client";

import {
  useEffect,
  useState,
} from "react";

import type { FormEvent } from "react";

import {
  fetchPersonRadar,
  fetchPersonRadarDetail,
  fetchPersonRadarRun,
  queuePersonRadarRun,
} from "@/lib/api";

import { PersonDualVideoSignals } from "@/components/person-dual-video-signals";

import type {
  PersonAttentionArchetype,
  PersonHistoricalResonanceTier,
  PersonNewsAgeHours,
  PersonRadarDetail,
  PersonRadarResponse,
  PersonRadarRun,
  PersonRadarSort,
  PersonRadarWindowHours,
  PersonRelationType,
  PersonRelationshipScope,
  PersonRoleCategory,
  PersonTrafficRecord,
  PersonTrafficTier,
  PersonTransformationTier,
  PersonVehicleLink,
  PersonVehicleWindowDays,
} from "@/lib/api";

const activeRunStatuses = new Set(["QUEUED", "RUNNING"]);

const roleOptions: PersonRoleCategory[] = [
  "FOUNDER_EXECUTIVE",
  "DRIVER_RACER",
  "ENGINEER_DESIGNER",
  "BUILDER_TUNER",
  "CREATOR_MEDIA",
  "COLLECTOR_OWNER",
  "HISTORICAL_FIGURE",
  "OTHER",
];

const relationOptions: PersonRelationType[] = [
  "FOUNDER",
  "EXECUTIVE",
  "DRIVER",
  "RACING_DRIVER",
  "DESIGNER",
  "ENGINEER",
  "BUILDER",
  "TUNER",
  "CREATOR",
  "OWNER",
  "HISTORICAL",
  "OTHER",
];

const trafficTierOptions: PersonTrafficTier[] = [
  "BREAKOUT",
  "ACTIVE",
  "WATCH",
  "LOW_SIGNAL",
];

const transformationTierOptions: PersonTransformationTier[] =
  ["HIGH", "MEDIUM", "LOW"];

const archetypeOptions: PersonAttentionArchetype[] = [
  "LEADERSHIP_POWER",
  "PERFORMANCE_RIVALRY",
  "TECHNOLOGY_VISION",
  "LEGAL_REGULATORY",
  "ACCIDENT_SAFETY",
  "RECORD_ACHIEVEMENT",
  "OWNERSHIP_LUXURY",
  "CULTURE_FANDOM",
  "CONTROVERSY",
  "OTHER",
];

const trafficTierBadgeStyles: Record<
  PersonTrafficTier,
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
  PersonTransformationTier,
  string
> = {
  HIGH:
    "border-purple-900 bg-purple-950/60 text-purple-300",
  MEDIUM:
    "border-amber-900 bg-amber-950/60 text-amber-300",
  LOW:
    "border-neutral-700 bg-neutral-900 text-neutral-400",
};

const relationshipScopeOptions: Array<{
  value: PersonRelationshipScope;
  label: string;
}> = [
  { value: "ONE_YEAR", label: "1 Year" },
  { value: "TEN_YEARS", label: "10 Years" },
  { value: "ALL_TIME", label: "All Time" },
];

const relationshipScopeLabels: Record<
  PersonRelationshipScope,
  string
> = {
  ONE_YEAR: "1 Year",
  TEN_YEARS: "10 Years",
  ALL_TIME: "All Time",
};

const resonanceTierOptions: PersonHistoricalResonanceTier[] =
  ["ICONIC", "ESTABLISHED", "RECOGNIZABLE", "NICHE"];

const resonanceTierBadgeStyles: Record<
  PersonHistoricalResonanceTier,
  string
> = {
  ICONIC:
    "border-amber-900 bg-amber-950/60 text-amber-300",
  ESTABLISHED:
    "border-teal-900 bg-teal-950/60 text-teal-300",
  RECOGNIZABLE:
    "border-sky-900 bg-sky-950/60 text-sky-300",
  NICHE:
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

function fullNumber(value: string | number | null | undefined) {
  return new Intl.NumberFormat().format(numeric(value));
}

function formatLabel(value: string) {
  return value.replaceAll("_", " ");
}

function formatConfidence(value: string | null) {
  return `${Math.round(numeric(value) * 100)}%`;
}

function formatDateOnly(value: string | null) {
  if (!value) {
    return "Not available";
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime())
    ? "Not available"
    : parsed.toISOString().slice(0, 10);
}

function formatAssociationYears(
  link: PersonVehicleLink
) {
  const start = link.association_start_year;
  const end = link.association_end_year;

  if (start === null && end === null) {
    return "Durable catalog association";
  }

  if (start !== null && end !== null) {
    return `${start}–${end}`;
  }

  return start !== null
    ? `Since ${start}`
    : `Until ${end}`;
}

function resonanceLabelFromLink(
  link: PersonVehicleLink
) {
  const label = link.resonance_evidence?.resonance_label;

  return typeof label === "string" ? label : null;
}

export function PersonRadarDashboard() {
  const [response, setResponse] =
    useState<PersonRadarResponse | null>(null);

  const [windowHours, setWindowHours] =
    useState<PersonRadarWindowHours>(168);

  const [role, setRole] =
    useState<PersonRoleCategory | "ALL">("ALL");

  const [relation, setRelation] =
    useState<PersonRelationType | "ALL">("ALL");

  const [brandInput, setBrandInput] = useState("");
  const [brandFilter, setBrandFilter] = useState("");

  const [modelInput, setModelInput] = useState("");
  const [modelFilter, setModelFilter] = useState("");

  const [countryInput, setCountryInput] = useState("");
  const [countryFilter, setCountryFilter] = useState("");

  const [trafficTier, setTrafficTier] =
    useState<PersonTrafficTier | "ALL">("ALL");

  const [transformationTier, setTransformationTier] =
    useState<PersonTransformationTier | "ALL">("ALL");

  const [attentionArchetype, setAttentionArchetype] =
    useState<PersonAttentionArchetype | "ALL">("ALL");

  const [relationshipScope, setRelationshipScope] =
    useState<PersonRelationshipScope>("ALL_TIME");

  const [resonanceTier, setResonanceTier] =
    useState<PersonHistoricalResonanceTier | "ALL">(
      "ALL"
    );

  const [sort, setSort] =
    useState<PersonRadarSort>("traffic_score");

  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");

  const [maxPeople, setMaxPeople] = useState(20);
  const [vehicleWindowDays, setVehicleWindowDays] =
    useState<PersonVehicleWindowDays>(14);
  const [maxQueries, setMaxQueries] = useState(3);
  const [maxItems, setMaxItems] = useState(20);
  const [maxAgeHours, setMaxAgeHours] =
    useState<PersonNewsAgeHours>(72);

  const [personRun, setPersonRun] =
    useState<PersonRadarRun | null>(null);

  const [expandedId, setExpandedId] =
    useState<string | null>(null);

  const [expandedPanel, setExpandedPanel] =
    useState<"vehicle" | "news">("vehicle");

  const [detail, setDetail] =
    useState<PersonRadarDetail | null>(null);

  const [isDetailLoading, setIsDetailLoading] =
    useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [isQueueing, setIsQueueing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPeople() {
      setIsLoading(true);
      setError(null);

      try {
        const payload = await fetchPersonRadar(
          {
            window_hours: windowHours,
            role_category: role,
            relation_type: relation,
            vehicle_brand: brandFilter,
            vehicle_model: modelFilter,
            country_code: countryFilter,
            traffic_tier: trafficTier,
            transformation_tier: transformationTier,
            attention_archetype: attentionArchetype,
            relationship_scope: relationshipScope,
            historical_resonance_tier: resonanceTier,
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
            : "Failed to load person radar."
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    loadPeople();

    return () => controller.abort();
  }, [
    attentionArchetype,
    brandFilter,
    countryFilter,
    modelFilter,
    query,
    relation,
    relationshipScope,
    reloadKey,
    resonanceTier,
    role,
    sort,
    trafficTier,
    transformationTier,
    windowHours,
  ]);

  const runId = personRun?.id;
  const runStatus = personRun?.status;

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
        const nextRun = await fetchPersonRadarRun(runId);

        setPersonRun(nextRun);

        if (!activeRunStatuses.has(nextRun.status)) {
          setReloadKey((value) => value + 1);
        }
      } catch (pollError) {
        setError(
          pollError instanceof Error
            ? pollError.message
            : "Failed to poll person radar run."
        );
      }
    }, 2000);

    return () => window.clearInterval(timer);
  }, [runId, runStatus]);

  useEffect(() => {
    if (!expandedId) {
      // Nothing to fetch. Stale detail is harmless: the
      // panel that reads it is only rendered when
      // expandedId === person.id, which is false here.
      return;
    }

    const detailId = expandedId;
    const controller = new AbortController();

    async function loadDetail() {
      setIsDetailLoading(true);

      try {
        const payload = await fetchPersonRadarDetail(
          detailId,
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
            : "Failed to load person evidence."
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

  const people: PersonTrafficRecord[] =
    response?.data ?? [];

  const summary = response?.summary ?? {};

  function handleSearch(
    event: FormEvent<HTMLFormElement>
  ) {
    event.preventDefault();
    setQuery(queryInput.trim());
    setBrandFilter(brandInput.trim());
    setModelFilter(modelInput.trim());

    const nextCountry = countryInput
      .trim()
      .toUpperCase();

    setCountryFilter(
      /^[A-Z]{2}$/.test(nextCountry) ? nextCountry : ""
    );
  }

  async function handlePersonRun() {
    setIsQueueing(true);
    setError(null);

    try {
      const run = await queuePersonRadarRun({
        max_people: maxPeople,
        vehicle_window_days: vehicleWindowDays,
        max_queries_per_person: maxQueries,
        max_items_per_query: maxItems,
        max_age_hours: maxAgeHours,
      });

      setPersonRun(run);
    } catch (queueError) {
      setError(
        queueError instanceof Error
          ? queueError.message
          : "Failed to queue person radar run."
      );
    } finally {
      setIsQueueing(false);
    }
  }

  const runErrors = personRun?.summary?.errors ?? [];
  const runIsActive = Boolean(
    personRun && activeRunStatuses.has(personRun.status)
  );

  const noActivePeople =
    personRun?.status === "FAILED" &&
    (personRun.error_message ?? "").includes(
      "NO_ACTIVE_VEHICLE_LINKED_PEOPLE"
    );

  const partialFailure =
    personRun?.status === "COMPLETED" &&
    (personRun.failed_person_count > 0 ||
      runErrors.length > 0);

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-xl border border-violet-950 bg-neutral-950">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-violet-950/70 bg-gradient-to-r from-violet-950/40 to-neutral-950 px-5 py-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.25em] text-violet-500">
              Vehicle-Linked Person Traffic Radar
            </p>

            <h2 className="mt-2 text-2xl font-semibold text-white">
              People Radar
            </h2>

            <p className="mt-1 text-sm text-neutral-400">
              Public automotive figures ranked by vehicle
              attention and news coverage.
            </p>

            <p className="mt-2 max-w-xl text-xs text-neutral-500">
              Person Traffic Score combines actual
              vehicle-short views with a news coverage
              proxy. It is not a single-platform view
              count.
            </p>

            <p className="mt-2 max-w-xl text-xs text-amber-600/80">
              Historical Resonance is based on curated
              vehicle-person relationship knowledge. It
              is not historical traffic or a 10-year
              view count.
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1">
              <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
                People
              </span>

              <select
                value={maxPeople}
                onChange={(event) =>
                  setMaxPeople(Number(event.target.value))
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

            <label className="space-y-1">
              <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
                Vehicle Window
              </span>

              <select
                value={vehicleWindowDays}
                onChange={(event) =>
                  setVehicleWindowDays(
                    Number(
                      event.target.value
                    ) as PersonVehicleWindowDays
                  )
                }
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
              >
                {[3, 7, 14, 30].map((value) => (
                  <option key={value} value={value}>
                    {value}d
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-1">
              <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
                Queries / Person
              </span>

              <select
                value={maxQueries}
                onChange={(event) =>
                  setMaxQueries(Number(event.target.value))
                }
                className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
              >
                {[1, 2, 3, 4].map((value) => (
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
                News Age
              </span>

              <select
                value={maxAgeHours}
                onChange={(event) =>
                  setMaxAgeHours(
                    Number(
                      event.target.value
                    ) as PersonNewsAgeHours
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
              onClick={handlePersonRun}
              className="h-10 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isQueueing
                ? "Queueing..."
                : runIsActive
                  ? `${personRun?.status} #${personRun?.id}`
                  : "Run Person Radar"}
            </button>
          </div>
        </div>

        {personRun && (
          <div className="grid gap-3 border-b border-neutral-800 bg-neutral-900/40 px-5 py-4 sm:grid-cols-2 lg:grid-cols-8">
            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Run
              </p>
              <p className="mt-1 text-sm text-white">
                #{personRun.id}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Status
              </p>
              <p className="mt-1 text-sm text-violet-400">
                {personRun.status}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                People OK
              </p>
              <p className="mt-1 text-sm text-white">
                {personRun.completed_person_count}/
                {personRun.person_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                People Failed
              </p>
              <p className="mt-1 text-sm text-neutral-300">
                {personRun.failed_person_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Queries
              </p>
              <p className="mt-1 text-sm text-white">
                {personRun.succeeded_query_count}/
                {personRun.query_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Items
              </p>
              <p className="mt-1 text-sm text-white">
                {personRun.item_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Signals New
              </p>
              <p className="mt-1 text-sm text-emerald-400">
                {personRun.signal_inserted_count}
              </p>
            </div>

            <div>
              <p className="text-[11px] uppercase text-neutral-500">
                Signals Updated
              </p>
              <p className="mt-1 text-sm text-white">
                {personRun.signal_updated_count}
              </p>
            </div>
          </div>
        )}

        {noActivePeople && (
          <div className="border-b border-amber-950 bg-amber-950/20 px-5 py-3 text-sm text-amber-300">
            No active vehicle-linked people: run the
            Vehicle Scanner first so recent Shorts can
            resolve brands and models that catalog people
            are linked to.
          </div>
        )}

        {personRun?.status === "FAILED" &&
          !noActivePeople && (
            <div className="border-b border-red-950 bg-red-950/20 px-5 py-3 text-sm text-red-300">
              Run failed:{" "}
              {personRun.error_message ??
                "All people failed. The news provider may be unavailable."}
            </div>
          )}

        {partialFailure && (
          <div className="border-b border-amber-950 bg-amber-950/20 px-5 py-3 text-sm text-amber-300">
            Completed with partial person errors (
            {runErrors.length} recorded).
          </div>
        )}

        <div className="grid gap-px bg-neutral-800 sm:grid-cols-2 lg:grid-cols-5">
          {[
            [
              "Visible People",
              summary.visible_people ?? 0,
            ],
            ["Breakout", summary.breakout ?? 0],
            ["Active", summary.active ?? 0],
            ["Watch", summary.watch ?? 0],
            ["Low Signal", summary.low_signal ?? 0],
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

        <div className="grid gap-px border-t border-neutral-800 bg-neutral-800 sm:grid-cols-2 lg:grid-cols-7">
          {[
            [
              "High Potential",
              summary.high_potential ?? 0,
            ],
            [
              "Medium Potential",
              summary.medium_potential ?? 0,
            ],
            [
              "Low Potential",
              summary.low_potential ?? 0,
            ],
            [
              "Vehicle Views",
              compactNumber(summary.total_vehicle_views),
            ],
            [
              "Vehicle Signals",
              summary.total_vehicle_signals ?? 0,
            ],
            [
              "Direct Mention People",
              summary.direct_mention_people ?? 0,
            ],
            [
              "Active Brands",
              summary.active_brands ?? 0,
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

        <div className="border-t border-neutral-800 bg-neutral-950 px-5 pt-3">
          <p className="text-[11px] uppercase tracking-wider text-amber-600">
            Historical Resonance ·{" "}
            {relationshipScopeLabels[relationshipScope]}{" "}
            relationship scope
          </p>
        </div>

        <div className="grid gap-px bg-neutral-800 sm:grid-cols-2 lg:grid-cols-5">
          {[
            ["Iconic", summary.iconic ?? 0],
            ["Established", summary.established ?? 0],
            [
              "Recognizable",
              summary.recognizable ?? 0,
            ],
            ["Niche", summary.niche ?? 0],
            ["Unscored", summary.unscored ?? 0],
          ].map(([label, value]) => (
            <div
              key={label}
              className="bg-neutral-950 px-5 py-3"
            >
              <p className="text-[11px] uppercase tracking-wider text-neutral-600">
                {label}
              </p>
              <p className="mt-1 text-lg font-semibold text-amber-200">
                {value}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-neutral-800 bg-neutral-950">
        <div className="flex flex-wrap gap-2 border-b border-neutral-800 p-4">
          <p className="self-center text-sm font-medium text-neutral-300">
            Vehicle-Linked Public People
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
            className="flex gap-2 md:col-span-2 xl:col-span-4"
          >
            <input
              value={queryInput}
              onChange={(event) =>
                setQueryInput(event.target.value)
              }
              placeholder="Search person, brand, model, headline, publisher..."
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            />

            <input
              value={brandInput}
              onChange={(event) =>
                setBrandInput(event.target.value)
              }
              placeholder="Brand"
              className="w-28 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm text-white"
            />

            <input
              value={modelInput}
              onChange={(event) =>
                setModelInput(event.target.value)
              }
              placeholder="Model"
              className="w-28 rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-2 text-sm text-white"
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
              className="rounded-lg border border-violet-900 px-3 py-2 text-sm text-violet-400"
            >
              Search
            </button>
          </form>

          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-neutral-500">
              Current Traffic Window
            </span>

            <select
              value={windowHours}
              onChange={(event) =>
                setWindowHours(
                  Number(
                    event.target.value
                  ) as PersonRadarWindowHours
                )
              }
              className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
            >
              {[24, 72, 168, 720].map((hours) => (
                <option key={hours} value={hours}>
                  Last {hours} hours
                </option>
              ))}
            </select>

            <span className="block text-[10px] text-neutral-600">
              Recent news + traffic display
            </span>
          </label>

          <label className="space-y-1">
            <span className="block text-[11px] uppercase tracking-wider text-amber-600">
              Relationship Scope
            </span>

            <select
              value={relationshipScope}
              onChange={(event) =>
                setRelationshipScope(
                  event.target
                    .value as PersonRelationshipScope
                )
              }
              className="w-full rounded-lg border border-amber-950 bg-neutral-900 px-3 py-2 text-sm text-white"
            >
              {relationshipScopeOptions.map(
                (option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                )
              )}
            </select>

            <span className="block text-[10px] text-neutral-600">
              Catalog-based relationship evidence
            </span>
          </label>

          <select
            value={resonanceTier}
            onChange={(event) =>
              setResonanceTier(
                event.target.value as
                  | PersonHistoricalResonanceTier
                  | "ALL"
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="ALL">
              All resonance tiers
            </option>
            {resonanceTierOptions.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>

          <select
            value={sort}
            onChange={(event) =>
              setSort(
                event.target.value as PersonRadarSort
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="traffic_score">
              Traffic score (composite)
            </option>
            <option value="vehicle_views">
              Actual vehicle views
            </option>
            <option value="news_coverage">
              News coverage (proxy)
            </option>
            <option value="recency">Most recent</option>
            <option value="publisher_count">
              Publisher count
            </option>
            <option value="transformation_potential">
              Transformation potential
            </option>
            <option value="historical_resonance">
              Historical resonance
            </option>
          </select>

          <select
            value={role}
            onChange={(event) =>
              setRole(
                event.target.value as
                  | PersonRoleCategory
                  | "ALL"
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="ALL">All roles</option>
            {roleOptions.map((value) => (
              <option key={value} value={value}>
                {formatLabel(value)}
              </option>
            ))}
          </select>

          <select
            value={relation}
            onChange={(event) =>
              setRelation(
                event.target.value as
                  | PersonRelationType
                  | "ALL"
              )
            }
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white"
          >
            <option value="ALL">All relations</option>
            {relationOptions.map((value) => (
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
                  | PersonTrafficTier
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
                  | PersonTransformationTier
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
            value={attentionArchetype}
            onChange={(event) =>
              setAttentionArchetype(
                event.target.value as
                  | PersonAttentionArchetype
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
            Loading person traffic intelligence...
          </div>
        ) : people.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-medium text-neutral-300">
              No person traffic data for these filters.
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              Run the Person Radar or widen the time
              window. Person selection requires recent
              vehicle Shorts linked to catalog public
              people.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-neutral-800">
            {people.map((person, index) => (
              <article
                key={person.id}
                className="p-4 transition hover:bg-neutral-900/50"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-neutral-600">
                        {String(index + 1).padStart(2, "0")}
                      </span>

                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          trafficTierBadgeStyles[
                            person.traffic_tier
                          ]
                        }`}
                      >
                        {formatLabel(person.traffic_tier)}
                      </span>

                      <span className="rounded-full border border-neutral-700 bg-neutral-900 px-2 py-0.5 text-[10px] font-medium text-neutral-300">
                        {formatLabel(person.role_category)}
                      </span>

                      {person.person_country_code && (
                        <span className="rounded-full border border-neutral-600 bg-neutral-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                          {person.person_country_code}
                        </span>
                      )}

                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          transformationBadgeStyles[
                            person.transformation_tier
                          ]
                        }`}
                      >
                        {person.transformation_tier}{" "}
                        POTENTIAL
                      </span>
                    </div>

                    <h3 className="mt-2 text-lg font-semibold leading-snug text-white">
                      {person.canonical_name}
                    </h3>

                    <p className="mt-1 text-xs text-neutral-500">
                      {person.linked_brands.join(" · ") ||
                        "No linked brands"}
                      {person.linked_models.length > 0 &&
                        ` · ${person.linked_models.join(
                          " · "
                        )}`}
                      {" · "}
                      {person.relation_types
                        .map(formatLabel)
                        .join(", ")}
                      {" · Link "}
                      {formatConfidence(
                        person.link_confidence
                      )}
                    </p>

                    <p className="mt-2 font-mono text-2xl font-bold text-emerald-300">
                      {fullNumber(
                        person.vehicle_views_total
                      )}
                      <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wider text-emerald-600">
                        actual vehicle views
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <div className="rounded-lg border border-violet-950 bg-violet-950/20 px-3 py-2 text-right">
                      <p className="text-[10px] uppercase tracking-wider text-violet-500">
                        Person Traffic Score
                      </p>
                      <p className="mt-1 font-mono text-3xl font-bold text-violet-300">
                        {Math.round(
                          numeric(person.traffic_score)
                        )}
                        <span className="ml-1 align-middle text-[10px] font-semibold text-violet-500">
                          · COMPOSITE
                        </span>
                      </p>
                    </div>

                    <div className="rounded-lg border border-sky-950 bg-sky-950/20 px-3 py-2 text-right">
                      <p className="text-[10px] uppercase tracking-wider text-sky-500">
                        News Coverage
                      </p>
                      <p className="mt-1 font-mono text-3xl font-bold text-sky-300">
                        {Math.round(
                          numeric(
                            person.news_coverage_score
                          )
                        )}
                        <span className="ml-1 align-middle text-[10px] font-semibold text-sky-500">
                          · PROXY
                        </span>
                      </p>
                    </div>

                    <div className="rounded-lg border border-amber-950 bg-amber-950/20 px-3 py-2 text-right">
                      <p className="text-[10px] uppercase tracking-wider text-amber-600">
                        Historical Resonance
                      </p>
                      {person.historical_resonance_score !==
                      null ? (
                        <>
                          <p className="mt-1 font-mono text-2xl font-bold text-amber-300">
                            {Math.round(
                              numeric(
                                person.historical_resonance_score
                              )
                            )}
                            <span className="ml-1 align-middle text-[10px] font-semibold text-amber-500">
                              ·{" "}
                              {person.historical_resonance_tier ??
                                "SCORED"}
                            </span>
                          </p>
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                            {
                              relationshipScopeLabels[
                                person
                                  .relationship_scope
                              ]
                            }
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="mt-1 font-mono text-2xl font-bold text-neutral-600">
                            —
                          </p>
                          <p className="text-[10px] uppercase tracking-wider text-neutral-600">
                            No evidence in scope
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
                  {[
                    [
                      "Vehicle Signals",
                      String(person.vehicle_signal_count),
                    ],
                    [
                      "Qualified Signals",
                      String(
                        person.qualified_vehicle_signal_count
                      ),
                    ],
                    [
                      "Direct Mentions",
                      String(
                        person.direct_vehicle_mention_count
                      ),
                    ],
                    [
                      "Vehicle Attention",
                      `${Math.round(
                        numeric(
                          person.vehicle_attention_score
                        )
                      )} / 100`,
                    ],
                    [
                      "News Mentions",
                      String(person.news_mention_count),
                    ],
                    [
                      "Publishers",
                      String(person.publisher_count),
                    ],
                    [
                      "Query Coverage",
                      String(person.query_count),
                    ],
                    [
                      "Transform Potential",
                      `${Math.round(
                        numeric(
                          person.transformation_potential
                        )
                      )} / 100`,
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

                {person.attention_archetypes.length >
                  0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {person.attention_archetypes.map(
                      (archetype) => (
                        <span
                          key={archetype}
                          className="rounded border border-red-950 bg-red-950/40 px-1.5 py-0.5 text-[10px] text-red-300"
                        >
                          {formatLabel(archetype)}
                        </span>
                      )
                    )}
                  </div>
                )}

                {person.representative_headline ? (
                  <p className="mt-3 text-sm text-neutral-300">
                    <span className="text-neutral-500">
                      {person.representative_source ??
                        person.representative_domain ??
                        "Unknown publisher"}
                      {": "}
                    </span>
                    {person.representative_headline}
                  </p>
                ) : (
                  <p className="mt-3 text-xs text-neutral-600">
                    No recent verified news mention —
                    ranking is driven by actual vehicle
                    attention.
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {person.representative_url && (
                    <a
                      href={person.representative_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-sky-900 px-3 py-1.5 text-xs font-medium text-sky-400 hover:text-sky-300"
                    >
                      Open Source ↗
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setExpandedPanel("vehicle");
                      setExpandedId(
                        expandedId === person.id &&
                          expandedPanel === "vehicle"
                          ? null
                          : person.id
                      );
                    }}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
                  >
                    {expandedId === person.id &&
                    expandedPanel === "vehicle"
                      ? "Hide Vehicle Links"
                      : "Show Vehicle Links"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setExpandedPanel("news");
                      setExpandedId(
                        expandedId === person.id &&
                          expandedPanel === "news"
                          ? null
                          : person.id
                      );
                    }}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs text-neutral-300"
                  >
                    {expandedId === person.id &&
                    expandedPanel === "news"
                      ? "Hide News Evidence"
                      : "Show News Evidence"}
                  </button>
                </div>

                <p className="mt-3 text-[10px] text-neutral-600">
                  Traffic observed since:{" "}
                  {formatDateOnly(
                    person.traffic_observed_since
                  )}
                  {" · Historical traffic claimed: No"}
                </p>

                {expandedId === person.id && (
                  <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                    {isDetailLoading ? (
                      <p className="text-xs text-neutral-500">
                        Loading evidence...
                      </p>
                    ) : detail &&
                      detail.id === person.id ? (
                      expandedPanel === "vehicle" ? (
                        detail.vehicle_links.length ===
                        0 ? (
                          <p className="text-xs text-neutral-500">
                            No vehicle links recorded.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {detail.vehicle_links.map(
                              (link) => (
                                <div
                                  key={link.id}
                                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-neutral-800/60 pb-2 last:border-b-0 last:pb-0"
                                >
                                  <div className="min-w-0">
                                    <p className="text-xs font-medium text-neutral-200">
                                      {[
                                        link.vehicle_brand,
                                        link.vehicle_series,
                                        link.vehicle_model,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ") ||
                                        "Unspecified vehicle"}
                                    </p>
                                    <p className="text-xs text-neutral-400">
                                      {formatLabel(
                                        link.relation_type
                                      )}
                                      {" · "}
                                      {formatLabel(
                                        link.link_method
                                      )}
                                      {" · "}
                                      {formatConfidence(
                                        link.link_confidence
                                      )}
                                      {link.locked &&
                                        " · LOCKED"}
                                    </p>
                                  </div>

                                  <p className="text-[10px] text-neutral-600">
                                    {typeof link
                                      .link_evidence
                                      ?.field ===
                                    "string"
                                      ? `evidence: ${String(
                                          link
                                            .link_evidence
                                            .field
                                        )}`
                                      : typeof link
                                            .link_evidence
                                            ?.association_level ===
                                          "string"
                                        ? `evidence: ${String(
                                            link
                                              .link_evidence
                                              .association_level
                                          )} association`
                                        : "evidence: catalog"}
                                  </p>

                                  <div className="w-full rounded border border-amber-950/60 bg-amber-950/10 px-2 py-1.5">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-600">
                                        Historical
                                        Resonance
                                      </span>

                                      {link.historical_resonance_score !==
                                        null &&
                                      link.historical_resonance_tier ? (
                                        <span
                                          className={`rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${
                                            resonanceTierBadgeStyles[
                                              link
                                                .historical_resonance_tier
                                            ]
                                          }`}
                                        >
                                          {Math.round(
                                            numeric(
                                              link.historical_resonance_score
                                            )
                                          )}{" "}
                                          ·{" "}
                                          {
                                            link.historical_resonance_tier
                                          }
                                        </span>
                                      ) : (
                                        <span className="text-[10px] text-neutral-500">
                                          Not scored yet
                                        </span>
                                      )}

                                      {link.evidence_horizon && (
                                        <span className="rounded border border-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400">
                                          Horizon:{" "}
                                          {
                                            relationshipScopeLabels[
                                              link
                                                .evidence_horizon
                                            ]
                                          }
                                        </span>
                                      )}

                                      {link.iconic_association && (
                                        <span className="rounded border border-amber-900 px-1 py-0.5 text-[10px] text-amber-400">
                                          ICONIC
                                          ASSOCIATION
                                        </span>
                                      )}

                                      {link.legacy_association && (
                                        <span className="rounded border border-purple-900 px-1 py-0.5 text-[10px] text-purple-400">
                                          LEGACY
                                        </span>
                                      )}

                                      {link.recognition_weight !==
                                        null && (
                                        <span className="rounded border border-neutral-800 px-1 py-0.5 text-[10px] text-neutral-400">
                                          Recognition{" "}
                                          {formatConfidence(
                                            link.recognition_weight
                                          )}
                                        </span>
                                      )}

                                      <span className="rounded border border-neutral-800 px-1 py-0.5 text-[10px] text-neutral-500">
                                        {formatAssociationYears(
                                          link
                                        )}
                                      </span>

                                      {link.resonance_locked && (
                                        <span className="rounded border border-red-900 px-1 py-0.5 text-[10px] text-red-400">
                                          RESONANCE
                                          LOCKED
                                        </span>
                                      )}
                                    </div>

                                    {resonanceLabelFromLink(
                                      link
                                    ) && (
                                      <p className="mt-1 text-[11px] text-neutral-400">
                                        {resonanceLabelFromLink(
                                          link
                                        )}
                                      </p>
                                    )}

                                    {link.resonance_version && (
                                      <p className="mt-1 text-[10px] text-neutral-600">
                                        Resolver:{" "}
                                        {
                                          link.resonance_version
                                        }
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        )
                      ) : detail.mentions.length === 0 ? (
                        <p className="text-xs text-neutral-500">
                          No recent news mentions. The
                          person signal remains valid on
                          vehicle attention alone.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {detail.mentions.map((item) => (
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
                                <span className="rounded border border-neutral-800 px-1 py-0.5">
                                  {formatLabel(
                                    item.person_match_method
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
                      )
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

        <div className="border-t border-neutral-800 px-5 py-3 text-[11px] text-neutral-600">
          Person Traffic Score combines actual
          vehicle-short views with a news coverage proxy.
          It is not a single-platform view count.
          Historical Resonance is catalog-based
          relationship knowledge — it is not historical
          traffic or a 10-year view count.
        </div>
      </section>

      <PersonDualVideoSignals />
    </div>
  );
}

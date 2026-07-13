"use client";

import { useEffect, useMemo, useState } from "react";

import {
  fetchFusionCandidateDetail,
  fetchFusionCandidates,
  queueFusionRun,
} from "@/lib/api";

import type {
  FusionCandidate,
  FusionCandidateDetail,
  FusionCandidateSort,
  FusionMissingSignal,
  FusionPersonLinkTier,
} from "@/lib/api";

const tierStyles: Record<string, string> = {
  EXACT_VEHICLE: "border-emerald-900 bg-emerald-950 text-emerald-300",
  SAME_SERIES: "border-blue-900 bg-blue-950 text-blue-300",
  SAME_BRAND: "border-amber-900 bg-amber-950 text-amber-300",
};

function formatNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.NumberFormat(undefined).format(parsed);
}

function formatScore(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "—";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "—";
  return parsed.toFixed(1);
}

function PersonLinkTierBadge({ tier }: { tier: FusionPersonLinkTier | null }) {
  if (!tier) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-full border border-neutral-700 bg-neutral-900 px-2.5 py-1 text-xs font-medium text-neutral-400">
        NO PERSON
      </span>
    );
  }
  const style = tierStyles[tier] ?? "border-neutral-700 bg-neutral-900 text-neutral-300";
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${style}`}>
      {tier.replaceAll("_", " ")}
    </span>
  );
}

function MissingSignalsBadges({ signals }: { signals: FusionMissingSignal[] }) {
  if (!signals || signals.length === 0) {
    return <span className="text-xs text-emerald-400">Complete</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {signals.map((signal) => (
        <span
          key={signal}
          className="inline-flex whitespace-nowrap rounded-full border border-orange-900 bg-orange-950/50 px-2 py-0.5 text-[10px] font-medium text-orange-300"
        >
          {signal.replaceAll("_", " ")}
        </span>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-3 p-6">
      <p className="text-sm text-neutral-400">Loading fusion candidates...</p>
      {[1, 2, 3, 4, 5].map((item) => (
        <div key={item} className="h-12 animate-pulse rounded-lg bg-neutral-800/70" />
      ))}
    </div>
  );
}

function EvidenceSection({
  title,
  data,
}: {
  title: string;
  data: Record<string, unknown> | null | undefined;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-neutral-500">{title}</p>
      {!data ? (
        <p className="mt-2 text-xs text-neutral-600">No evidence.</p>
      ) : (
        <dl className="mt-2 space-y-1">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3 text-xs">
              <dt className="text-neutral-500">{key.replaceAll("_", " ")}</dt>
              <dd className="text-right text-neutral-300">
                {Array.isArray(value)
                  ? value.join(", ") || "—"
                  : value === null || value === undefined
                    ? "—"
                    : String(value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export function FusionCandidatesTable() {
  const [candidates, setCandidates] = useState<FusionCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isQueuingRun, setIsQueuingRun] = useState(false);

  const [tierFilter, setTierFilter] = useState<
    FusionPersonLinkTier | "ALL" | "NO_PERSON_SIGNAL"
  >("ALL");
  const [completeFilter, setCompleteFilter] = useState<"ALL" | "TRUE" | "FALSE">("ALL");
  const [sort, setSort] = useState<FusionCandidateSort>("fusion_score");
  const [searchText, setSearchText] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FusionCandidateDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  function reload() {
    setReloadKey((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetchFusionCandidates(
          {
            person_link_tier: tierFilter,
            is_complete: completeFilter,
            sort,
            q: searchText,
            limit: 100,
          },
          controller.signal
        );
        setCandidates(response.data);
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load fusion candidates.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [reloadKey, tierFilter, completeFilter, sort, searchText]);

  async function handleRunFusion() {
    setIsQueuingRun(true);
    setRunError(null);
    setRunMessage(null);
    try {
      const run = await queueFusionRun({});
      setRunMessage(`Fusion run ${run.id} queued (${run.status}).`);
      reload();
    } catch (queueError) {
      setRunError(queueError instanceof Error ? queueError.message : "Failed to queue fusion run.");
    } finally {
      setIsQueuingRun(false);
    }
  }

  async function handleExpand(candidate: FusionCandidate) {
    if (expandedId === candidate.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(candidate.id);
    setDetail(null);
    setDetailError(null);
    try {
      const loaded = await fetchFusionCandidateDetail(candidate.id);
      setDetail(loaded);
    } catch (detailLoadError) {
      setDetailError(
        detailLoadError instanceof Error ? detailLoadError.message : "Failed to load evidence."
      );
    }
  }

  const rankedCandidates = useMemo(
    () => candidates.map((candidate, index) => ({ candidate, rank: index + 1 })),
    [candidates]
  );

  if (isLoading) return <LoadingState />;

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-950 bg-red-950/30 p-5">
          <p className="text-sm font-medium text-red-300">Failed to load fusion candidates</p>
          <p className="mt-2 text-sm text-red-400/80">{error}</p>
          <button type="button" onClick={reload} className="mt-4 rounded-lg border border-red-900 px-3 py-2 text-sm text-red-300">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 px-6 py-4">
        <div>
          <p className="text-sm font-medium text-neutral-200">Vehicle-Centered Fusion Candidates</p>
          <p className="mt-1 text-xs text-neutral-500">
            Latest completed fusion run · {candidates.length} candidates
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleRunFusion}
            disabled={isQueuingRun}
            className="rounded-lg bg-white px-3 py-2 text-xs font-medium text-black transition hover:bg-neutral-200 disabled:opacity-50"
          >
            {isQueuingRun ? "Queuing..." : "Run Fusion"}
          </button>
          <button
            type="button"
            onClick={reload}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-white"
          >
            Refresh
          </button>
        </div>
      </div>

      {runMessage && <div className="border-b border-emerald-950 bg-emerald-950/20 px-6 py-3 text-sm text-emerald-300">{runMessage}</div>}
      {runError && <div className="border-b border-red-950 bg-red-950/20 px-6 py-3 text-sm text-red-300">{runError}</div>}

      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-900/30 px-6 py-3">
        <input
          placeholder="Search vehicle..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-white"
        />
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value as typeof tierFilter)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-white"
        >
          <option value="ALL">All Person Link Tiers</option>
          <option value="EXACT_VEHICLE">Exact Vehicle</option>
          <option value="SAME_SERIES">Same Series</option>
          <option value="SAME_BRAND">Same Brand</option>
          <option value="NO_PERSON_SIGNAL">No Person Signal</option>
        </select>
        <select
          value={completeFilter}
          onChange={(e) => setCompleteFilter(e.target.value as typeof completeFilter)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-white"
        >
          <option value="ALL">All Completeness</option>
          <option value="TRUE">Complete Only</option>
          <option value="FALSE">Incomplete Only</option>
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as FusionCandidateSort)}
          className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs text-white"
        >
          <option value="fusion_score">Sort: Fusion Score</option>
          <option value="vehicle_views">Sort: Vehicle Views</option>
          <option value="transformation_potential">Sort: Transformation Potential</option>
          <option value="recency">Sort: Recency</option>
        </select>
      </div>

      {candidates.length === 0 ? (
        <div className="p-10 text-center">
          <p className="text-sm font-medium text-neutral-300">No fusion candidates found.</p>
          <p className="mt-2 text-xs text-neutral-500">Run Fusion to generate candidates from current vehicle, news, and person evidence.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[2200px] border-collapse text-left">
            <thead>
              <tr className="border-b border-neutral-800 bg-neutral-950/70">
                {[
                  "Rank",
                  "Fusion Score",
                  "Vehicle",
                  "Country",
                  "Actual Vehicle Views",
                  "Viral Tier",
                  "Country News Category",
                  "News Traffic Proxy",
                  "Linked Person",
                  "Person Link Tier / Confidence",
                  "Current Person Traffic",
                  "Historical Resonance",
                  "Relationship Scope",
                  "Transformation Potential",
                  "Missing Signals",
                  "",
                ].map((label) => (
                  <th key={label} className="px-5 py-3 text-xs font-medium uppercase tracking-wider text-neutral-500">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rankedCandidates.map(({ candidate, rank }) => (
                <>
                  <tr
                    key={candidate.id}
                    className={`border-b border-neutral-900 transition hover:bg-neutral-900/60 ${expandedId === candidate.id ? "bg-blue-900/10" : ""}`}
                  >
                    <td className="px-5 py-4 align-top text-sm text-neutral-400">#{rank}</td>
                    <td className="px-5 py-4 align-top">
                      <p className="text-lg font-semibold text-white">{formatScore(candidate.fusion_score)}</p>
                    </td>
                    <td className="px-5 py-4 align-top">
                      <p className="text-sm font-medium text-white">{candidate.vehicle_code}</p>
                      <p className="mt-1 max-w-48 text-xs text-neutral-500">{candidate.vehicle_name}</p>
                    </td>
                    <td className="px-5 py-4 align-top text-sm text-neutral-300">{candidate.country_code ?? "—"}</td>
                    <td className="px-5 py-4 align-top">
                      <p className="text-sm text-neutral-200">{formatNumber(candidate.vehicle_views_total)}</p>
                      <p className="mt-1 text-xs text-neutral-500">{candidate.qualified_vehicle_signal_count} qualified signals</p>
                    </td>
                    <td className="px-5 py-4 align-top text-sm text-neutral-300">{candidate.vehicle_viral_tier ?? "—"}</td>
                    <td className="px-5 py-4 align-top text-sm text-neutral-300">{candidate.country_news_category.replaceAll("_", " ")}</td>
                    <td className="px-5 py-4 align-top text-sm text-neutral-300">{formatScore(candidate.country_news_traffic_proxy_score)}</td>
                    <td className="px-5 py-4 align-top text-sm text-neutral-300">{candidate.person_canonical_name ?? "—"}</td>
                    <td className="px-5 py-4 align-top">
                      <PersonLinkTierBadge tier={candidate.person_link_tier} />
                      <p className="mt-1 text-xs text-neutral-500">{formatScore(candidate.vehicle_person_link_confidence_score)}</p>
                    </td>
                    <td className="px-5 py-4 align-top text-sm text-neutral-300">{formatScore(candidate.person_current_traffic_score)}</td>
                    <td className="px-5 py-4 align-top text-sm text-neutral-300">{formatScore(candidate.person_historical_resonance_score)}</td>
                    <td className="px-5 py-4 align-top text-sm text-neutral-300">{candidate.relationship_scope ?? "—"}</td>
                    <td className="px-5 py-4 align-top text-sm text-neutral-300">{formatScore(candidate.transformation_potential_score)}</td>
                    <td className="px-5 py-4 align-top">
                      <MissingSignalsBadges signals={candidate.missing_signals} />
                    </td>
                    <td className="px-5 py-4 align-top">
                      <button
                        type="button"
                        onClick={() => handleExpand(candidate)}
                        className="rounded border border-violet-900 px-2 py-1 text-xs text-violet-300"
                      >
                        {expandedId === candidate.id ? "Hide Evidence" : "Evidence"}
                      </button>
                    </td>
                  </tr>
                  {expandedId === candidate.id && (
                    <tr className="border-b border-neutral-900 bg-neutral-950">
                      <td colSpan={16} className="px-5 py-5">
                        {detailError ? (
                          <p className="text-sm text-red-400">{detailError}</p>
                        ) : !detail ? (
                          <p className="text-sm text-neutral-500">Loading evidence...</p>
                        ) : (
                          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
                            <EvidenceSection title="Vehicle Evidence" data={detail.fusion_evidence.vehicle ?? null} />
                            <EvidenceSection title="Country News Evidence" data={detail.fusion_evidence.country_news ?? null} />
                            <EvidenceSection title="Person Current Evidence" data={detail.fusion_evidence.person_current ?? null} />
                            <EvidenceSection
                              title="Historical Relationship Evidence"
                              data={detail.fusion_evidence.historical_relationship ?? null}
                            />
                            <EvidenceSection title="Transformation Evidence" data={detail.fusion_evidence.transformation ?? null} />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

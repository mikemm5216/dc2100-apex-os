"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { SectionPage } from "@/components/section-page";

// Task 3.5E: minimal Story Direction Review UI for Gate 2.
//
// This dashboard is a static export (next.config.ts: output:
// "export") -- there is no server runtime to host a proxy route
// that could hide STORY_ADMIN_TOKEN, and baking the token into a
// NEXT_PUBLIC_* env var would ship it in the built JS bundle to
// every visitor. Instead, the operator (Michael) pastes the token
// into this page at request time; it lives only in this
// component's in-memory state for the current browser session,
// is sent as a normal Authorization header directly to the Story
// API (which already allows Access-Control-Allow-Origin: * for
// every other Dashboard page), and is never written to disk,
// logged, or included in the production build.
const STORY_API_URL =
  process.env.NEXT_PUBLIC_STORY_API_URL ??
  "https://dc2100-apex-os-production.up.railway.app";

type CoverageValue = "USED" | "NOT_AVAILABLE" | "MATCH";

type SignalContributions = {
  vehicle?: { evidence_refs?: string[]; story_function?: string };
  country?: {
    country_signal?: "NOT_AVAILABLE";
    evidence_refs?: string[];
    direct_effect_on_story?: string;
  };
  person?: {
    person_signal?: "NOT_AVAILABLE";
    evidence_refs?: string[];
    fictionalized_trait?: string;
  };
  apex?: {
    beat_id?: string;
    stage?: string;
    qualification_objective?: string;
    failure_condition?: string;
  };
};

type DirectionPayload = {
  title?: string;
  narrative_emphasis?: string;
  hook?: string;
  logline?: string;
  core_conflict?: string;
  causal_chain?: string[];
  driver_choice?: {
    option_a?: string;
    option_b?: string;
    immediate_consequence?: string;
    long_term_cost?: string;
  };
  signal_contributions?: SignalContributions;
  coverage_status?: {
    vehicle_signal?: CoverageValue;
    country_signal?: CoverageValue;
    person_signal?: CoverageValue;
    historical_resonance?: CoverageValue;
    apex_rules?: CoverageValue;
    locked_beat?: CoverageValue;
  };
};

type DirectionRecord = {
  id: string;
  direction_type: string;
  direction_schema: "INTEGRATED_STORY" | "LEGACY_DIRECTION";
  payload: DirectionPayload;
  validation_status: "PASS" | "BLOCKED";
  validation_issues: Array<{ code: string; message?: string }>;
};

type StoryRunDetail = {
  run: {
    id: string;
    status: string;
    beat_id: string | null;
    error_code: string | null;
    error_message: string | null;
  };
  directions: DirectionRecord[];
  directions_schema_status: "CURRENT" | "LEGACY_NEEDS_REGENERATE";
  can_select_direction: boolean;
  can_regenerate: boolean;
};

function CoverageBadge({
  label,
  value,
}: {
  label: string;
  value: CoverageValue | undefined;
}) {
  const isPositive = value === "USED" || value === "MATCH";
  const isNeutral = value === "NOT_AVAILABLE";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
        isPositive
          ? "border-emerald-700 text-emerald-400"
          : isNeutral
            ? "border-neutral-700 text-neutral-400"
            : "border-red-700 text-red-400"
      }`}
    >
      {label}: {value ?? "MISSING"}
    </span>
  );
}

function DirectionCard({
  direction,
  selected,
  onSelect,
}: {
  direction: DirectionRecord;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const payload = direction.payload || {};
  const coverage = payload.coverage_status || {};
  const isLegacy = direction.direction_schema === "LEGACY_DIRECTION";
  const isSelectable =
    direction.validation_status === "PASS" &&
    direction.direction_schema === "INTEGRATED_STORY";

  return (
    <div
      className={`rounded-lg border p-4 ${
        isLegacy
          ? "border-amber-700 bg-amber-950/20"
          : selected
            ? "border-emerald-600"
            : "border-neutral-800"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <input
            type="radio"
            name="selected-direction"
            aria-label={`Select direction ${direction.id}`}
            checked={selected}
            disabled={!isSelectable}
            onChange={() => onSelect(direction.id)}
            className="h-4 w-4 disabled:opacity-30"
          />
          <div>
            <p className="text-xs uppercase tracking-wide text-neutral-500">
              {payload.narrative_emphasis || direction.direction_type} · #
              {direction.id}
            </p>
            <h3 className="text-lg font-semibold text-white">
              {payload.title || "(untitled)"}
            </h3>
          </div>
        </div>

        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            direction.validation_status === "PASS"
              ? "bg-emerald-900/50 text-emerald-300"
              : "bg-red-900/50 text-red-300"
          }`}
        >
          {direction.validation_status}
        </span>
      </div>

      {isLegacy && (
        <p className="mt-2 rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-xs text-amber-300">
          LEGACY_DIRECTION -- generated before the Integrated Story fix
          (single-signal shape). Never selectable at Gate 2; this run needs
          Regenerate.
        </p>
      )}

      {direction.validation_issues?.length > 0 && (
        <div className="mt-2 rounded border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-300">
          <p className="font-medium">Validator issues</p>
          <ul className="mt-1 list-disc pl-4">
            {direction.validation_issues.map((item, index) => (
              <li key={`${item.code}-${index}`}>
                {item.code}{item.message ? ` — ${item.message}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-sm text-neutral-300">{payload.hook}</p>
      <p className="mt-1 text-sm text-neutral-400">{payload.logline}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <CoverageBadge label="Vehicle" value={coverage.vehicle_signal} />
        <CoverageBadge label="Country" value={coverage.country_signal} />
        <CoverageBadge label="Person" value={coverage.person_signal} />
        <CoverageBadge
          label="Historical"
          value={coverage.historical_resonance}
        />
        <CoverageBadge label="APEX" value={coverage.apex_rules} />
        <CoverageBadge label="Locked Beat" value={coverage.locked_beat} />
      </div>

      {payload.causal_chain && payload.causal_chain.length > 0 && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-neutral-500">
            Causal Chain
          </p>
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm text-neutral-300">
            {payload.causal_chain.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {payload.driver_choice && (
        <div className="mt-4 grid gap-2 rounded border border-neutral-800 bg-neutral-950/50 p-3 text-sm">
          <p>
            <span className="text-neutral-500">Option A:</span>{" "}
            {payload.driver_choice.option_a}
          </p>
          <p>
            <span className="text-neutral-500">Option B:</span>{" "}
            {payload.driver_choice.option_b}
          </p>
          <p>
            <span className="text-neutral-500">Immediate:</span>{" "}
            {payload.driver_choice.immediate_consequence}
          </p>
          <p>
            <span className="text-neutral-500">Long-term cost:</span>{" "}
            {payload.driver_choice.long_term_cost}
          </p>
        </div>
      )}
    </div>
  );
}

export default function GenerationQueuePage() {
  const [runId, setRunId] = useState("1");
  const [token, setToken] = useState("");
  const [detail, setDetail] = useState<StoryRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDirectionId, setSelectedDirectionId] = useState<
    string | null
  >(null);

  async function fetchRunDetail() {
    const response = await fetch(`${STORY_API_URL}/api/story/runs/${runId}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    setDetail(body.data);
  }

  async function loadRun(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setDetail(null);
    setSelectedDirectionId(null);

    try {
      await fetchRunDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run.");
    } finally {
      setLoading(false);
    }
  }

  async function selectDirection() {
    if (!selectedDirectionId) return;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${STORY_API_URL}/api/story/runs/${runId}/select-direction`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            approved_by: "michael",
            selected_direction_ids: [selectedDirectionId],
            selection_mode: "SINGLE",
          }),
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      setSelectedDirectionId(null);
      await fetchRunDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to select direction.");
    } finally {
      setLoading(false);
    }
  }

  async function regenerateDirections() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${STORY_API_URL}/api/story/runs/${runId}/regenerate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            approved_by: "michael",
            stage: "DIRECTIONS",
            revision_notes: "Regenerate after Gate 2 validation failure.",
          }),
        }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
      await fetchRunDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate directions.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <SectionPage
      title="Story Direction Review (Gate 2)"
      description="Fetches a Story Run's active Directions and shows Vehicle/Country/Person/APEX signal coverage and the full causal chain -- never a one-line summary."
    >
      <form onSubmit={loadRun} className="flex flex-wrap items-end gap-3 p-6 pb-0">
        <label className="flex flex-col text-sm text-neutral-400">
          Story Run ID
          <input
            value={runId}
            onChange={(event) => setRunId(event.target.value)}
            className="mt-1 w-32 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-white"
          />
        </label>
        <label className="flex flex-col text-sm text-neutral-400">
          Story Admin Token
          <input
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="pasted for this session only, never stored"
            className="mt-1 w-72 rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-white"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !token}
          className="rounded bg-white/10 px-4 py-1.5 text-sm text-white hover:bg-white/20 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load Run"}
        </button>
      </form>

      <div className="p-6">
        {error && (
          <p className="rounded border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        {detail && (
          <>
            {(() => {
              const selectableCount = detail.directions.filter(
                (direction) =>
                  direction.validation_status === "PASS" &&
                  direction.direction_schema === "INTEGRATED_STORY"
              ).length;

              return (
                <div className={`mb-4 rounded border px-4 py-3 ${
                  selectableCount > 0
                    ? "border-emerald-800 bg-emerald-950/20 text-emerald-300"
                    : "border-red-800 bg-red-950/30 text-red-300"
                }`}>
                  <p className="font-semibold">
                    {selectableCount} Selectable Directions
                  </p>
                  {selectableCount === 0 && (
                    <p className="mt-1 text-sm">
                      Story Run failure: {detail.run.error_code ?? "NO_SELECTABLE_DIRECTION"}
                      {detail.run.error_message ? ` — ${detail.run.error_message}` : ""}
                    </p>
                  )}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={selectDirection}
                      disabled={
                        !detail.can_select_direction ||
                        selectableCount === 0 ||
                        !selectedDirectionId ||
                        loading
                      }
                      className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      SELECT
                    </button>
                    <button
                      type="button"
                      onClick={regenerateDirections}
                      disabled={!detail.can_regenerate || loading}
                      className="rounded bg-amber-700 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      REGENERATE
                    </button>
                  </div>
                </div>
              );
            })()}
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-neutral-300">
              <span>
                Run #{detail.run.id} ·{" "}
                <span className="font-medium text-white">
                  {detail.run.status}
                </span>
              </span>
              <span>Locked Beat: {detail.run.beat_id ?? "-"}</span>
              <span
                className={
                  detail.directions_schema_status === "CURRENT"
                    ? "text-emerald-400"
                    : "text-amber-400"
                }
              >
                Schema: {detail.directions_schema_status}
              </span>
              <span
                className={
                  detail.can_select_direction
                    ? "text-emerald-400"
                    : "text-neutral-500"
                }
              >
                Selectable: {detail.can_select_direction ? "YES" : "NO"}
              </span>
            </div>

            <div className="grid gap-4">
              {detail.directions.map((direction) => (
                <DirectionCard
                  key={direction.id}
                  direction={direction}
                  selected={selectedDirectionId === direction.id}
                  onSelect={setSelectedDirectionId}
                />
              ))}

              {detail.directions.length === 0 && (
                <p className="text-sm text-neutral-500">
                  No active directions for this run.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </SectionPage>
  );
}

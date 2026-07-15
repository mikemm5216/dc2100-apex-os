"use client";

import { useState } from "react";
import type { FormEvent } from "react";

import { SectionPage } from "@/components/section-page";

// Task 3.6: minimal Outline (Gate 3) / Script (Gate 4) review + lock
// interface. This is deliberately not a full redesign of the Gate 2
// page (apps/dashboard/src/app/generation-queue/page.tsx) -- it
// reuses the exact same auth/token/fetch conventions so the operator
// (Michael) has one consistent pattern across every Story gate.
//
// Same reasoning as Gate 2's page: this is a static export with no
// server runtime to hide STORY_ADMIN_TOKEN behind, so the token is
// pasted per-session into a password input and only ever sent as a
// normal Authorization header directly to the Story API.
const STORY_API_URL =
  process.env.NEXT_PUBLIC_STORY_API_URL ??
  "https://dc2100-apex-os-production.up.railway.app";

type CoverageValue = "USED" | "NOT_AVAILABLE" | "MATCH";

type CoverageStatus = {
  vehicle_signal?: CoverageValue;
  country_signal?: CoverageValue;
  person_signal?: CoverageValue;
  historical_resonance?: CoverageValue;
  apex_rules?: CoverageValue;
  locked_beat?: CoverageValue;
};

type ValidationIssue = { code: string; message?: string };

type OutlinePayload = {
  outline_title?: string;
  review_summary?: string;
  outcome?: string;
  next_episode_hook?: string;
};

type OutlineRecord = {
  id: string;
  version: number;
  payload: OutlinePayload;
  validation_status: "PASS" | "BLOCKED";
  validation_issues: ValidationIssue[];
  coverage_status: CoverageStatus | null;
  outline_schema: "INTEGRATED_COVERAGE" | "LEGACY_NO_COVERAGE";
  locked_beat_id: string | null;
  locked_by: string | null;
  locked_at: string | null;
};

type ScriptPayload = {
  title?: string;
  hook?: string;
  vo_text?: string;
};

type ScriptRecord = {
  id: string;
  version: number;
  variant_type: string;
  payload: ScriptPayload;
  word_count: number | null;
  estimated_duration_seconds: number | null;
  validation_status: "PASS" | "BLOCKED";
  validation_issues: ValidationIssue[];
  coverage_status: CoverageStatus | null;
  script_schema: "INTEGRATED_COVERAGE" | "LEGACY_NO_COVERAGE";
  locked_beat_id: string | null;
  locked_by: string | null;
  locked_at: string | null;
};

type StoryRunDetail = {
  run: {
    id: string;
    status: string;
    beat_id: string | null;
    error_code: string | null;
    error_message: string | null;
  };
  outline: OutlineRecord[];
  scripts: ScriptRecord[];
  can_lock_outline: boolean;
  can_lock_script: boolean;
  can_regenerate: boolean;
};

function CoverageBadges({ coverage }: { coverage: CoverageStatus | null }) {
  if (!coverage) {
    return (
      <p className="mt-2 text-xs text-amber-400">
        LEGACY_NO_COVERAGE -- generated before the Outline/Script Integrated
        Signals fix. Coverage continuity was never checked for this row.
      </p>
    );
  }

  const entries: Array<[string, CoverageValue | undefined]> = [
    ["Vehicle", coverage.vehicle_signal],
    ["Country", coverage.country_signal],
    ["Person", coverage.person_signal],
    ["Historical", coverage.historical_resonance],
    ["APEX", coverage.apex_rules],
    ["Locked Beat", coverage.locked_beat],
  ];

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {entries.map(([label, value]) => {
        const isPositive = value === "USED" || value === "MATCH";
        const isNeutral = value === "NOT_AVAILABLE";

        return (
          <span
            key={label}
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
      })}
    </div>
  );
}

function ValidationIssues({ issues }: { issues: ValidationIssue[] }) {
  if (!issues || issues.length === 0) return null;

  return (
    <div className="mt-2 rounded border border-red-900/70 bg-red-950/30 px-3 py-2 text-xs text-red-300">
      <p className="font-medium">Validator issues</p>
      <ul className="mt-1 list-disc pl-4">
        {issues.map((item, index) => (
          <li key={`${item.code}-${index}`}>
            {item.code}
            {item.message ? ` — ${item.message}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StoryOutlineScriptReviewPage() {
  const [runId, setRunId] = useState("1");
  const [token, setToken] = useState("");
  const [detail, setDetail] = useState<StoryRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    try {
      await fetchRunDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load run.");
    } finally {
      setLoading(false);
    }
  }

  async function postAction(path: string, body: Record<string, unknown>) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${STORY_API_URL}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const responseBody = await response.json();
      if (!response.ok) {
        throw new Error(responseBody.message || `HTTP ${response.status}`);
      }
      await fetchRunDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  function lockOutline(outlineId: string) {
    return postAction(`/api/story/runs/${runId}/lock-outline`, {
      approved_by: "michael",
      outline_id: Number(outlineId),
    });
  }

  function lockScript(scriptId: string) {
    return postAction(`/api/story/runs/${runId}/lock-script`, {
      approved_by: "michael",
      script_id: Number(scriptId),
    });
  }

  function regenerate(stage: "OUTLINE" | "SCRIPTS") {
    return postAction(`/api/story/runs/${runId}/regenerate`, {
      approved_by: "michael",
      stage,
      revision_notes: `Regenerate after Gate ${stage === "OUTLINE" ? 3 : 4} validation failure.`,
    });
  }

  return (
    <SectionPage
      title="Outline & Script Review (Gate 3/4)"
      description="Shows the active Outline and Script variants for a Story Run, their inherited signal coverage (vehicle/country/person/historical/APEX), and lets Michael lock or regenerate each stage."
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
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-neutral-300">
              <span>
                Run #{detail.run.id} ·{" "}
                <span className="font-medium text-white">{detail.run.status}</span>
              </span>
              <span>Locked Beat: {detail.run.beat_id ?? "-"}</span>
            </div>

            <section className="mb-8">
              <h2 className="mb-3 text-lg font-semibold text-white">
                Outline (Gate 3)
              </h2>

              {detail.outline.length === 0 && (
                <p className="text-sm text-neutral-500">
                  No active outline for this run.
                </p>
              )}

              {detail.outline.map((outline) => (
                <div
                  key={outline.id}
                  className="rounded-lg border border-neutral-800 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-neutral-500">
                        v{outline.version} · #{outline.id} ·{" "}
                        {outline.outline_schema}
                      </p>
                      <h3 className="text-lg font-semibold text-white">
                        {outline.payload.outline_title || "(untitled)"}
                      </h3>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        outline.validation_status === "PASS"
                          ? "bg-emerald-900/50 text-emerald-300"
                          : "bg-red-900/50 text-red-300"
                      }`}
                    >
                      {outline.validation_status}
                      {outline.locked_at ? " · LOCKED" : ""}
                    </span>
                  </div>

                  <CoverageBadges coverage={outline.coverage_status} />
                  <ValidationIssues issues={outline.validation_issues} />

                  <p className="mt-3 text-sm text-neutral-300">
                    {outline.payload.review_summary}
                  </p>
                  <p className="mt-1 text-sm text-neutral-400">
                    {outline.payload.outcome}
                  </p>

                  {!outline.locked_at && (
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => lockOutline(outline.id)}
                        disabled={!detail.can_lock_outline || loading}
                        className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        LOCK OUTLINE
                      </button>
                      <button
                        type="button"
                        onClick={() => regenerate("OUTLINE")}
                        disabled={!detail.can_regenerate || loading}
                        className="rounded bg-amber-700 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        REGENERATE
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-white">
                Scripts (Gate 4)
              </h2>

              {detail.scripts.length === 0 && (
                <p className="text-sm text-neutral-500">
                  No active script variants for this run.
                </p>
              )}

              <div className="grid gap-4">
                {detail.scripts.map((script) => (
                  <div
                    key={script.id}
                    className="rounded-lg border border-neutral-800 p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-wide text-neutral-500">
                          {script.variant_type} · v{script.version} · #{script.id} ·{" "}
                          {script.script_schema}
                        </p>
                        <h3 className="text-lg font-semibold text-white">
                          {script.payload.title || "(untitled)"}
                        </h3>
                      </div>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          script.validation_status === "PASS"
                            ? "bg-emerald-900/50 text-emerald-300"
                            : "bg-red-900/50 text-red-300"
                        }`}
                      >
                        {script.validation_status}
                        {script.locked_at ? " · LOCKED" : ""}
                      </span>
                    </div>

                    <CoverageBadges coverage={script.coverage_status} />
                    <ValidationIssues issues={script.validation_issues} />

                    <p className="mt-3 text-sm text-neutral-300">
                      {script.payload.hook}
                    </p>
                    <p className="mt-1 text-sm text-neutral-400">
                      {script.word_count ?? "-"} words ·{" "}
                      {script.estimated_duration_seconds ?? "-"}s
                    </p>

                    {!script.locked_at && (
                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={() => lockScript(script.id)}
                          disabled={!detail.can_lock_script || loading}
                          className="rounded bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          LOCK THIS VARIANT
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {detail.scripts.length > 0 && (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => regenerate("SCRIPTS")}
                    disabled={!detail.can_regenerate || loading}
                    className="rounded bg-amber-700 px-3 py-1.5 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    REGENERATE ALL VARIANTS
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </SectionPage>
  );
}

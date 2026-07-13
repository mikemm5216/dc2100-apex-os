"use client";

import { useState } from "react";

import { CandidatesTable } from "@/components/candidates-table";
import { FusionCandidatesTable } from "@/components/fusion-candidates-table";

type Tab = "fusion" | "content";

export function CandidatesTabs() {
  const [tab, setTab] = useState<Tab>("fusion");

  return (
    <div>
      <div className="flex gap-2 border-b border-neutral-800 px-6 pt-4">
        <button
          type="button"
          onClick={() => setTab("fusion")}
          className={`rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition ${
            tab === "fusion"
              ? "border-neutral-800 bg-neutral-900/50 text-white"
              : "border-transparent text-neutral-500 hover:text-neutral-300"
          }`}
        >
          Fusion Candidates
        </button>
        <button
          type="button"
          onClick={() => setTab("content")}
          className={`rounded-t-lg border border-b-0 px-4 py-2 text-sm font-medium transition ${
            tab === "content"
              ? "border-neutral-800 bg-neutral-900/50 text-white"
              : "border-transparent text-neutral-500 hover:text-neutral-300"
          }`}
        >
          Content Candidates
        </button>
      </div>

      {tab === "fusion" ? <FusionCandidatesTable /> : <CandidatesTable />}
    </div>
  );
}

import { SectionPage } from "@/components/section-page";
import { SignalsDashboard } from "@/components/signals-dashboard";
import { SourceManager } from "@/components/source-manager";

export default function SignalsPage() {
  return (
    <SectionPage
      title="Signals"
      description="Discover, rank, and control viral automotive intelligence."
    >
      <div className="space-y-6 bg-neutral-950 p-4 md:p-6">
        <SignalsDashboard />

        <details className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
          <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-neutral-300">
            Source Watchlist Management
          </summary>

          <div className="border-t border-neutral-800">
            <SourceManager />
          </div>
        </details>
      </div>
    </SectionPage>
  );
}

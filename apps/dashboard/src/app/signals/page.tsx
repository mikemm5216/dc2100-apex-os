import { SectionPage } from "@/components/section-page";
import { SourceManager } from "@/components/source-manager";

export default function SignalsPage() {
  return (
    <SectionPage
      title="Signals"
      description="Manage source watchlists and monitor viral signal discovery."
    >
      <SourceManager />
    </SectionPage>
  );
}

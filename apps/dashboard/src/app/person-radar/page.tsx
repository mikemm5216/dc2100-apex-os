import { SectionPage } from "@/components/section-page";
import { PersonRadarDashboard } from "@/components/person-radar-dashboard";

export default function PersonRadarPage() {
  return (
    <SectionPage
      title="Vehicle-Linked Person Traffic Radar"
      description="Public automotive figures ranked by vehicle attention and news coverage."
    >
      <div className="space-y-6 bg-neutral-950 p-4 md:p-6">
        <PersonRadarDashboard />
      </div>
    </SectionPage>
  );
}

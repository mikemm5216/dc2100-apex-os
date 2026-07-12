import { SectionPage } from "@/components/section-page";
import { CountryNewsDashboard } from "@/components/country-news-dashboard";

export default function CountryNewsPage() {
  return (
    <SectionPage
      title="Country News Traffic Radar"
      description="Country-level high-traffic news selected from active vehicle countries."
    >
      <div className="space-y-6 bg-neutral-950 p-4 md:p-6">
        <CountryNewsDashboard />
      </div>
    </SectionPage>
  );
}

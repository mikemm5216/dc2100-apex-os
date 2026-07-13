import { CandidatesTabs } from "@/components/candidates-tabs";
import { SectionPage } from "@/components/section-page";

export default function CandidatesPage() {
  return (
    <SectionPage
      title="Candidates"
      description="Review vehicle-centered fusion candidates and ranked DC 2100 content candidates."
    >
      <CandidatesTabs />
    </SectionPage>
  );
}

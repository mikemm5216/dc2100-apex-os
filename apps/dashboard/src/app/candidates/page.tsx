import { CandidatesTable } from "@/components/candidates-table";
import { SectionPage } from "@/components/section-page";

export default function CandidatesPage() {
  return (
    <SectionPage
      title="Candidates"
      description="Review ranked DC 2100 content candidates and their current workflow state."
    >
      <CandidatesTable />
    </SectionPage>
  );
}

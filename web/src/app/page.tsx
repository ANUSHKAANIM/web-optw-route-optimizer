import { NewRunForm } from "@/components/forms/new-run-form";
import { PageHeader } from "@/components/layout/page-header";

export default function NewRunPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="New Run"
        description="Configure a problem instance and let the trained model plan a live, click-to-route orienteering path with time windows."
      />
      <NewRunForm />
    </div>
  );
}

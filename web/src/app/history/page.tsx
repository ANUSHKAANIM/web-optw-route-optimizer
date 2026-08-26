import { runService } from "@/lib/services/run.service.impl";
import { listRunsQuerySchema } from "@/lib/dto/run.dto";
import { RunsTable } from "@/components/data-table/runs-table";
import { PageHeader } from "@/components/layout/page-header";

// Always reflects the live database; never statically prerendered.
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const initial = await runService.listRuns(listRunsQuerySchema.parse({}));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Run History"
        description="Every optimization run, in progress or completed, with its final route quality."
      />
      <RunsTable initial={initial} />
    </div>
  );
}

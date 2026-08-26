import { runService } from "@/lib/services/run.service.impl";
import { listRunsQuerySchema } from "@/lib/dto/run.dto";
import { RunsTable } from "@/components/data-table/runs-table";

// Always reflects the live database; never statically prerendered.
export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const initial = await runService.listRuns(listRunsQuerySchema.parse({}));

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Run History</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every optimization run, in progress or completed, with its final route quality.
        </p>
      </div>
      <RunsTable initial={initial} />
    </div>
  );
}

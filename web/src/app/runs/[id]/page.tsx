import { notFound } from "next/navigation";
import { runService } from "@/lib/services/run.service.impl";
import type { RunView } from "@/lib/services/run.service";
import { NotFoundError } from "@/lib/errors/domain-error";
import { RunSession } from "@/components/run/run-session";

// Each run is live, mutable state -- never statically prerendered.
export const dynamic = "force-dynamic";

async function loadRun(runId: number): Promise<RunView> {
  try {
    return await runService.getRun(runId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) notFound();

  const view = await loadRun(runId);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <RunSession initialView={view} />
    </div>
  );
}

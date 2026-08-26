import { notFound } from "next/navigation";
import { runService } from "@/lib/services/run.service.impl";
import { NotFoundError } from "@/lib/errors/domain-error";
import { RunSession } from "@/components/run/run-session";

// Each run is live, mutable state -- never statically prerendered.
export const dynamic = "force-dynamic";

export default async function RunPage({ params }: PageProps<"/runs/[id]">) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) notFound();

  try {
    const view = await runService.getRun(runId);
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <RunSession initialView={view} />
      </div>
    );
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

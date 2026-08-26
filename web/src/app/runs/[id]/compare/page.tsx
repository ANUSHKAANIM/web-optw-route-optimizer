import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ComparisonView } from "@/components/run/comparison-view";

export default async function ComparePage({ params }: PageProps<"/runs/[id]/compare">) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) notFound();

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <Button
        variant="ghost"
        size="sm"
        className="mb-4 gap-2"
        nativeButton={false}
        render={<Link href={`/runs/${runId}`} />}
      >
        <ArrowLeft className="size-4" />
        Back to run
      </Button>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Greedy vs. Beam Search</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Both searches run on this run&apos;s original instance, from the depot, independent of
          how the live session played out.
        </p>
      </div>
      <ComparisonView runId={runId} />
    </div>
  );
}

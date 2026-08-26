import { TrainingMetricsChart } from "@/components/charts/training-metrics-chart";
import { PageHeader } from "@/components/layout/page-header";

export default function TrainingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Training Metrics"
        description={
          <>
            REINFORCE training curves for the Pointer Network model currently served in
            production (see <code className="rounded bg-muted px-1 py-0.5 text-xs">train.py</code>{" "}
            and <code className="rounded bg-muted px-1 py-0.5 text-xs">training_log.csv</code> in
            the project root). Re-run training and re-export to ONNX to update the live model.
          </>
        }
      />
      <TrainingMetricsChart />
    </div>
  );
}

import { TrainingMetricsChart } from "@/components/charts/training-metrics-chart";

export default function TrainingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Training Metrics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          REINFORCE training curves for the Pointer Network model currently served in production
          (see <code className="rounded bg-muted px-1 py-0.5 text-xs">train.py</code> and{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">training_log.csv</code> in the
          project root). Re-run training and re-export to ONNX to update the live model.
        </p>
      </div>
      <TrainingMetricsChart />
    </div>
  );
}

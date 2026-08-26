import type { RunEvent } from "@/db/schema";

/** Builds a CSV of a completed run's stops (node, reward, cumulative reward,
 * elapsed time) and triggers a browser download. Client-side only -- no
 * server round trip needed since the data is already in hand. */
export function downloadRunCsv(runId: number, events: RunEvent[]): void {
  const header = "step,node,reward,cumulative_reward,elapsed_time_hours,forecast_updated";
  const rows = events.map((e) =>
    [e.stepIndex, e.node, e.reward.toFixed(4), e.cumulativeReward.toFixed(4), e.currentTime.toFixed(4), e.forecastUpdated].join(","),
  );
  const csv = [header, ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `optw-run-${runId}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

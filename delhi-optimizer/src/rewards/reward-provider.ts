import type { GraphNode } from "@/types/graph";

export interface RewardContext {
  seed: number;
  /** The real moment the session began -- the fixed anchor every forecast
   * cycle's timestamps are computed relative to. */
  startedAt: Date;
  /** Real wall-clock seconds elapsed since the session started -- forecast
   * cycles are anchored to this, not to how often a client happens to poll. */
  secondsSinceStart: number;
  forecastIntervalSeconds: number;
  nodes: GraphNode[];
}

export interface ForecastInfo {
  scenarioId: number;
  generatedAtIso: string;
  nextUpdateIso: string;
  concentration: string;
  /** A simulated risk region -- always geometry only, never presented as
   * real data, positioned in the abstract (x, y) simulation plane, not
   * real-world geography. This is what a future real cyclone-cone input
   * would replace, without the optimizer changing at all. */
  riskZone: { centerX: number; centerY: number; radiusKm: number; level: "high" | "medium" | "low" }[];
}

export interface RiskPrioritySnapshot {
  /** nodeId -> raw risk/hazard estimate, 0-1. Informational -- see
   * NodeState's doc comment for why this is kept separate from priority. */
  riskScores: Map<string, number>;
  /** nodeId -> current priority. The optimizer only ever sees this map --
   * never which provider produced it, and never riskScores directly. */
  priorities: Map<string, number>;
  forecast: ForecastInfo;
}

/**
 * The external-forecast seam: the optimizer receives `node.currentPriority`
 * and nothing else about where it came from. A future real cyclone-risk
 * feed implements this same interface differently -- no other layer
 * changes. There is deliberately only one implementation right now
 * (risk-priority-provider.ts) -- the earlier tourist-vs-simulation mode
 * switch was removed as part of the evacuation pivot.
 */
export interface RiskPriorityProvider {
  getSnapshot(ctx: RewardContext): RiskPrioritySnapshot;
  /** Seconds until the next forecast update, for the client-side countdown. */
  secondsUntilNextForecast(ctx: RewardContext): number;
}

export function currentForecastIndex(secondsSinceStart: number, intervalSeconds: number): number {
  return Math.floor(Math.max(0, secondsSinceStart) / intervalSeconds);
}

export function secondsUntilNextForecast(secondsSinceStart: number, intervalSeconds: number): number {
  const elapsedInCycle = Math.max(0, secondsSinceStart) % intervalSeconds;
  return intervalSeconds - elapsedInCycle;
}

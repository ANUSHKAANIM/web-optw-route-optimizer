import type { GraphNode } from "@/types/graph";
import type { ForecastTickResult } from "./cyclone-forecast-engine";

/** Same baseline-urgency fraction risk-priority-provider.ts already uses:
 * a zero-risk node still carries this fraction of its demand as priority,
 * since people there still need evacuating even without an active alert. */
const BASELINE_URGENCY_FRACTION = 0.3;

export interface ForecastPrioritySnapshot {
  priorities: Map<string, number>;
  riskScores: Map<string, number>;
}

/**
 * Bridges a Phase 2 forecast tick into the exact {priorities, riskScores}
 * shape every existing solver (computeBaselineRoute, computeNeuralRoute,
 * computeExactPlan) already consumes -- none of them need to change, since
 * the project's existing seam ("the optimizer never inspects where this
 * number came from," per reward-provider.ts) already supports swapping in
 * a different priority source.
 *
 * Composes two things: the project's existing demand-weighted baseline
 * urgency formula (rewards/risk-priority-provider.ts) with the forecast
 * engine's tier-based reward multiplier (tier escalation + TOCPUR-style
 * accumulation, see cyclone-forecast-engine.ts).
 */
export function priorityFromForecastTick(nodes: GraphNode[], tick: ForecastTickResult): ForecastPrioritySnapshot {
  const priorities = new Map<string, number>();
  const riskScores = new Map<string, number>();

  for (const node of nodes) {
    const state = tick.cellStates.get(node.id);
    if (!state || node.role === "shelter") {
      priorities.set(node.id, 0);
      riskScores.set(node.id, 0);
      continue;
    }

    riskScores.set(node.id, state.riskScore);
    const urgency = BASELINE_URGENCY_FRACTION + (1 - BASELINE_URGENCY_FRACTION) * state.riskScore;
    priorities.set(node.id, Math.round(node.demand * urgency * state.rewardMultiplier));
  }

  return { priorities, riskScores };
}

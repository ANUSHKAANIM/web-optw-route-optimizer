import type { Graph, Weekday } from "@/types/graph";
import type { Route } from "@/types/game";
import { computeNodeStates, computeRelativeWindow, planArrival } from "./feasibility";

export interface BaselinePolicyInput {
  graph: Graph;
  currentNodeId: string;
  depotNodeId: string;
  totalGameMinutes: number;
  gameStartMinutesOfDay: number;
  weekday: Weekday;
  priorities: ReadonlyMap<string, number>;
  riskScores: ReadonlyMap<string, number>;
  /** Demand already served before this route starts (e.g. by the player's
   * own progress so far), and the shelter's total capacity -- together
   * these bound how much more the greedy search is allowed to collect. */
  demandServedSoFar: number;
  shelterCapacity: number;
  /** Origins already evacuated by ANY player in the session (not just this
   * one) -- their demand is already served, so they must never be
   * suggested again regardless of which player's route this is. */
  alreadyVisited?: ReadonlySet<string>;
}

/**
 * Traditional (non-learned) baseline route policy. At every step, greedily
 * visits the feasible node maximizing priority-per-minute-of-TOTAL-time-
 * cost (travel + any wait for accessibility + the service time itself),
 * until no feasible moves remain. No model, no training: this is what the
 * neural policy and the eventual CPLEX reference solution get compared
 * against.
 *
 * Scoring by travel time alone (an earlier version of this function did)
 * has a real failure mode: it happily waits hours for a mediocre-reward
 * place to open rather than grabbing several already-accessible ones
 * first, since a long wait never counted against it. Folding wait +
 * service time into the cost fixes that.
 */
export function computeBaselineRoute(input: BaselinePolicyInput): Route {
  const start = Date.now();
  const { graph, depotNodeId, totalGameMinutes, gameStartMinutesOfDay, weekday, priorities, riskScores, shelterCapacity } = input;

  const visited = new Set<string>([input.currentNodeId, ...(input.alreadyVisited ?? [])]);
  let currentNodeId = input.currentNodeId;
  let elapsedMinutes = 0;
  let demandServedSoFar = input.demandServedSoFar;

  const stops: Route["stops"] = [];
  let totalDistanceKm = 0;
  let totalReward = 0;
  let totalDemandServed = 0;

  while (true) {
    const states = computeNodeStates({
      graph,
      currentNodeId,
      depotNodeId,
      elapsedMinutes,
      totalGameMinutes,
      gameStartMinutesOfDay,
      weekday,
      visited,
      priorities,
      riskScores,
      demandServedSoFar,
      shelterCapacity,
    });
    const feasible = states.filter((s) => s.feasible);
    if (feasible.length === 0) break;

    let bestNodeId: string | null = null;
    let bestPlan: ReturnType<typeof planArrival> | null = null;
    let bestDensity = -Infinity;
    for (const candidate of feasible) {
      const candidateNode = graph.nodesById.get(candidate.nodeId);
      const window = candidateNode ? computeRelativeWindow(candidateNode, weekday, gameStartMinutesOfDay) : null;
      if (!candidateNode || !window) continue;

      const plan = planArrival(graph, currentNodeId, candidate.nodeId, elapsedMinutes, window, candidateNode.serviceDurationMinutes);
      const totalTimeCost = plan.travelMinutes + plan.waitMinutes + candidateNode.serviceDurationMinutes;
      const density = candidate.currentPriority / Math.max(totalTimeCost, 1e-6);

      if (density > bestDensity) {
        bestDensity = density;
        bestNodeId = candidate.nodeId;
        bestPlan = plan;
      }
    }

    if (!bestNodeId || !bestPlan) break;
    const node = graph.nodesById.get(bestNodeId)!;
    const plan = bestPlan;
    const reward = priorities.get(node.id) ?? 0;
    const demandServed = node.role === "origin" ? node.demand : 0;

    stops.push({
      nodeId: node.id,
      arrivalMinutes: plan.arrivalMinutes,
      waitMinutes: plan.waitMinutes,
      departureMinutes: plan.finishVisitMinutes,
      rewardCollected: reward,
      demandServed,
    });

    totalDistanceKm += graph.distanceKm.get(currentNodeId)?.get(node.id) ?? 0;
    totalReward += reward;
    totalDemandServed += demandServed;
    demandServedSoFar += demandServed;
    elapsedMinutes = plan.finishVisitMinutes;
    visited.add(node.id);
    currentNodeId = node.id;
  }

  const returnDistanceKm = graph.distanceKm.get(currentNodeId)?.get(depotNodeId) ?? 0;
  const returnTravelMinutes = graph.travelTimeMinutes.get(currentNodeId)?.get(depotNodeId) ?? 0;

  return {
    stops,
    totalDistanceKm: totalDistanceKm + returnDistanceKm,
    totalTravelMinutes: elapsedMinutes + returnTravelMinutes,
    totalReward,
    totalDemandServed,
    computeTimeMs: Date.now() - start,
  };
}

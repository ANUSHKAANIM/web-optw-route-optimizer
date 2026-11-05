import type { Graph, Weekday } from "@/types/graph";
import type { Route } from "@/types/game";
import { effectiveWindow, planArrival, type RelativeWindow } from "@/optimization/feasibility";
import { computeNeuralRoute } from "@/rl/beam-search";
import { computeBaselineRoute } from "@/optimization/baseline-policy";

/**
 * Handles the hybrid-control override: a human redirects one van to a
 * specific cell, and the algorithm replans the rest of that van's route
 * around it. Builds the forced first leg directly with the same
 * planArrival()/computeRelativeWindow() calls beam-search.ts and
 * baseline-policy.ts already use to construct stops, then hands off to
 * the normal per-team solver (neural or greedy) for everything after --
 * so the override doesn't need its own routing logic, just its own first
 * stop.
 *
 * Known limitation: only supported for the neural and greedy tiers. The
 * exact MILP tier (computeExactPlan) has no "forced first stop" concept
 * in its current formulation -- encoding that would need an extra
 * constraint per pinned team, which hasn't been added. A pin on a team
 * routed by the exact tier is a documented no-op right now, not silently
 * dropped: callers should route pinned teams through this function and
 * route the rest of the cluster separately if they need the exact tier.
 *
 * If the pinned cell genuinely isn't reachable in time (closed, too far
 * for the remaining budget, etc.), this falls back to the normal
 * un-pinned solve for that team rather than failing the whole route --
 * a rejected override is still better served by a real route than none.
 */
export interface PinnedRouteInput {
  graph: Graph;
  currentNodeId: string;
  depotNodeId: string;
  pinnedCellId: string;
  remainingMinutes: number;
  shiftedGameStartMinutesOfDay: number;
  weekday: Weekday;
  priorities: ReadonlyMap<string, number>;
  riskScores: ReadonlyMap<string, number>;
  demandServedSoFar: number;
  shelterCapacity: number;
  alreadyVisited?: ReadonlySet<string>;
  method: "neural" | "greedy";
  /** Per-cell forecast-driven evacuation deadline -- see
   * FeasibilityInput.deadlineWindows. Applied to the pinned cell's own
   * reachability check, and passed through to the greedy remainder solve
   * (not the neural one -- same documented gap as cluster-router.ts). */
  deadlineWindows?: ReadonlyMap<string, RelativeWindow | null>;
}

export interface PinnedRouteResult {
  route: Route;
  /** False when the pin couldn't be honored (closed, infeasible, or
   * already claimed) and this fell back to an un-pinned solve instead. */
  pinHonored: boolean;
}

export async function routeTeamWithPin(input: PinnedRouteInput): Promise<PinnedRouteResult> {
  const {
    graph,
    currentNodeId,
    depotNodeId,
    pinnedCellId,
    remainingMinutes,
    shiftedGameStartMinutesOfDay,
    weekday,
    priorities,
    riskScores,
    demandServedSoFar,
    shelterCapacity,
    alreadyVisited,
    method,
    deadlineWindows,
  } = input;

  const unpinnedSolve = () =>
    solveRemainder({
      graph,
      currentNodeId,
      depotNodeId,
      remainingMinutes,
      shiftedGameStartMinutesOfDay,
      weekday,
      priorities,
      riskScores,
      demandServedSoFar,
      shelterCapacity,
      alreadyVisited,
      method,
      deadlineWindows,
    });

  const pinnedNode = graph.nodesById.get(pinnedCellId);
  if (!pinnedNode || alreadyVisited?.has(pinnedCellId) || pinnedCellId === currentNodeId) {
    return { route: await unpinnedSolve(), pinHonored: false };
  }

  const window = effectiveWindow(pinnedNode, weekday, shiftedGameStartMinutesOfDay, deadlineWindows?.get(pinnedCellId));
  if (!window) {
    return { route: await unpinnedSolve(), pinHonored: false };
  }

  const plan = planArrival(graph, currentNodeId, pinnedCellId, 0, window, pinnedNode.serviceDurationMinutes);
  const returnTravel = graph.travelTimeMinutes.get(pinnedCellId)?.get(depotNodeId) ?? Infinity;
  const fitsBudget = plan.canFinishBeforeClosing && plan.finishVisitMinutes + returnTravel <= remainingMinutes;
  const pinnedDemand = pinnedNode.role === "origin" ? pinnedNode.demand : 0;
  const fitsCapacity = pinnedNode.role !== "origin" || demandServedSoFar + pinnedDemand <= shelterCapacity;

  if (!fitsBudget || !fitsCapacity) {
    return { route: await unpinnedSolve(), pinHonored: false };
  }

  const pinnedReward = priorities.get(pinnedCellId) ?? 0;
  const pinnedDistanceKm = graph.distanceKm.get(currentNodeId)?.get(pinnedCellId) ?? 0;

  const continuation = await solveRemainder({
    graph,
    currentNodeId: pinnedCellId,
    depotNodeId,
    remainingMinutes: remainingMinutes - plan.finishVisitMinutes,
    shiftedGameStartMinutesOfDay: shiftedGameStartMinutesOfDay + plan.finishVisitMinutes,
    weekday,
    priorities,
    riskScores,
    demandServedSoFar: demandServedSoFar + pinnedDemand,
    shelterCapacity,
    alreadyVisited: new Set([...(alreadyVisited ?? []), pinnedCellId]),
    method,
    deadlineWindows,
  });

  const route: Route = {
    stops: [
      {
        nodeId: pinnedCellId,
        arrivalMinutes: plan.arrivalMinutes,
        waitMinutes: plan.waitMinutes,
        departureMinutes: plan.finishVisitMinutes,
        rewardCollected: pinnedReward,
        demandServed: pinnedDemand,
      },
      ...continuation.stops,
    ],
    totalDistanceKm: pinnedDistanceKm + continuation.totalDistanceKm,
    totalTravelMinutes: plan.finishVisitMinutes + continuation.totalTravelMinutes,
    totalReward: pinnedReward + continuation.totalReward,
    totalDemandServed: pinnedDemand + continuation.totalDemandServed,
    computeTimeMs: continuation.computeTimeMs,
  };

  return { route, pinHonored: true };
}

interface RemainderInput {
  graph: Graph;
  currentNodeId: string;
  depotNodeId: string;
  remainingMinutes: number;
  shiftedGameStartMinutesOfDay: number;
  weekday: Weekday;
  priorities: ReadonlyMap<string, number>;
  riskScores: ReadonlyMap<string, number>;
  demandServedSoFar: number;
  shelterCapacity: number;
  alreadyVisited?: ReadonlySet<string>;
  method: "neural" | "greedy";
  deadlineWindows?: ReadonlyMap<string, RelativeWindow | null>;
}

function solveRemainder(input: RemainderInput): Route | Promise<Route> {
  const solveInput = {
    graph: input.graph,
    currentNodeId: input.currentNodeId,
    depotNodeId: input.depotNodeId,
    totalGameMinutes: input.remainingMinutes,
    gameStartMinutesOfDay: input.shiftedGameStartMinutesOfDay,
    weekday: input.weekday,
    priorities: input.priorities,
    riskScores: input.riskScores,
    demandServedSoFar: input.demandServedSoFar,
    shelterCapacity: input.shelterCapacity,
    alreadyVisited: input.alreadyVisited,
  };
  return input.method === "neural"
    ? computeNeuralRoute(solveInput)
    : computeBaselineRoute({ ...solveInput, deadlineWindows: input.deadlineWindows });
}

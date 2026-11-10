import type { Weekday } from "@/types/graph";
import type { Route } from "@/types/game";
import type { GraphCluster } from "@/graph/spatial-clustering";
import type { RelativeWindow } from "@/optimization/feasibility";
import { computeBaselineRoute } from "@/optimization/baseline-policy";
import { computeNeuralRoute } from "@/rl/beam-search";
import { computeExactPlan } from "./milp";

export type SolveMethod = "exact" | "neural" | "greedy";

export interface ClusterRoutingThresholds {
  /** Candidate-origin count at or below which the exact MILP is attempted. */
  maxCandidatesForExact: number;
  /** Candidate-origin count at or below which RL beam search is attempted
   * (when exact isn't used because the cluster is too big). Above this,
   * falls back to the greedy baseline policy. */
  maxCandidatesForNeural: number;
}

/**
 * A documented, adjustable starting point -- NOT yet benchmarked against
 * the actual cluster-size distribution Phase 1's synthetic generator
 * produces (average ~79 nodes/cluster at the 20,000-cell/250-cluster
 * default, but individual clusters vary). Based on:
 *   - This project's own earlier MEASURED MILP variable counts (~12
 *     origins, 5 teams -> 855 variables, still solvable); 40 origins x a
 *     handful of teams keeps the O(teams * candidates^2) arc-variable
 *     count in a similar order of magnitude.
 *   - Beam search's own O(N^2) per-step adjacency-mask cost (see
 *     rl/features.ts buildAdjacencyMask) -- 300 candidates keeps that at
 *     ~90,000 per step, trivial.
 * Retune these once real per-cluster timing data exists.
 */
export const DEFAULT_CLUSTER_ROUTING_THRESHOLDS: ClusterRoutingThresholds = {
  maxCandidatesForExact: 40,
  maxCandidatesForNeural: 300,
};

export interface ClusterTeam {
  teamId: number;
  currentNodeId: string;
  /** Minutes remaining for this team/van before it must be back at the
   * shelter -- the same "budget starting now" convention every existing
   * solver already uses (BaselinePolicyInput/BeamSearchInput's
   * totalGameMinutes, ExactPlanInput's remainingMinutes). */
  remainingMinutes: number;
  /** gameStartMinutesOfDay already shifted so "now" for this team lines up
   * correctly against node accessibility windows -- same convention as
   * ExactTeamInput.shiftedGameStartMinutesOfDay. */
  shiftedGameStartMinutesOfDay: number;
  /** This van's own carrying capacity (Phase 7) -- distinct from
   * shelterCapacity. undefined = unconstrained, threaded through to
   * whichever tier actually ends up routing this team. */
  vehicleCapacity?: number;
}

export interface ClusterRoutingInput {
  cluster: GraphCluster;
  teams: ClusterTeam[];
  weekday: Weekday;
  priorities: ReadonlyMap<string, number>;
  riskScores: ReadonlyMap<string, number>;
  demandServedSoFar: number;
  shelterCapacity: number;
  /** Origins already evacuated by any team outside this cluster's own
   * teams (e.g. a prior tick, or another cluster sharing this shelter). */
  alreadyVisited?: ReadonlySet<string>;
  thresholds?: ClusterRoutingThresholds;
  exactTimeLimitSeconds?: number;
  exactSolver?: "highs" | "cplex";
  /** Per-cell forecast-driven evacuation deadline -- see
   * FeasibilityInput.deadlineWindows. Honored by every tier (exact MILP,
   * neural, greedy), so a cell past its deadline is infeasible no matter
   * which solver routes the cluster. */
  deadlineWindows?: ReadonlyMap<string, RelativeWindow | null>;
}

export interface ClusterRoutingResult {
  method: SolveMethod;
  routesByTeam: Map<number, Route>;
}

/**
 * Picks a solve method for one cluster from its candidate-origin count,
 * then runs it. The exact MILP tier solves every team in the cluster
 * JOINTLY in one model (real multi-van coordination). The neural and
 * greedy tiers solve each team independently, coordinated only through
 * shared `alreadyVisited` exclusion and a running shelter-capacity
 * count -- the same "decomposition" approach already documented in
 * rl/README.md. Genuine joint coordination across ALL teams regardless of
 * tier is Phase 4's job, not this dispatcher's.
 */
export async function routeCluster(input: ClusterRoutingInput): Promise<ClusterRoutingResult> {
  const { cluster, teams, weekday, priorities, riskScores, shelterCapacity, alreadyVisited } = input;
  const thresholds = input.thresholds ?? DEFAULT_CLUSTER_ROUTING_THRESHOLDS;

  const candidateCount = cluster.graph.nodes.filter((n) => n.role === "origin").length;
  const method: SolveMethod =
    candidateCount <= thresholds.maxCandidatesForExact
      ? "exact"
      : candidateCount <= thresholds.maxCandidatesForNeural
        ? "neural"
        : "greedy";

  if (teams.length === 0) return { method, routesByTeam: new Map() };

  if (method === "exact") {
    const candidateOriginIds = cluster.graph.nodes
      .filter((n) => n.role === "origin" && !alreadyVisited?.has(n.id))
      .map((n) => n.id);

    const result = await computeExactPlan({
      graph: cluster.graph,
      depotNodeId: cluster.shelterId,
      teams: teams.map((t) => ({
        teamId: t.teamId,
        currentNodeId: t.currentNodeId,
        remainingMinutes: t.remainingMinutes,
        shiftedGameStartMinutesOfDay: t.shiftedGameStartMinutesOfDay,
        vehicleCapacity: t.vehicleCapacity,
      })),
      candidateOriginIds,
      priorities,
      remainingCapacity: shelterCapacity - input.demandServedSoFar,
      weekday,
      timeLimitSeconds: input.exactTimeLimitSeconds,
      solver: input.exactSolver,
      deadlineWindows: input.deadlineWindows,
    });

    const routesByTeam = new Map(result.plans.map((p) => [p.teamId, p.route]));
    return { method, routesByTeam };
  }

  // Neural and greedy both decompose per-team, sharing an exclusion set
  // (so no two vans in this cluster are offered the same origin) and a
  // running demand-served count (so shelter capacity is respected across
  // the whole cluster, not reset per team).
  const routesByTeam = new Map<number, Route>();
  const visited = new Set<string>(alreadyVisited ?? []);
  let runningDemandServed = input.demandServedSoFar;

  for (const team of teams) {
    const solveInput = {
      graph: cluster.graph,
      currentNodeId: team.currentNodeId,
      depotNodeId: cluster.shelterId,
      totalGameMinutes: team.remainingMinutes,
      gameStartMinutesOfDay: team.shiftedGameStartMinutesOfDay,
      weekday,
      priorities,
      riskScores,
      demandServedSoFar: runningDemandServed,
      shelterCapacity,
      alreadyVisited: visited,
      vehicleCapacity: team.vehicleCapacity,
      deadlineWindows: input.deadlineWindows,
    };

    const route =
      method === "neural"
        ? await computeNeuralRoute(solveInput)
        : computeBaselineRoute(solveInput);

    routesByTeam.set(team.teamId, route);
    for (const stop of route.stops) visited.add(stop.nodeId);
    runningDemandServed += route.totalDemandServed;
  }

  return { method, routesByTeam };
}

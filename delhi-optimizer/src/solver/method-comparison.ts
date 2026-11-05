import type { Graph, Weekday } from "@/types/graph";
import { computeBaselineRoute } from "@/optimization/baseline-policy";
import { computeNeuralRoute } from "@/rl/beam-search";
import { computeExactPlan } from "./milp";

/**
 * Runs the SAME single-team routing problem through all three solve tiers
 * -- greedy baseline, neural (Pointer Network + beam search), and exact
 * MILP (HiGHS and, optionally, real IBM CPLEX) -- so their rewards can be
 * compared head-to-head on identical input. This is a benchmark/reporting
 * tool, not something any live page's routing decision depends on.
 *
 * `candidateOriginIds` must be kept small (the same scale milp.ts's own
 * header documents, roughly a few dozen) for the exact tiers to return in
 * a page-load-friendly time; callers are responsible for capping it (e.g.
 * the top-N highest-priority origins in a cluster), not this function.
 */
export type ComparisonMethod = "greedy" | "neural" | "exact-highs" | "exact-cplex";

export interface MethodComparisonInput {
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
  /** Capped candidate-origin set the exact tiers are allowed to consider. */
  candidateOriginIds: string[];
  includeCplex?: boolean;
  exactTimeLimitSeconds?: number;
}

export interface MethodComparisonResult {
  method: ComparisonMethod;
  label: string;
  totalReward: number;
  totalDemandServed: number;
  stopsVisited: number;
  computeTimeMs: number;
  status: string;
}

const LABELS: Record<ComparisonMethod, string> = {
  greedy: "Greedy baseline",
  neural: "Neural (Pointer Net + beam search)",
  "exact-highs": "Exact MILP (HiGHS)",
  "exact-cplex": "Exact MILP (CPLEX)",
};

export async function compareMethods(input: MethodComparisonInput): Promise<MethodComparisonResult[]> {
  const {
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
    candidateOriginIds,
  } = input;

  const results: MethodComparisonResult[] = [];

  const decompositionInput = {
    graph,
    currentNodeId,
    depotNodeId,
    totalGameMinutes: remainingMinutes,
    gameStartMinutesOfDay: shiftedGameStartMinutesOfDay,
    weekday,
    priorities,
    riskScores,
    demandServedSoFar,
    shelterCapacity,
  };

  const greedyRoute = computeBaselineRoute(decompositionInput);
  results.push({
    method: "greedy",
    label: LABELS.greedy,
    totalReward: greedyRoute.totalReward,
    totalDemandServed: greedyRoute.totalDemandServed,
    stopsVisited: greedyRoute.stops.length,
    computeTimeMs: greedyRoute.computeTimeMs,
    status: "heuristic",
  });

  const neuralRoute = await computeNeuralRoute(decompositionInput);
  results.push({
    method: "neural",
    label: LABELS.neural,
    totalReward: neuralRoute.totalReward,
    totalDemandServed: neuralRoute.totalDemandServed,
    stopsVisited: neuralRoute.stops.length,
    computeTimeMs: neuralRoute.computeTimeMs,
    status: "heuristic",
  });

  const exactBase = {
    graph,
    depotNodeId,
    teams: [
      {
        teamId: 0,
        currentNodeId,
        remainingMinutes,
        shiftedGameStartMinutesOfDay,
      },
    ],
    candidateOriginIds,
    priorities,
    remainingCapacity: Math.max(0, shelterCapacity - demandServedSoFar),
    weekday,
    timeLimitSeconds: input.exactTimeLimitSeconds,
  };

  const highs = await computeExactPlan({ ...exactBase, solver: "highs" });
  const highsRoute = highs.plans[0]?.route;
  results.push({
    method: "exact-highs",
    label: LABELS["exact-highs"],
    totalReward: highsRoute?.totalReward ?? 0,
    totalDemandServed: highsRoute?.totalDemandServed ?? 0,
    stopsVisited: highsRoute?.stops.length ?? 0,
    computeTimeMs: highs.runtimeMs,
    status: highs.solverStatus,
  });

  if (input.includeCplex) {
    const cplex = await computeExactPlan({ ...exactBase, solver: "cplex" });
    const cplexRoute = cplex.plans[0]?.route;
    results.push({
      method: "exact-cplex",
      label: LABELS["exact-cplex"],
      totalReward: cplexRoute?.totalReward ?? 0,
      totalDemandServed: cplexRoute?.totalDemandServed ?? 0,
      stopsVisited: cplexRoute?.stops.length ?? 0,
      computeTimeMs: cplex.runtimeMs,
      status: cplex.solverStatus,
    });
  }

  return results;
}

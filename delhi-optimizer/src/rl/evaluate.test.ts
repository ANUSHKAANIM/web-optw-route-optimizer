import { describe, it } from "vitest";
import { EVACUATION_NODES, SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { buildGraph } from "@/graph/build-graph";
import { computeBaselineRoute } from "@/optimization/baseline-policy";
import { computeNeuralRoute } from "./beam-search";

/**
 * Reports real numbers comparing the neural-policy+beam-search decomposition
 * against the greedy baseline on the actual evacuation scenario -- no
 * assertions here (correctness is beam-search.test.ts's job). This is the
 * start of the Section 7 evaluation framework: identical scenario, identical
 * constraints, both methods, numbers printed rather than claimed.
 */
const graph = buildGraph(EVACUATION_NODES);
const depotId = SHELTER_DEPOT_ID;
const shelterCapacity = EVACUATION_NODES.find((n) => n.id === depotId)!.capacity;

function priorityScenario(seedOffset: number): Map<string, number> {
  // A simple deterministic perturbation so we're not evaluating on a single
  // fixed priority assignment -- still not a substitute for the real
  // forecast-driven priorities computed by risk-priority-provider.ts.
  return new Map(
    EVACUATION_NODES.map((n, i) => [n.id, Math.max(0, Math.round(n.demand * (0.5 + 0.5 * Math.sin(i + seedOffset))))]),
  );
}
const noRisk = new Map(EVACUATION_NODES.map((n) => [n.id, 0]));

describe("evaluation report: neural+beam vs greedy baseline", () => {
  it("prints total reward, demand served, and latency for both methods across 3 scenarios", async () => {
    for (let scenario = 0; scenario < 3; scenario++) {
      const priorities = priorityScenario(scenario);
      const input = {
        graph,
        currentNodeId: depotId,
        depotNodeId: depotId,
        totalGameMinutes: 600,
        gameStartMinutesOfDay: 9 * 60,
        weekday: "monday" as const,
        priorities,
        riskScores: noRisk,
        demandServedSoFar: 0,
        shelterCapacity,
      };

      const baseline = computeBaselineRoute(input);
      const neural = await computeNeuralRoute({ ...input, beamWidth: 8 });

      console.log(
        `[scenario ${scenario}] baseline: reward=${baseline.totalReward.toFixed(1)} demand=${baseline.totalDemandServed} stops=${baseline.stops.length} ms=${baseline.computeTimeMs}` +
          `  |  neural: reward=${neural.totalReward.toFixed(1)} demand=${neural.totalDemandServed} stops=${neural.stops.length} ms=${neural.computeTimeMs}` +
          `  |  neural/baseline reward ratio=${(neural.totalReward / Math.max(1, baseline.totalReward)).toFixed(3)}`,
      );
    }
  }, 60_000);
});

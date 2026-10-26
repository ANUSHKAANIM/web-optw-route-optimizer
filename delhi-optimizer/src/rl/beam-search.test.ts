import { describe, expect, it } from "vitest";
import { EVACUATION_NODES, SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { buildGraph } from "@/graph/build-graph";
import { computeBaselineRoute } from "@/optimization/baseline-policy";
import { computeNeuralRoute } from "./beam-search";

const graph = buildGraph(EVACUATION_NODES);
const depotId = SHELTER_DEPOT_ID;
const shelterCapacity = EVACUATION_NODES.find((n) => n.id === depotId)!.capacity;

function priorities(): Map<string, number> {
  return new Map(EVACUATION_NODES.map((n) => [n.id, n.demand]));
}
function noRisk(): Map<string, number> {
  return new Map(EVACUATION_NODES.map((n) => [n.id, 0]));
}

const BASE_INPUT = {
  graph,
  currentNodeId: depotId,
  depotNodeId: depotId,
  totalGameMinutes: 600,
  gameStartMinutesOfDay: 9 * 60,
  weekday: "monday" as const,
  priorities: priorities(),
  riskScores: noRisk(),
  demandServedSoFar: 0,
  shelterCapacity,
};

describe("computeNeuralRoute (beam search over the trained PointerNetwork)", () => {
  it("never visits the same node twice and never revisits the shelter mid-route", async () => {
    const route = await computeNeuralRoute({ ...BASE_INPUT, beamWidth: 4 });
    const ids = route.stops.map((s) => s.nodeId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(depotId);
  }, 30_000);

  it("never serves more total demand than the shelter's capacity", async () => {
    const route = await computeNeuralRoute({ ...BASE_INPUT, beamWidth: 4 });
    expect(route.totalDemandServed).toBeLessThanOrEqual(shelterCapacity);
  }, 30_000);

  it("respects origins already evacuated by another team (alreadyVisited)", async () => {
    const alreadyVisited = new Set(["origin_1", "origin_2", "origin_3"]);
    const route = await computeNeuralRoute({ ...BASE_INPUT, beamWidth: 4, alreadyVisited });
    const ids = route.stops.map((s) => s.nodeId);
    for (const claimed of alreadyVisited) {
      expect(ids).not.toContain(claimed);
    }
  }, 30_000);

  it("returns an explicit empty route when the budget is too tight for even one stop", async () => {
    const route = await computeNeuralRoute({ ...BASE_INPUT, totalGameMinutes: 5, beamWidth: 4 });
    expect(route.stops).toHaveLength(0);
    expect(route.totalReward).toBe(0);
    expect(route.totalDemandServed).toBe(0);
  }, 30_000);

  it("a wider beam never does worse than beam width 1 (greedy) on the same instance", async () => {
    const greedy = await computeNeuralRoute({ ...BASE_INPUT, beamWidth: 1 });
    const wide = await computeNeuralRoute({ ...BASE_INPUT, beamWidth: 8 });
    expect(wide.totalReward).toBeGreaterThanOrEqual(greedy.totalReward);
  }, 30_000);

  it("is directly comparable against the greedy baseline policy on identical inputs", async () => {
    const neural = await computeNeuralRoute({ ...BASE_INPUT, beamWidth: 8 });
    const baseline = computeBaselineRoute(BASE_INPUT);
    // Not an assertion that one beats the other -- see src/rl/README.md.
    // This test just proves both run to completion on identical scenario
    // inputs and produce directly comparable Route shapes.
    expect(neural.totalReward).toBeGreaterThanOrEqual(0);
    expect(baseline.totalReward).toBeGreaterThanOrEqual(0);
    expect(neural.totalDemandServed).toBeLessThanOrEqual(shelterCapacity);
    expect(baseline.totalDemandServed).toBeLessThanOrEqual(shelterCapacity);
  }, 30_000);
});

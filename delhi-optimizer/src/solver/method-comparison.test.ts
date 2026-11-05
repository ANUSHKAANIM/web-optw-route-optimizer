import { describe, expect, it } from "vitest";
import { EVACUATION_NODES, SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { buildGraph } from "@/graph/build-graph";
import { compareMethods } from "./method-comparison";

const graph = buildGraph(EVACUATION_NODES);
const depotId = SHELTER_DEPOT_ID;
const shelterCapacity = EVACUATION_NODES.find((n) => n.id === depotId)!.capacity;
const originIds = EVACUATION_NODES.filter((n) => n.role === "origin").map((n) => n.id);

function priorities(): Map<string, number> {
  return new Map(EVACUATION_NODES.map((n) => [n.id, n.demand]));
}
function noRisk(): Map<string, number> {
  return new Map(EVACUATION_NODES.map((n) => [n.id, 0]));
}

const BASE = {
  graph,
  currentNodeId: depotId,
  depotNodeId: depotId,
  remainingMinutes: 600,
  shiftedGameStartMinutesOfDay: 9 * 60,
  weekday: "monday" as const,
  priorities: priorities(),
  riskScores: noRisk(),
  demandServedSoFar: 0,
  shelterCapacity,
  candidateOriginIds: originIds,
  exactTimeLimitSeconds: 15,
};

describe("compareMethods", () => {
  it("returns one result per requested method, in a stable order", async () => {
    const results = await compareMethods(BASE);
    expect(results.map((r) => r.method)).toEqual(["greedy", "neural", "exact-highs"]);
  }, 60_000);

  it("includes CPLEX only when explicitly requested", async () => {
    const results = await compareMethods({ ...BASE, includeCplex: true });
    expect(results.map((r) => r.method)).toEqual(["greedy", "neural", "exact-highs", "exact-cplex"]);
  }, 60_000);

  it("every method reports a non-negative reward and demand served", async () => {
    const results = await compareMethods(BASE);
    for (const r of results) {
      expect(r.totalReward).toBeGreaterThanOrEqual(0);
      expect(r.totalDemandServed).toBeGreaterThanOrEqual(0);
      expect(r.computeTimeMs).toBeGreaterThanOrEqual(0);
    }
  }, 60_000);

  it("the exact MILP tier never scores worse than greedy or neural on the same problem", async () => {
    const results = await compareMethods(BASE);
    const exact = results.find((r) => r.method === "exact-highs")!;
    const greedy = results.find((r) => r.method === "greedy")!;
    const neural = results.find((r) => r.method === "neural")!;
    // Exact is only a true upper bound when it actually closed to optimal --
    // under a time limit it can report a sound but non-optimal incumbent.
    if (exact.status.toLowerCase().includes("optimal")) {
      expect(exact.totalReward).toBeGreaterThanOrEqual(greedy.totalReward);
      expect(exact.totalReward).toBeGreaterThanOrEqual(neural.totalReward);
    }
  }, 60_000);

  it("reports CPLEX as unavailable rather than crashing when no license is installed", async () => {
    const results = await compareMethods({ ...BASE, includeCplex: true });
    const cplex = results.find((r) => r.method === "exact-cplex")!;
    expect(typeof cplex.status).toBe("string");
    expect(cplex.totalReward).toBeGreaterThanOrEqual(0);
  }, 60_000);
});

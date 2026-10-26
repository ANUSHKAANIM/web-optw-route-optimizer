import { describe, expect, it } from "vitest";
import { EVACUATION_NODES, SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { buildGraph } from "@/graph/build-graph";
import { computeBaselineRoute } from "./baseline-policy";

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

describe("computeBaselineRoute", () => {
  it("never visits the same node twice and never revisits the shelter mid-route", () => {
    const route = computeBaselineRoute(BASE_INPUT);
    const ids = route.stops.map((s) => s.nodeId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(depotId);
  });

  it("reports real, non-zero total distance when it visits at least one place", () => {
    const route = computeBaselineRoute(BASE_INPUT);
    expect(route.stops.length).toBeGreaterThan(0);
    expect(route.totalDistanceKm).toBeGreaterThan(0);
  });

  it("stays within the total game time budget including the return to the shelter", () => {
    const route = computeBaselineRoute({ ...BASE_INPUT, totalGameMinutes: 240 });
    expect(route.totalTravelMinutes).toBeLessThanOrEqual(240 + 1e-6);
  });

  it("visits nothing when the budget is too tight for even one stop and back", () => {
    const route = computeBaselineRoute({ ...BASE_INPUT, totalGameMinutes: 5 });
    expect(route.stops).toHaveLength(0);
    expect(route.totalReward).toBe(0);
    expect(route.totalDemandServed).toBe(0);
  });

  it("never serves more total demand than the shelter's capacity", () => {
    const route = computeBaselineRoute(BASE_INPUT);
    expect(route.totalDemandServed).toBeLessThanOrEqual(shelterCapacity);
  });

  it("totalDemandServed matches the sum of each stop's demandServed", () => {
    const route = computeBaselineRoute(BASE_INPUT);
    const sum = route.stops.reduce((acc, s) => acc + s.demandServed, 0);
    expect(route.totalDemandServed).toBe(sum);
  });

  it("stops early once remaining shelter capacity can't fit any more origins", () => {
    // Pre-fill capacity so only a small amount remains -- fewer than every
    // origin's demand, so at least one origin must become infeasible.
    const smallestDemand = Math.min(...EVACUATION_NODES.filter((n) => n.role === "origin").map((n) => n.demand));
    const route = computeBaselineRoute({
      ...BASE_INPUT,
      demandServedSoFar: shelterCapacity - smallestDemand + 1, // nothing fits anymore
    });
    expect(route.stops).toHaveLength(0);
  });

  it("prefers a much higher-priority node even against density tie-breaks", () => {
    const boosted = new Map(EVACUATION_NODES.map((n) => [n.id, n.demand]));
    const target = EVACUATION_NODES.find((n) => n.role === "origin" && n.id !== "origin_1")!.id;
    boosted.set(target, 5000);
    const route = computeBaselineRoute({ ...BASE_INPUT, priorities: boosted });
    expect(route.stops[0]?.nodeId).toBe(target);
  });
});

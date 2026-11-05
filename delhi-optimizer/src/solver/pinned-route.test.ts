import { describe, expect, it } from "vitest";
import { EVACUATION_NODES, SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { buildGraph } from "@/graph/build-graph";
import { routeTeamWithPin } from "./pinned-route";

const graph = buildGraph(EVACUATION_NODES);
const depotId = SHELTER_DEPOT_ID;
const shelterCapacity = EVACUATION_NODES.find((n) => n.id === depotId)!.capacity;
const SOME_ORIGIN = EVACUATION_NODES.find((n) => n.role === "origin")!.id;

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
};

describe("routeTeamWithPin (greedy continuation)", () => {
  it("honors a reachable pin as the route's first stop", async () => {
    const result = await routeTeamWithPin({ ...BASE, pinnedCellId: SOME_ORIGIN, method: "greedy" });
    expect(result.pinHonored).toBe(true);
    expect(result.route.stops[0]?.nodeId).toBe(SOME_ORIGIN);
  });

  it("never revisits the pinned cell in the continuation", async () => {
    const result = await routeTeamWithPin({ ...BASE, pinnedCellId: SOME_ORIGIN, method: "greedy" });
    const ids = result.route.stops.map((s) => s.nodeId);
    expect(ids.filter((id) => id === SOME_ORIGIN)).toHaveLength(1);
  });

  it("falls back to an un-pinned solve, not a thrown error, when the pinned cell is already visited", async () => {
    const result = await routeTeamWithPin({
      ...BASE,
      pinnedCellId: SOME_ORIGIN,
      alreadyVisited: new Set([SOME_ORIGIN]),
      method: "greedy",
    });
    expect(result.pinHonored).toBe(false);
    expect(result.route.stops.map((s) => s.nodeId)).not.toContain(SOME_ORIGIN);
  });

  it("falls back to an un-pinned solve when the remaining budget can't reach the pin at all", async () => {
    const result = await routeTeamWithPin({ ...BASE, remainingMinutes: 1, pinnedCellId: SOME_ORIGIN, method: "greedy" });
    expect(result.pinHonored).toBe(false);
  });

  it("includes the pinned demand toward the shelter-capacity check for the continuation", async () => {
    const result = await routeTeamWithPin({ ...BASE, pinnedCellId: SOME_ORIGIN, method: "greedy" });
    expect(result.route.totalDemandServed).toBeLessThanOrEqual(shelterCapacity);
  });
});

describe("routeTeamWithPin (neural continuation)", () => {
  it("honors a reachable pin and still returns a valid continuation via the real RL path", async () => {
    const result = await routeTeamWithPin({ ...BASE, pinnedCellId: SOME_ORIGIN, method: "neural" });
    expect(result.pinHonored).toBe(true);
    expect(result.route.stops[0]?.nodeId).toBe(SOME_ORIGIN);
  }, 30_000);
});

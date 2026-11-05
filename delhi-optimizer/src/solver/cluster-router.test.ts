import { describe, expect, it } from "vitest";
import { EVACUATION_NODES, SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { buildGraph } from "@/graph/build-graph";
import type { GraphCluster } from "@/graph/spatial-clustering";
import { routeCluster, type ClusterTeam } from "./cluster-router";

const graph = buildGraph(EVACUATION_NODES);
const depotId = SHELTER_DEPOT_ID;
const shelterCapacity = EVACUATION_NODES.find((n) => n.id === depotId)!.capacity;
const ORIGIN_COUNT = EVACUATION_NODES.filter((n) => n.role === "origin").length;

const cluster: GraphCluster = { shelterId: depotId, graph };

function priorities(): Map<string, number> {
  return new Map(EVACUATION_NODES.map((n) => [n.id, n.demand]));
}
function noRisk(): Map<string, number> {
  return new Map(EVACUATION_NODES.map((n) => [n.id, 0]));
}

function oneTeam(): ClusterTeam[] {
  return [{ teamId: 1, currentNodeId: depotId, remainingMinutes: 600, shiftedGameStartMinutesOfDay: 9 * 60 }];
}

const BASE = {
  cluster,
  weekday: "monday" as const,
  priorities: priorities(),
  riskScores: noRisk(),
  demandServedSoFar: 0,
  shelterCapacity,
};

describe("routeCluster method selection", () => {
  it("picks exact when candidate count is within the exact threshold", async () => {
    const result = await routeCluster({
      ...BASE,
      teams: oneTeam(),
      thresholds: { maxCandidatesForExact: ORIGIN_COUNT, maxCandidatesForNeural: ORIGIN_COUNT },
      exactTimeLimitSeconds: 15,
    });
    expect(result.method).toBe("exact");
  }, 30_000);

  it("picks neural when candidate count exceeds the exact threshold but not the neural one", async () => {
    const result = await routeCluster({
      ...BASE,
      teams: oneTeam(),
      thresholds: { maxCandidatesForExact: 0, maxCandidatesForNeural: ORIGIN_COUNT },
    });
    expect(result.method).toBe("neural");
  }, 30_000);

  it("falls back to greedy when candidate count exceeds both thresholds", async () => {
    const result = await routeCluster({
      ...BASE,
      teams: oneTeam(),
      thresholds: { maxCandidatesForExact: 0, maxCandidatesForNeural: 0 },
    });
    expect(result.method).toBe("greedy");
  });

  it("returns an empty route map without solving anything when there are no teams", async () => {
    const result = await routeCluster({ ...BASE, teams: [] });
    expect(result.routesByTeam.size).toBe(0);
  });
});

describe("routeCluster greedy tier", () => {
  it("gives every team a route and never assigns the same origin to two teams", async () => {
    const teams: ClusterTeam[] = [
      { teamId: 1, currentNodeId: depotId, remainingMinutes: 600, shiftedGameStartMinutesOfDay: 9 * 60 },
      { teamId: 2, currentNodeId: depotId, remainingMinutes: 600, shiftedGameStartMinutesOfDay: 9 * 60 },
    ];
    const result = await routeCluster({
      ...BASE,
      teams,
      thresholds: { maxCandidatesForExact: 0, maxCandidatesForNeural: 0 },
    });

    expect(result.routesByTeam.size).toBe(2);
    const assigned = Array.from(result.routesByTeam.values()).flatMap((r) => r.stops.map((s) => s.nodeId));
    expect(new Set(assigned).size).toBe(assigned.length);
  });

  it("respects alreadyVisited across the whole cluster", async () => {
    const alreadyVisited = new Set(["origin_1", "origin_2", "origin_3"]);
    const result = await routeCluster({
      ...BASE,
      teams: oneTeam(),
      thresholds: { maxCandidatesForExact: 0, maxCandidatesForNeural: 0 },
      alreadyVisited,
    });
    const assigned = Array.from(result.routesByTeam.values()).flatMap((r) => r.stops.map((s) => s.nodeId));
    for (const claimed of alreadyVisited) expect(assigned).not.toContain(claimed);
  });
});

describe("routeCluster neural tier", () => {
  it("gives every team a route via the real RL beam search path", async () => {
    const result = await routeCluster({
      ...BASE,
      teams: oneTeam(),
      thresholds: { maxCandidatesForExact: 0, maxCandidatesForNeural: ORIGIN_COUNT },
    });
    expect(result.method).toBe("neural");
    expect(result.routesByTeam.size).toBe(1);
  }, 30_000);
});

describe("routeCluster exact tier", () => {
  it("jointly solves every team in one model and never double-assigns an origin", async () => {
    const teams: ClusterTeam[] = [
      { teamId: 1, currentNodeId: depotId, remainingMinutes: 600, shiftedGameStartMinutesOfDay: 9 * 60 },
      { teamId: 2, currentNodeId: depotId, remainingMinutes: 600, shiftedGameStartMinutesOfDay: 9 * 60 },
    ];
    const result = await routeCluster({
      ...BASE,
      teams,
      thresholds: { maxCandidatesForExact: ORIGIN_COUNT, maxCandidatesForNeural: ORIGIN_COUNT },
      exactTimeLimitSeconds: 15,
    });
    expect(result.method).toBe("exact");
    const assigned = Array.from(result.routesByTeam.values()).flatMap((r) => r.stops.map((s) => s.nodeId));
    expect(new Set(assigned).size).toBe(assigned.length);
  }, 30_000);
});

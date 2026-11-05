import { describe, expect, it } from "vitest";
import { EVACUATION_NODES, SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { buildGraph } from "@/graph/build-graph";
import type { GraphCluster } from "@/graph/spatial-clustering";
import type { ClusterTeam } from "./cluster-router";
import { resolveTeamProcessingOrder } from "./contested-cell-arbitration";

const graph = buildGraph(EVACUATION_NODES);
const depotId = SHELTER_DEPOT_ID;
const cluster: GraphCluster = { shelterId: depotId, graph };

function priorities(): Map<string, number> {
  return new Map(EVACUATION_NODES.map((n) => [n.id, n.demand]));
}

describe("resolveTeamProcessingOrder", () => {
  it("gives first pick to whichever team is actually closest to the single highest-priority origin", () => {
    const prios = priorities();
    const topOrigin = Array.from(prios.entries())
      .filter(([id]) => id !== depotId)
      .sort((a, b) => b[1] - a[1])[0][0];

    // Team "far" starts at the depot; team "near" starts AT the top
    // origin itself, so its travel time there is zero -- it must win
    // first pick regardless of array order.
    const teamFar: ClusterTeam = { teamId: 1, currentNodeId: depotId, remainingMinutes: 600, shiftedGameStartMinutesOfDay: 9 * 60 };
    const teamNear: ClusterTeam = { teamId: 2, currentNodeId: topOrigin, remainingMinutes: 600, shiftedGameStartMinutesOfDay: 9 * 60 };

    const order = resolveTeamProcessingOrder(cluster, [teamFar, teamNear], prios);
    expect(order[0].teamId).toBe(2);
  });

  it("preserves every team exactly once, even when there are more teams than reachable origins", () => {
    const prios = priorities();
    const teams: ClusterTeam[] = Array.from({ length: 20 }, (_, i) => ({
      teamId: i,
      currentNodeId: depotId,
      remainingMinutes: 600,
      shiftedGameStartMinutesOfDay: 9 * 60,
    }));

    const order = resolveTeamProcessingOrder(cluster, teams, prios);
    expect(order).toHaveLength(teams.length);
    expect(new Set(order.map((t) => t.teamId)).size).toBe(teams.length);
  });

  it("returns an empty order for an empty team list", () => {
    expect(resolveTeamProcessingOrder(cluster, [], priorities())).toHaveLength(0);
  });

  it("appends a team with no time budget to reach anything at the end, not dropped", () => {
    const prios = priorities();
    const strandedTeam: ClusterTeam = { teamId: 99, currentNodeId: depotId, remainingMinutes: 0, shiftedGameStartMinutesOfDay: 9 * 60 };
    const normalTeam: ClusterTeam = { teamId: 1, currentNodeId: depotId, remainingMinutes: 600, shiftedGameStartMinutesOfDay: 9 * 60 };

    const order = resolveTeamProcessingOrder(cluster, [strandedTeam, normalTeam], prios);
    expect(order.map((t) => t.teamId)).toContain(99);
    expect(order).toHaveLength(2);
  });
});

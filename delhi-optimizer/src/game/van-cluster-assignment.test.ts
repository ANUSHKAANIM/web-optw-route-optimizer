import { describe, expect, it } from "vitest";
import { SyntheticCellProvider } from "@/data/synthetic-cell-provider";
import { buildClusteredGraph } from "@/graph/spatial-clustering";
import { planeDistanceKm } from "@/graph/plane-distance";
import { assignVansToClusters, assignVansToClustersByReward, type VanPosition } from "./van-cluster-assignment";

describe("assignVansToClusters", () => {
  it("assigns every van to exactly one cluster, preserving the total count", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 1000, clusterCount: 20 }).getNodes();
    const clusters = buildClusteredGraph(nodes);
    const vans: VanPosition[] = Array.from({ length: 15 }, (_, i) => ({
      vanId: i,
      x: (Math.random() - 0.5) * 600,
      y: (Math.random() - 0.5) * 600,
    }));

    const assignment = assignVansToClusters(vans, clusters);
    const total = Array.from(assignment.values()).reduce((sum, v) => sum + v.length, 0);
    expect(total).toBe(vans.length);
  });

  it("assigns a van to the cluster whose shelter is actually nearest to it", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 500, clusterCount: 10 }).getNodes();
    const clusters = buildClusteredGraph(nodes);
    const targetCluster = clusters[3];
    const shelter = targetCluster.graph.nodesById.get(targetCluster.shelterId)!;

    // Place a van essentially on top of one shelter -- it must be assigned
    // to that shelter's cluster.
    const van: VanPosition = { vanId: 0, x: shelter.x, y: shelter.y };
    const assignment = assignVansToClusters([van], clusters);

    expect(assignment.get(targetCluster.shelterId)).toEqual([van]);
    for (const [shelterId, vans] of assignment) {
      if (shelterId !== targetCluster.shelterId) expect(vans).toHaveLength(0);
    }
  });

  it("returns an empty assignment for an empty van list without throwing", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 300, clusterCount: 5 }).getNodes();
    const clusters = buildClusteredGraph(nodes);
    const assignment = assignVansToClusters([], clusters);
    const total = Array.from(assignment.values()).reduce((sum, v) => sum + v.length, 0);
    expect(total).toBe(0);
  });
});

describe("assignVansToClustersByReward", () => {
  it("assigns every van to exactly one cluster, preserving the total count", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 1000, clusterCount: 20 }).getNodes();
    const clusters = buildClusteredGraph(nodes);
    const vans: VanPosition[] = Array.from({ length: 15 }, (_, i) => ({
      vanId: i,
      x: (Math.random() - 0.5) * 600,
      y: (Math.random() - 0.5) * 600,
    }));
    const remaining = new Map(vans.map((v) => [v.vanId, 1000]));

    const assignment = assignVansToClustersByReward(vans, clusters, new Map(), remaining);
    const total = Array.from(assignment.values()).reduce((sum, v) => sum + v.length, 0);
    expect(total).toBe(vans.length);
  });

  it("returns an empty assignment for an empty van list without throwing", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 300, clusterCount: 5 }).getNodes();
    const clusters = buildClusteredGraph(nodes);
    const assignment = assignVansToClustersByReward([], clusters, new Map(), new Map());
    const total = Array.from(assignment.values()).reduce((sum, v) => sum + v.length, 0);
    expect(total).toBe(0);
  });

  it("sends a van to a farther but much richer zone over its own nearest, poorer zone, when reachable within budget", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 1000, clusterCount: 20 }).getNodes();
    const clusters = buildClusteredGraph(nodes);
    const nearCluster = clusters[0];
    const richCluster = clusters[5];
    const nearShelter = nearCluster.graph.nodesById.get(nearCluster.shelterId)!;
    const richShelter = richCluster.graph.nodesById.get(richCluster.shelterId)!;

    const van: VanPosition = { vanId: 0, x: nearShelter.x, y: nearShelter.y }; // sitting on nearCluster's shelter
    const travelMinutesToRich = (planeDistanceKm([van.x, van.y], [richShelter.x, richShelter.y]) / 22) * 60;

    const reward = new Map<string, number>([
      [nearCluster.shelterId, 1],
      [richCluster.shelterId, 100_000], // overwhelmingly more valuable
    ]);
    const remaining = new Map([[0, travelMinutesToRich * 2 + 60]]); // just enough round trip, plus slack

    const assignment = assignVansToClustersByReward([van], clusters, reward, remaining);
    expect(assignment.get(richCluster.shelterId)).toEqual([van]);
    expect(assignment.get(nearCluster.shelterId)).toEqual([]);
  });

  it("falls back to the nearest shelter when no candidate is reachable within the van's remaining budget", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 500, clusterCount: 10 }).getNodes();
    const clusters = buildClusteredGraph(nodes);
    const targetCluster = clusters[3];
    const shelter = targetCluster.graph.nodesById.get(targetCluster.shelterId)!;

    const van: VanPosition = { vanId: 0, x: shelter.x, y: shelter.y };
    const remaining = new Map([[0, -1]]); // negative budget -- no candidate (not even its own 0-distance shelter) passes the feasibility gate

    const assignment = assignVansToClustersByReward([van], clusters, new Map(), remaining);
    expect(assignment.get(targetCluster.shelterId)).toEqual([van]);
  });

  it("spreads two vans across two equally rich, equally reachable zones instead of stacking both on one", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 1000, clusterCount: 20 }).getNodes();
    const clusters = buildClusteredGraph(nodes);
    const clusterA = clusters[0];
    const clusterB = clusters[1];
    const shelterA = clusterA.graph.nodesById.get(clusterA.shelterId)!;
    const shelterB = clusterB.graph.nodesById.get(clusterB.shelterId)!;

    // Both vans sit exactly at the midpoint -- equidistant from both
    // shelters, so travel time alone can't explain the outcome.
    const midpoint: VanPosition = { vanId: -1, x: (shelterA.x + shelterB.x) / 2, y: (shelterA.y + shelterB.y) / 2 };
    const vans: VanPosition[] = [
      { vanId: 0, x: midpoint.x, y: midpoint.y },
      { vanId: 1, x: midpoint.x, y: midpoint.y },
    ];
    const reward = new Map([
      [clusterA.shelterId, 500],
      [clusterB.shelterId, 500],
    ]);
    const remaining = new Map([
      [0, 100_000],
      [1, 100_000],
    ]);

    const assignment = assignVansToClustersByReward(vans, clusters, reward, remaining);
    const countA = assignment.get(clusterA.shelterId)?.length ?? 0;
    const countB = assignment.get(clusterB.shelterId)?.length ?? 0;
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });
});

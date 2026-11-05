import { describe, expect, it } from "vitest";
import { SyntheticCellProvider } from "@/data/synthetic-cell-provider";
import { clusterByNearestShelter, buildClusteredGraph } from "./spatial-clustering";

describe("clusterByNearestShelter", () => {
  it("assigns every node to exactly one cluster and preserves the total count", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 2000, clusterCount: 50 }).getNodes();
    const clusters = clusterByNearestShelter(nodes);
    const total = Array.from(clusters.values()).reduce((sum, c) => sum + c.length, 0);
    expect(total).toBe(nodes.length);
    expect(clusters.size).toBe(50);
  });

  it("puts each shelter in its own cluster, and only origins elsewhere", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 2000, clusterCount: 50 }).getNodes();
    const clusters = clusterByNearestShelter(nodes);
    for (const [shelterId, clusterNodes] of clusters) {
      const shelters = clusterNodes.filter((n) => n.role === "shelter");
      expect(shelters).toHaveLength(1);
      expect(shelters[0].id).toBe(shelterId);
    }
  });

  it("assigns each origin to the shelter that is actually nearest to it", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 500, clusterCount: 10 }).getNodes();
    const shelters = nodes.filter((n) => n.role === "shelter");
    const clusters = clusterByNearestShelter(nodes);

    for (const [shelterId, clusterNodes] of clusters) {
      const shelter = shelters.find((s) => s.id === shelterId)!;
      for (const origin of clusterNodes.filter((n) => n.role === "origin")) {
        const distToOwnShelter = Math.hypot(origin.x - shelter.x, origin.y - shelter.y);
        for (const other of shelters) {
          const distToOther = Math.hypot(origin.x - other.x, origin.y - other.y);
          expect(distToOwnShelter).toBeLessThanOrEqual(distToOther + 1e-9);
        }
      }
    }
  });

  it("throws if there is no shelter at all", () => {
    expect(() => clusterByNearestShelter([])).toThrow();
  });
});

describe("buildClusteredGraph", () => {
  it("returns one connected, internally-consistent Graph per cluster", () => {
    const nodes = new SyntheticCellProvider({ cellCount: 1000, clusterCount: 20 }).getNodes();
    const clusters = buildClusteredGraph(nodes);
    expect(clusters).toHaveLength(20);

    const totalClusteredNodes = clusters.reduce((sum, c) => sum + c.graph.nodes.length, 0);
    expect(totalClusteredNodes).toBe(nodes.length);

    for (const cluster of clusters) {
      expect(cluster.graph.nodesById.size).toBe(cluster.graph.nodes.length);
      // Every cluster's dense matrix only ever references its own nodes.
      for (const row of cluster.graph.travelTimeMinutes.values()) {
        expect(row.size).toBe(cluster.graph.nodes.length);
      }
    }
  });

  it(
    "scales to the full 20,000-node default scenario in low seconds, not minutes",
    () => {
      const nodes = new SyntheticCellProvider().getNodes(); // default: 20,000 cells, 250 clusters
      const start = Date.now();
      const clusters = buildClusteredGraph(nodes);
      const elapsedMs = Date.now() - start;

      expect(clusters.length).toBe(250);
      const totalClusteredNodes = clusters.reduce((sum, c) => sum + c.graph.nodes.length, 0);
      expect(totalClusteredNodes).toBe(nodes.length);

      // Generous ceiling -- this is a scale smoke test, not a strict perf
      // budget. The real exit criterion is "doesn't fall over," not a
      // specific millisecond target. Measured 2.9s in isolation, but 26.6s
      // was observed running alongside the full suite AND a live dev
      // server under heavy concurrent load -- 60s gives real headroom for
      // a busy shared machine without weakening what this test actually
      // checks (it still fails outright if clustering genuinely hangs or
      // regresses to minutes). The vitest per-test default (5s) is far too
      // tight for this, hence the explicit 90s test timeout below.
      expect(elapsedMs).toBeLessThan(60000);
    },
    90000,
  );
});

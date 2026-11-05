import { describe, expect, it } from "vitest";
import { isValidCoordinate } from "@/graph/plane-distance";
import { SyntheticCellProvider, DEFAULT_SYNTHETIC_CONFIG } from "./synthetic-cell-provider";

describe("SyntheticCellProvider", () => {
  it("generates the configured total node count", () => {
    const provider = new SyntheticCellProvider({ cellCount: 2000, clusterCount: 50 });
    expect(provider.getNodes()).toHaveLength(2000);
  });

  it("generates exactly one shelter per cluster", () => {
    const provider = new SyntheticCellProvider({ cellCount: 2000, clusterCount: 50 });
    const nodes = provider.getNodes();
    expect(nodes.filter((n) => n.role === "shelter")).toHaveLength(50);
  });

  it("has unique ids across shelters and origins", () => {
    const provider = new SyntheticCellProvider({ cellCount: 2000, clusterCount: 50 });
    const nodes = provider.getNodes();
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
  });

  it("gives every origin positive demand and zero capacity, and every shelter the reverse", () => {
    const provider = new SyntheticCellProvider({ cellCount: 2000, clusterCount: 50 });
    for (const node of provider.getNodes()) {
      if (node.role === "origin") {
        expect(node.demand).toBeGreaterThan(0);
        expect(node.capacity).toBe(0);
      } else {
        expect(node.capacity).toBeGreaterThan(0);
        expect(node.demand).toBe(0);
      }
    }
  });

  it("has valid, finite abstract-plane coordinates within the configured bounds", () => {
    const provider = new SyntheticCellProvider({ cellCount: 2000, clusterCount: 50, planeHalfSizeKm: 300 });
    for (const node of provider.getNodes()) {
      expect(isValidCoordinate([node.x, node.y])).toBe(true);
      // Gaussian jitter can push a village slightly outside the nominal
      // bound, but never by more than a few cluster-jitter standard
      // deviations -- this just guards against a broken generator, not a
      // precise fence.
      expect(Math.abs(node.x)).toBeLessThan(400);
      expect(Math.abs(node.y)).toBeLessThan(400);
    }
  });

  it("is deterministic for a given seed", () => {
    const a = new SyntheticCellProvider({ cellCount: 500, clusterCount: 10, seed: 7 }).getNodes();
    const b = new SyntheticCellProvider({ cellCount: 500, clusterCount: 10, seed: 7 }).getNodes();
    expect(a).toEqual(b);
  });

  it("produces a different scenario for a different seed", () => {
    const a = new SyntheticCellProvider({ cellCount: 500, clusterCount: 10, seed: 1 }).getNodes();
    const b = new SyntheticCellProvider({ cellCount: 500, clusterCount: 10, seed: 2 }).getNodes();
    expect(a).not.toEqual(b);
  });

  it("uses the default config at full 20,000-cell scale without throwing", () => {
    const provider = new SyntheticCellProvider();
    const nodes = provider.getNodes();
    expect(nodes).toHaveLength(DEFAULT_SYNTHETIC_CONFIG.cellCount);
    expect(nodes.filter((n) => n.role === "shelter")).toHaveLength(DEFAULT_SYNTHETIC_CONFIG.clusterCount);
  });
});

import { describe, expect, it } from "vitest";
import { EVACUATION_NODES } from "@/data/evacuation-nodes";
import { buildGraph, buildVisualEdges, assertConnected } from "./build-graph";

describe("buildGraph", () => {
  it("includes every node and a dense travel-time matrix", () => {
    const graph = buildGraph(EVACUATION_NODES);
    expect(graph.nodes).toHaveLength(EVACUATION_NODES.length);
    for (const from of graph.nodes) {
      for (const to of graph.nodes) {
        expect(graph.travelTimeMinutes.get(from.id)?.get(to.id)).toBeDefined();
      }
    }
  });

  it("has a zero-diagonal, symmetric travel-time matrix", () => {
    const graph = buildGraph(EVACUATION_NODES);
    for (const a of graph.nodes) {
      expect(graph.travelTimeMinutes.get(a.id)?.get(a.id)).toBe(0);
      for (const b of graph.nodes) {
        const ab = graph.travelTimeMinutes.get(a.id)?.get(b.id) ?? -1;
        const ba = graph.travelTimeMinutes.get(b.id)?.get(a.id) ?? -1;
        expect(ab).toBeCloseTo(ba, 9);
      }
    }
  });

  it("produces a connected but sparse visual graph", () => {
    const graph = buildGraph(EVACUATION_NODES);
    const completeEdgeCount = (EVACUATION_NODES.length * (EVACUATION_NODES.length - 1)) / 2;
    expect(graph.edges.length).toBeLessThan(completeEdgeCount);
    expect(() => assertConnected(graph.nodes, graph.edges)).not.toThrow();
  });

  it("throws for a genuinely disconnected edge set", () => {
    expect(() =>
      assertConnected(EVACUATION_NODES, [{ from: EVACUATION_NODES[0].id, to: EVACUATION_NODES[1].id, distanceKm: 1, travelTimeMinutes: 3 }]),
    ).toThrow();
  });
});

describe("buildVisualEdges", () => {
  it("repairs disconnected clusters into one connected graph", () => {
    const cluster = [
      ...EVACUATION_NODES.slice(0, 3),
      // A far-away point (outside the cluster) to force a separate component.
      { ...EVACUATION_NODES[3], id: "far_away", x: 500, y: 500 },
    ];
    const edges = buildVisualEdges(cluster);
    expect(() => assertConnected(cluster, edges)).not.toThrow();
  });
});

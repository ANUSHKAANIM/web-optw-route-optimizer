import { describe, expect, it } from "vitest";
import { assertConnected, buildTravelTimeMatrix, buildVisualGraph } from "./graph";

function randomCoords(n: number, seed = 1): [number, number][] {
  let state = seed;
  const rand = () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
  return Array.from({ length: n }, () => [28 + rand() * 0.5, 77 + rand() * 0.5] as [number, number]);
}

describe("buildTravelTimeMatrix", () => {
  it("is symmetric with a zero diagonal", () => {
    const matrix = buildTravelTimeMatrix(randomCoords(10));
    for (let i = 0; i < matrix.length; i++) {
      expect(matrix[i][i]).toBe(0);
      for (let j = 0; j < matrix.length; j++) {
        expect(matrix[i][j]).toBeCloseTo(matrix[j][i], 9);
      }
    }
  });

  it("produces strictly positive travel time between distinct points", () => {
    const matrix = buildTravelTimeMatrix(randomCoords(5));
    expect(matrix[0][1]).toBeGreaterThan(0);
  });
});

describe("buildVisualGraph", () => {
  it("connects every node without needing repair, for a small random set", () => {
    const coords = randomCoords(20, 7);
    const edges = buildVisualGraph(coords);
    expect(() => assertConnected(coords.length, edges)).not.toThrow();
  });

  it("stays sparse -- far fewer edges than a complete graph, for a larger set", () => {
    const coords = randomCoords(80, 3);
    const edges = buildVisualGraph(coords);
    const completeGraphEdgeCount = (80 * 79) / 2;
    expect(edges.length).toBeLessThan(completeGraphEdgeCount / 4);
    expect(() => assertConnected(coords.length, edges)).not.toThrow();
  });

  it("repairs two disconnected clusters into one connected graph", () => {
    const clusterA: [number, number][] = Array.from({ length: 5 }, (_, i) => [28.6 + i * 0.001, 77.2 + i * 0.001]);
    const clusterB: [number, number][] = Array.from({ length: 5 }, (_, i) => [12.9 + i * 0.001, 77.6 + i * 0.001]);
    const coords = [...clusterA, ...clusterB];
    const edges = buildVisualGraph(coords);
    expect(() => assertConnected(coords.length, edges)).not.toThrow();
  });
});

describe("assertConnected", () => {
  it("throws for a genuinely disconnected graph", () => {
    expect(() => assertConnected(4, [{ from: 0, to: 1, distanceKm: 1 }])).toThrow();
  });
});

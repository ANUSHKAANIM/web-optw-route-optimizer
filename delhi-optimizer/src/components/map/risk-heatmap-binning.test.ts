import { describe, expect, it } from "vitest";
import type { GraphNode, OpeningHours } from "@/types/graph";
import { buildHeatmapGrid, type BinCellInput } from "./risk-heatmap-binning";

function alwaysAccessible(): OpeningHours {
  const day = { open: "00:00", close: "23:59" };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
}

function makeNode(id: string, x: number, y: number): GraphNode {
  return {
    id,
    name: id,
    x,
    y,
    role: "origin",
    demand: 100,
    capacity: 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 15,
  };
}

describe("buildHeatmapGrid", () => {
  it("returns an empty grid for no cells", () => {
    const grid = buildHeatmapGrid([], 10);
    expect(grid.bins).toHaveLength(0);
  });

  it("groups cells within the same bin size into one bin", () => {
    const cells: BinCellInput[] = [
      { node: makeNode("a", 1, 1), tier: "normal", riskScore: 0.1 },
      { node: makeNode("b", 2, 2), tier: "normal", riskScore: 0.2 },
      { node: makeNode("c", 4, 4), tier: "normal", riskScore: 0.3 },
    ];
    const grid = buildHeatmapGrid(cells, 10); // all three fall in a single 10km bin
    expect(grid.bins).toHaveLength(1);
    expect(grid.bins[0].cellCount).toBe(3);
    expect(grid.bins[0].averageRiskScore).toBeCloseTo((0.1 + 0.2 + 0.3) / 3, 9);
  });

  it("separates cells far enough apart into different bins", () => {
    const cells: BinCellInput[] = [
      { node: makeNode("a", 0, 0), tier: "normal", riskScore: 0.1 },
      { node: makeNode("b", 500, 500), tier: "normal", riskScore: 0.1 },
    ];
    const grid = buildHeatmapGrid(cells, 10);
    expect(grid.bins.length).toBeGreaterThan(1);
    const total = grid.bins.reduce((sum, b) => sum + b.cellCount, 0);
    expect(total).toBe(2);
  });

  it("reports the single worst tier present in a bin, not an average tier", () => {
    const cells: BinCellInput[] = [
      { node: makeNode("a", 1, 1), tier: "normal", riskScore: 0.05 },
      { node: makeNode("b", 1.5, 1.5), tier: "normal", riskScore: 0.05 },
      { node: makeNode("c", 2, 2), tier: "critical", riskScore: 0.95 },
    ];
    const grid = buildHeatmapGrid(cells, 10);
    expect(grid.bins).toHaveLength(1);
    expect(grid.bins[0].worstTier).toBe("critical");
    expect(grid.bins[0].cellCount).toBe(3);
  });

  it("never loses or duplicates a cell across bins", () => {
    const cells: BinCellInput[] = Array.from({ length: 500 }, (_, i) => ({
      node: makeNode(`n${i}`, (Math.random() - 0.5) * 300, (Math.random() - 0.5) * 300),
      tier: "normal" as const,
      riskScore: Math.random(),
    }));
    const grid = buildHeatmapGrid(cells, 15);
    const total = grid.bins.reduce((sum, b) => sum + b.cellCount, 0);
    expect(total).toBe(cells.length);
  });

  it("keeps the returned bin count far smaller than the raw cell count at 20,000-cell scale", () => {
    const cells: BinCellInput[] = Array.from({ length: 20000 }, (_, i) => ({
      node: makeNode(`n${i}`, (Math.random() - 0.5) * 600, (Math.random() - 0.5) * 600),
      tier: "normal" as const,
      riskScore: Math.random(),
    }));
    const grid = buildHeatmapGrid(cells, 10); // 600km span / 10km bins -> ~60x60 = 3600 bins max
    expect(grid.bins.length).toBeLessThan(cells.length / 2);
  });
});

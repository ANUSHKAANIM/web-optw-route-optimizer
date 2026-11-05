import type { GraphNode } from "@/types/graph";
import type { RiskTier } from "@/forecast/risk-tiers";
import { tierRank } from "@/forecast/risk-tiers";

/**
 * Phase 6 (dashboard at scale): the aggregation layer that makes rendering
 * 20,000 cells feasible in a browser. Rendering one SVG marker per cell
 * (the existing optimizer-map-inner.tsx approach, built for the ~13-node
 * prototype) does not scale to 20,000 -- this bins cells into a coarse
 * spatial grid and reports per-bin aggregates (worst tier present, average
 * risk, cell count), so the UI draws a bounded number of heatmap cells
 * (binCountX * binCountY) instead of one shape per underlying node.
 *
 * Deliberately pure and framework-free: no React, no SVG/canvas calls
 * here, so it's unit-testable the same way as every other module in this
 * project. The actual rendering component that consumes this (drawing
 * these bins, plus live van markers and masked-cell fade-out on top) is a
 * separate, not-yet-built piece that needs real browser verification
 * before it can be called done -- this file is the tested, additive
 * foundation for that, not a claim that the dashboard itself is finished.
 */

export interface HeatmapBin {
  binX: number;
  binY: number;
  /** Bin bounds in the same abstract (x, y) plane as GraphNode. */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  cellCount: number;
  /** The single highest-severity tier present among this bin's cells --
   * what the heatmap color should actually reflect (a bin with one
   * critical cell among 50 normal ones should still read as urgent). */
  worstTier: RiskTier;
  averageRiskScore: number;
}

export interface BinCellInput {
  node: GraphNode;
  tier: RiskTier;
  riskScore: number;
}

export interface HeatmapGrid {
  binSizeKm: number;
  binCountX: number;
  binCountY: number;
  bins: HeatmapBin[];
}

/** Bins a set of cells into a uniform grid of the given bin size (km).
 * Shelters and any cell with tier "normal" still count toward cellCount
 * and averageRiskScore, but never raise worstTier above what an actually
 * elevated cell in the same bin would set it to. */
export function buildHeatmapGrid(cells: BinCellInput[], binSizeKm: number): HeatmapGrid {
  if (cells.length === 0) {
    return { binSizeKm, binCountX: 0, binCountY: 0, bins: [] };
  }

  const xs = cells.map((c) => c.node.x);
  const ys = cells.map((c) => c.node.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  const binCountX = Math.max(1, Math.ceil((maxX - minX) / binSizeKm) + 1);
  const binCountY = Math.max(1, Math.ceil((maxY - minY) / binSizeKm) + 1);

  interface Accumulator {
    binX: number;
    binY: number;
    cellCount: number;
    riskSum: number;
    worstTierRank: number;
  }
  const accumulators = new Map<string, Accumulator>();

  for (const cell of cells) {
    const binX = Math.floor((cell.node.x - minX) / binSizeKm);
    const binY = Math.floor((cell.node.y - minY) / binSizeKm);
    const key = `${binX},${binY}`;

    const existing = accumulators.get(key);
    const tierRankValue = tierRank(cell.tier);
    if (existing) {
      existing.cellCount += 1;
      existing.riskSum += cell.riskScore;
      existing.worstTierRank = Math.max(existing.worstTierRank, tierRankValue);
    } else {
      accumulators.set(key, { binX, binY, cellCount: 1, riskSum: cell.riskScore, worstTierRank: tierRankValue });
    }
  }

  const tierByRank: RiskTier[] = ["normal", "watch", "warning", "severe", "critical"];
  const bins: HeatmapBin[] = Array.from(accumulators.values()).map((acc) => ({
    binX: acc.binX,
    binY: acc.binY,
    minX: minX + acc.binX * binSizeKm,
    maxX: minX + (acc.binX + 1) * binSizeKm,
    minY: minY + acc.binY * binSizeKm,
    maxY: minY + (acc.binY + 1) * binSizeKm,
    cellCount: acc.cellCount,
    worstTier: tierByRank[acc.worstTierRank],
    averageRiskScore: acc.riskSum / acc.cellCount,
  }));

  return { binSizeKm, binCountX, binCountY, bins };
}

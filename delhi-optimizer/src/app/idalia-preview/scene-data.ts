import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { buildRealScenario, priceByRealReward } from "@/data/real-cell-provider";
import { buildClusteredGraph, type GraphCluster } from "@/graph/spatial-clustering";
import type { ClusterRoutingThresholds } from "@/solver/cluster-router";
import type { Bounds } from "@/components/map/optimizer-map";
import type { GraphNode } from "@/types/graph";

/**
 * Where the real Hurricane Idalia census-tract CSV is expected to live --
 * not committed to the repo (9,933 rows, sourced externally), so this page
 * degrades to a clear "file not found" message instead of crashing when
 * it's missing. See real-cell-provider.ts for the parsing/generation
 * logic this is a thin loader over.
 *
 * This file is now just the one-time scenario build (cells + clusters +
 * static priorities) -- the stateful, interactive layer (vans,
 * evacuation, replanning) lives in session.ts, same split /rolling-horizon
 * uses between its own scene build and session.ts.
 */
export const REAL_CSV_PATH = path.join(process.cwd(), "src/data/raw/census-tracts-idalia.csv");
export const VAN_COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fb923c", "#c084fc", "#2dd4bf"];
export const SHELTER_COUNT = 75;
export const VANS_PER_SHELTER = 2;
export const SEED = 2023;
export const VAN_SHIFT_MINUTES = 480;
export const TICK_STEP_MINUTES = 15;

export type SolverTier = "fast" | "real";

/** Same safe choice /rolling-horizon's Fast/Real toggle uses, and for the
 * same measured reason: exact MILP is catastrophic once a cluster's
 * candidate count climbs past a few dozen (measured ~125s for ONE tick
 * at ~300 candidates on the synthetic data), and this real dataset's
 * clusters average ~130 tracts/shelter (9,933 tracts / 75 shelters) --
 * well above that. "real" therefore opens the neural (Pointer Network +
 * beam search) tier, never exact. */
export const SOLVER_TIER_THRESHOLDS: Record<SolverTier, ClusterRoutingThresholds> = {
  fast: { maxCandidatesForExact: 0, maxCandidatesForNeural: 0 },
  real: { maxCandidatesForExact: 0, maxCandidatesForNeural: 300 },
};

export interface IdaliaStaticScenario {
  cells: GraphNode[];
  clusters: GraphCluster[];
  priorities: Map<string, number>;
  rewardByNodeId: ReadonlyMap<string, number>;
}

export function isRealDataAvailable(): boolean {
  return existsSync(REAL_CSV_PATH);
}

export function loadIdaliaScenario(): IdaliaStaticScenario | null {
  if (!existsSync(REAL_CSV_PATH)) return null;
  const csvText = readFileSync(REAL_CSV_PATH, "utf-8");
  const { cells, rewardByNodeId } = buildRealScenario(csvText, { shelterCount: SHELTER_COUNT, seed: SEED });
  const clusters = buildClusteredGraph(cells);
  const priorities = priceByRealReward(cells, rewardByNodeId);
  return { cells, clusters, priorities, rewardByNodeId };
}

export function fullMapBounds(cells: GraphNode[], paddingKm = 10): Bounds {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs) - paddingKm;
  const minY = Math.min(...ys) - paddingKm;
  const width = Math.max(...xs) - Math.min(...xs) + paddingKm * 2;
  const height = Math.max(...ys) - Math.min(...ys) + paddingKm * 2;
  return { minX, minY, width, height };
}

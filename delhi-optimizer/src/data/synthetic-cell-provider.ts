import type { CellProvider } from "./cell-provider";
import type { GraphNode, OpeningHours } from "@/types/graph";
import { SeededRandom } from "@/rewards/seeded-random";

/**
 * Generates a large synthetic evacuation scenario on the project's existing
 * abstract (x, y) plane (see types/graph.ts) -- NOT real-world geography.
 * Exists so Phases 1+ (k-NN sparsification, clustering, forecast engine,
 * multi-van coordination) can be built and load-tested against a realistic
 * node count *now*, without waiting on real geographic data to be sourced
 * (per the earlier discussion: synthetic first, behind the CellProvider
 * interface, so real data drops in later as a second implementation).
 *
 * Generation technique: a clustered spatial point process (sometimes called
 * a Thomas/Neyman-Scott process) -- pick K cluster centers ("towns"), then
 * scatter villages around each center with Gaussian jitter, plus a small
 * fraction of fully uniform-random "isolated hamlets" scattered across the
 * whole plane. This produces the same dense-cluster / sparse-outlier mix a
 * real settlement pattern has, which matters for stress-testing k-NN
 * sparsification and regional clustering in Phase 1 -- a uniform random
 * scatter would make every cell equidistant from its neighbors and hide
 * the exact problems those techniques need to handle.
 *
 * This is an original engineering choice for this project, not drawn from
 * any of the reviewed papers -- none of them cover synthetic instance
 * generation for settlement-pattern realism.
 */
export interface SyntheticCellConfig {
  /** Total nodes to generate, shelters included. */
  cellCount: number;
  /** Number of regional clusters ("towns"), each gets exactly one shelter. */
  clusterCount: number;
  /** Half-width/half-height of the square plane, in km, centered at (0,0). */
  planeHalfSizeKm: number;
  /** Fraction of origin villages scattered uniformly across the whole plane
   * instead of around a cluster center -- isolated hamlets. */
  isolatedFraction: number;
  /** Standard deviation (km) of village scatter around its cluster center. */
  clusterJitterKm: number;
  seed: number;
  /** Optional minimum distance (km) between any two villages, and between
   * a village and a shelter -- re-samples a position (up to a fixed number
   * of tries) when it lands too close to an existing node. 0 / undefined =
   * no spacing rule, the original behavior every existing caller relies on.
   * Used by small demo maps so dots and route lines don't pile up. */
  minSpacingKm?: number;
}

export const DEFAULT_SYNTHETIC_CONFIG: SyntheticCellConfig = {
  cellCount: 20000,
  clusterCount: 250,
  planeHalfSizeKm: 300,
  isolatedFraction: 0.05,
  clusterJitterKm: 6,
  seed: 42,
};

function alwaysAccessible(): OpeningHours {
  const day = { open: "00:00", close: "23:59" };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
}

export class SyntheticCellProvider implements CellProvider {
  private readonly config: SyntheticCellConfig;

  constructor(config: Partial<SyntheticCellConfig> = {}) {
    this.config = { ...DEFAULT_SYNTHETIC_CONFIG, ...config };
  }

  getNodes(): GraphNode[] {
    const { cellCount, clusterCount, planeHalfSizeKm, isolatedFraction, clusterJitterKm, seed, minSpacingKm = 0 } = this.config;
    const rng = new SeededRandom(seed);

    const originCount = Math.max(0, cellCount - clusterCount);

    const clusterCenters = Array.from({ length: clusterCount }, () => ({
      x: rng.uniform(-planeHalfSizeKm, planeHalfSizeKm),
      y: rng.uniform(-planeHalfSizeKm, planeHalfSizeKm),
    }));

    // Each origin is pre-assigned to a cluster so we can size that
    // cluster's shelter capacity from its actual total demand afterward.
    const originCluster: number[] = [];
    for (let i = 0; i < originCount; i++) {
      originCluster.push(Math.floor(rng.next() * clusterCount));
    }

    const origins: GraphNode[] = [];
    const clusterDemand = new Array(clusterCount).fill(0);

    for (let i = 0; i < originCount; i++) {
      const clusterIdx = originCluster[i];
      const center = clusterCenters[clusterIdx];
      const isolated = rng.next() < isolatedFraction;

      const sample = () => ({
        x: isolated ? rng.uniform(-planeHalfSizeKm, planeHalfSizeKm) : center.x + gaussianJitter(rng, clusterJitterKm),
        y: isolated ? rng.uniform(-planeHalfSizeKm, planeHalfSizeKm) : center.y + gaussianJitter(rng, clusterJitterKm),
      });
      let { x, y } = sample();
      if (minSpacingKm > 0) {
        const tooClose = (px: number, py: number) =>
          clusterCenters.some((c) => Math.hypot(c.x - px, c.y - py) < minSpacingKm) ||
          origins.some((o) => Math.hypot(o.x - px, o.y - py) < minSpacingKm);
        for (let attempt = 0; attempt < 60 && tooClose(x, y); attempt++) ({ x, y } = sample());
      }

      const demand = Math.round(rng.uniform(50, 500));
      clusterDemand[clusterIdx] += demand;

      origins.push({
        id: `origin_${clusterIdx}_${i}`,
        name: `Village ${clusterIdx}-${i}`,
        x,
        y,
        role: "origin",
        demand,
        capacity: 0,
        openingHours: alwaysAccessible(),
        serviceDurationMinutes: Math.round(rng.uniform(10, 30)),
      });
    }

    const shelters: GraphNode[] = clusterCenters.map((center, clusterIdx) => ({
      id: `shelter_${clusterIdx}`,
      name: `Shelter ${clusterIdx}`,
      x: center.x,
      y: center.y,
      role: "shelter",
      demand: 0,
      // 1.3x headroom over the cluster's total demand so the shared-capacity
      // constraint is meaningful without being impossible to satisfy.
      capacity: Math.round(clusterDemand[clusterIdx] * 1.3) || 100,
      openingHours: alwaysAccessible(),
      serviceDurationMinutes: 0,
    }));

    return [...shelters, ...origins];
  }
}

/** Box-Muller transform for Gaussian jitter, using the project's existing
 * deterministic PRNG so synthetic scenarios stay reproducible by seed. */
function gaussianJitter(rng: SeededRandom, stdDevKm: number): number {
  const u1 = Math.max(rng.next(), 1e-9);
  const u2 = rng.next();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return z * stdDevKm;
}

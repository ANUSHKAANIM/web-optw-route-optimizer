import { readFileSync } from "node:fs";
import type { CellProvider } from "./cell-provider";
import type { GraphNode, OpeningHours } from "@/types/graph";
import { SeededRandom } from "@/rewards/seeded-random";

/**
 * Real-data CellProvider: loads actual census-tract centroids + a
 * precomputed per-person reward from a CSV (GEO_ID, Latitude, Longitude,
 * Reward) -- e.g. every tract that fell inside one of Hurricane Idalia's
 * (Aug 2023) forecast cones/advisories. Unlike SyntheticCellProvider, this
 * does NOT invent risk geometry: the input rows are already filtered to
 * the forecast cone, so every tract here is "at risk" by construction, and
 * `reward` is used directly rather than derived from a simulated storm
 * center.
 *
 * Explicitly NOT yet wired to real population or accessibility-window
 * data -- those are still being sourced (per the task that created this
 * file). Until then, population is a uniform random draw and every tract
 * is treated as always-accessible (no time-window constraint). Swap
 * `populationMin/Max` for a real per-tract field, and `alwaysAccessible()`
 * for a real window, once that data lands -- nothing downstream changes,
 * same CellProvider seam as every other data source.
 */

export interface RealTractRecord {
  geoId: string;
  latitude: number;
  longitude: number;
  reward: number;
}

export interface RealCellConfig {
  /** How many shelters to generate, positioned near the cone -- "a
   * suitable number, say 50-100" per the task. */
  shelterCount: number;
  seed: number;
  populationMin: number;
  populationMax: number;
  shelterCapacityMin: number;
  shelterCapacityMax: number;
  /** Shelters are placed this far (km) to either side of the cone's own
   * principal axis -- "approximately 50-100 km away from both sides of
   * the hurricane cone." */
  shelterOffsetKmMin: number;
  shelterOffsetKmMax: number;
  /** Not yet sourced -- a placeholder constant, not a real per-tract
   * service time. */
  serviceDurationMinutes: number;
}

export const DEFAULT_REAL_CELL_CONFIG: RealCellConfig = {
  shelterCount: 75,
  seed: 2023,
  populationMin: 100,
  populationMax: 500,
  shelterCapacityMin: 500,
  shelterCapacityMax: 1000,
  shelterOffsetKmMin: 50,
  shelterOffsetKmMax: 100,
  serviceDurationMinutes: 15,
};

const EARTH_RADIUS_KM = 6371;

function alwaysAccessible(): OpeningHours {
  const day = { open: "00:00", close: "23:59" };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
}

/** Tolerant CSV parser for this one fixed schema (GEO_ID never contains a
 * comma, so a plain split is safe here -- not a general CSV parser).
 * Rows that fail to parse as finite numbers are skipped rather than
 * thrown on, so one malformed line doesn't take down a 9,933-row file. */
export function parseTractCsv(csvText: string): RealTractRecord[] {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const records: RealTractRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 4) continue;
    const geoId = parts[0].trim();
    const latitude = Number.parseFloat(parts[1]);
    const longitude = Number.parseFloat(parts[2]);
    const reward = Number.parseFloat(parts[3]);
    if (!geoId || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !Number.isFinite(reward)) continue;
    records.push({ geoId, latitude, longitude, reward });
  }
  return records;
}

interface PlanePoint {
  x: number;
  y: number;
}

/** Equirectangular projection onto a local (x, y) km plane, centered at
 * the dataset's OWN centroid -- not a real-world coordinate system, but
 * accurate to a fraction of a percent over the few-hundred-km extent one
 * hurricane cone spans (the same simplification any local projected CRS
 * makes). Centering on the data's own centroid, rather than a fixed
 * reference point, keeps this correct regardless of which storm's cone is
 * loaded later. */
function projectToPlane(records: RealTractRecord[]): PlanePoint[] {
  const centroidLat = records.reduce((s, r) => s + r.latitude, 0) / records.length;
  const centroidLon = records.reduce((s, r) => s + r.longitude, 0) / records.length;
  const latRad = (centroidLat * Math.PI) / 180;
  return records.map((r) => ({
    x: ((r.longitude - centroidLon) * Math.PI) / 180 * EARTH_RADIUS_KM * Math.cos(latRad),
    y: ((r.latitude - centroidLat) * Math.PI) / 180 * EARTH_RADIUS_KM,
  }));
}

/** The cone's own principal axis (PCA on the projected points) -- a
 * hurricane forecast cone is elongated along the storm's track, so this
 * finds that track direction directly from the tract scatter itself,
 * with no separate track/geometry input needed. `perp` is what "to
 * either side of the cone" means for shelter placement below. */
function principalAxis(points: PlanePoint[]): { axis: PlanePoint; perp: PlanePoint; centroid: PlanePoint } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return {
    axis: { x: Math.cos(theta), y: Math.sin(theta) },
    perp: { x: -Math.sin(theta), y: Math.cos(theta) },
    centroid: { x: mx, y: my },
  };
}

function generateShelters(points: PlanePoint[], config: RealCellConfig, rng: SeededRandom): GraphNode[] {
  const { axis, perp, centroid } = principalAxis(points);
  const projections = points.map((p) => (p.x - centroid.x) * axis.x + (p.y - centroid.y) * axis.y);
  const tMin = Math.min(...projections);
  const tMax = Math.max(...projections);

  const shelters: GraphNode[] = [];
  for (let i = 0; i < config.shelterCount; i++) {
    const t = rng.uniform(tMin, tMax);
    const side = i % 2 === 0 ? 1 : -1; // alternate sides -- an even split along the track, not all on one side
    const offset = rng.uniform(config.shelterOffsetKmMin, config.shelterOffsetKmMax) * side;
    const x = centroid.x + axis.x * t + perp.x * offset;
    const y = centroid.y + axis.y * t + perp.y * offset;
    shelters.push({
      id: `shelter_${i}`,
      name: `Shelter ${i}`,
      x,
      y,
      role: "shelter",
      demand: 0,
      capacity: Math.round(rng.uniform(config.shelterCapacityMin, config.shelterCapacityMax)),
      openingHours: alwaysAccessible(),
      serviceDurationMinutes: 0,
    });
  }
  return shelters;
}

export interface RealScenario {
  /** Shelters first, then every parsed census tract as an origin node --
   * same ordering convention SyntheticCellProvider uses. */
  cells: GraphNode[];
  /** Per-person reward straight from the CSV, keyed by GEO_ID (origins
   * only). Kept separate from GraphNode -- which has no reward field --
   * rather than overloading an existing field; see priceByRealReward(). */
  rewardByNodeId: Map<string, number>;
}

export function buildRealScenario(csvText: string, config: Partial<RealCellConfig> = {}): RealScenario {
  const cfg: RealCellConfig = { ...DEFAULT_REAL_CELL_CONFIG, ...config };
  const records = parseTractCsv(csvText);
  if (records.length === 0) {
    throw new Error("buildRealScenario: no valid census-tract rows parsed from the given CSV.");
  }

  const points = projectToPlane(records);
  const rng = new SeededRandom(cfg.seed);
  const rewardByNodeId = new Map<string, number>();

  const origins: GraphNode[] = records.map((r, i) => {
    rewardByNodeId.set(r.geoId, r.reward);
    return {
      id: r.geoId,
      name: r.geoId.replace("1400000US", "Tract "),
      x: points[i].x,
      y: points[i].y,
      role: "origin",
      demand: Math.round(rng.uniform(cfg.populationMin, cfg.populationMax)),
      capacity: 0,
      openingHours: alwaysAccessible(),
      serviceDurationMinutes: cfg.serviceDurationMinutes,
    };
  });

  const shelters = generateShelters(points, cfg, rng);
  return { cells: [...shelters, ...origins], rewardByNodeId };
}

/** The priorities map the existing solver stack actually consumes
 * (computeBaselineRoute, computeNodeStates, etc. all just take
 * `priorities: ReadonlyMap<string, number>` and never ask where it came
 * from -- the same documented seam priorityFromForecastTick() uses for
 * the synthetic scenario). Demand-weighted real reward, no synthetic
 * risk-tier model involved: these rows are already filtered to the
 * forecast cone, so nothing here needs its own "is this cell at risk"
 * computation. */
export function priceByRealReward(cells: GraphNode[], rewardByNodeId: ReadonlyMap<string, number>): Map<string, number> {
  const priorities = new Map<string, number>();
  for (const node of cells) {
    priorities.set(node.id, node.role === "origin" ? Math.round(node.demand * (rewardByNodeId.get(node.id) ?? 0)) : 0);
  }
  return priorities;
}

export class RealCellProvider implements CellProvider {
  private readonly scenario: RealScenario;

  constructor(csvPath: string, config: Partial<RealCellConfig> = {}) {
    const csvText = readFileSync(csvPath, "utf-8");
    this.scenario = buildRealScenario(csvText, config);
  }

  getNodes(): GraphNode[] {
    return this.scenario.cells;
  }

  getRewardByNodeId(): ReadonlyMap<string, number> {
    return this.scenario.rewardByNodeId;
  }
}

import { SeededRandom, hashSeed } from "@/rewards/seeded-random";
import { planeDistanceKm } from "@/graph/plane-distance";
import type { GraphNode } from "@/types/graph";

/**
 * A simulated cyclone-forecast risk region -- always geometry only, and
 * always clearly labeled as a simulation wherever it's shown. Three
 * concentric rings rather than one flat circle, so it reads as a
 * graduated risk area rather than an arbitrary shape. Positioned in the
 * same abstract (x, y) plane as every node -- not real-world geography.
 */
export interface RiskZone {
  scenarioId: number;
  centerX: number;
  centerY: number;
  /** Outer radius (km) of each concentric ring, high risk innermost. */
  rings: { level: "high" | "medium" | "low"; radiusKm: number }[];
  generatedAtIso: string;
  nextUpdateIso: string;
  concentration: string;
}

const CONCENTRATIONS = ["Northern Sector", "Southern Sector", "Central Sector", "Eastern Sector", "Outer Perimeter"] as const;

export function forecastScenarioIndex(secondsSinceStart: number, intervalSeconds: number): number {
  return Math.floor(Math.max(0, secondsSinceStart) / intervalSeconds);
}

/** Deterministic per-scenario risk zone: the same (seed, scenarioId) always
 * yields the same zone, so every player sees an identical forecast without
 * any stored mutable state. */
export function computeRiskZone(
  nodes: GraphNode[],
  seed: number,
  scenarioId: number,
  sessionStartedAt: Date,
  intervalSeconds: number,
): RiskZone {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const rng = new SeededRandom(hashSeed(seed, scenarioId + 0x5eed));
  const centerX = minX + rng.next() * (maxX - minX);
  const centerY = minY + rng.next() * (maxY - minY);
  const highRadiusKm = 2.5 + rng.next() * 2.5;

  const generatedAt = new Date(sessionStartedAt.getTime() + scenarioId * intervalSeconds * 1000);
  const nextUpdate = new Date(generatedAt.getTime() + intervalSeconds * 1000);
  const concentration = CONCENTRATIONS[Math.floor(rng.next() * CONCENTRATIONS.length)];

  return {
    scenarioId,
    centerX,
    centerY,
    rings: [
      { level: "high", radiusKm: highRadiusKm },
      { level: "medium", radiusKm: highRadiusKm * 2 },
      { level: "low", radiusKm: highRadiusKm * 3.5 },
    ],
    generatedAtIso: generatedAt.toISOString(),
    nextUpdateIso: nextUpdate.toISOString(),
    concentration,
  };
}

export function riskLevelForDistance(zone: RiskZone, distanceKm: number): "high" | "medium" | "low" | "none" {
  for (const ring of zone.rings) {
    if (distanceKm <= ring.radiusKm) return ring.level;
  }
  return "none";
}

export function distanceToRiskCenterKm(zone: RiskZone, node: GraphNode): number {
  return planeDistanceKm([node.x, node.y], [zone.centerX, zone.centerY]);
}

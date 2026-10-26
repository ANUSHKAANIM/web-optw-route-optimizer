import { SeededRandom } from "@/lib/env/rng";
import { hashSeed } from "@/lib/env/seed-hash";
import type { DelhiPlace } from "@/data/delhi-places";

/** A simulated, clearly-labeled-as-mock forecast risk zone: a circular
 * region over Delhi that stands in for a cyclone cone/advisory area. Real
 * geometry (a polygon cone from an actual weather API) would replace this
 * generator without touching anything downstream -- consumers only see
 * {centerLatitude, centerLongitude, radiusKm}. */
export interface RiskZone {
  scenarioId: number;
  centerLatitude: number;
  centerLongitude: number;
  radiusKm: number;
  generatedAt: string;
  validUntil: string;
}

const MIN_RADIUS_KM = 4;
const MAX_RADIUS_KM = 10;

export function forecastScenarioIndex(secondsSinceStart: number, intervalSeconds: number): number {
  return Math.floor(Math.max(0, secondsSinceStart) / intervalSeconds);
}

/** Deterministic per-scenario risk zone: the same (seed, scenarioId) always
 * yields the same zone, so every player sees an identical forecast without
 * any stored mutable state -- same principle as the tourist dynamic rewards. */
export function computeRiskZone(
  places: DelhiPlace[],
  seed: number,
  scenarioId: number,
  sessionStartedAt: Date,
  intervalSeconds: number,
): RiskZone {
  const lats = places.map((p) => p.latitude);
  const lngs = places.map((p) => p.longitude);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const rng = new SeededRandom(hashSeed(seed, scenarioId + 0x5eed));
  const centerLatitude = minLat + rng.next() * (maxLat - minLat);
  const centerLongitude = minLng + rng.next() * (maxLng - minLng);
  const radiusKm = MIN_RADIUS_KM + rng.next() * (MAX_RADIUS_KM - MIN_RADIUS_KM);

  const generatedAt = new Date(sessionStartedAt.getTime() + scenarioId * intervalSeconds * 1000);
  const validUntil = new Date(generatedAt.getTime() + intervalSeconds * 1000);

  return {
    scenarioId,
    centerLatitude,
    centerLongitude,
    radiusKm,
    generatedAt: generatedAt.toISOString(),
    validUntil: validUntil.toISOString(),
  };
}

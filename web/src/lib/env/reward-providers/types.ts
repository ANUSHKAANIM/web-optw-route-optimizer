import type { DelhiPlace } from "@/data/delhi-places";

export interface RewardContext {
  seed: number;
  startedAt: Date;
  secondsSinceStart: number;
  intervalSeconds: number;
  /** Depot-first ordered place list -- rewards[i] corresponds to places[i]. */
  places: DelhiPlace[];
}

export interface ForecastInfo {
  scenarioId: number;
  generatedAt: string;
  validUntil: string;
  riskZone: { centerLatitude: number; centerLongitude: number; radiusKm: number };
}

export interface RewardSnapshot {
  rewards: number[];
  /** Present only for forecast-driven providers (e.g. the mock evacuation
   * scenario) -- absent for plain tourist-mode rewards. */
  forecast?: ForecastInfo;
}

/**
 * Pluggable source of "what is node i worth right now." Tourist mode and
 * the mock evacuation simulation are two implementations of this same
 * interface; a future real cyclone-risk provider (fed by an actual weather
 * API) would be a third, without the graph, optimizer, or multiplayer layer
 * changing at all.
 */
export interface RewardProvider {
  readonly kind: "tourist" | "evacuation_sim";
  getRewards(ctx: RewardContext): RewardSnapshot;
  secondsUntilNextUpdate(ctx: RewardContext): number;
}

import { haversineKm } from "@/lib/geo/haversine";
import { computeRiskZone, forecastScenarioIndex } from "@/lib/geo/risk-zone";
import type { RewardContext, RewardProvider, RewardSnapshot } from "./types";

/** MOCK evacuation-priority provider: a stand-in for a future real cyclone
 * forecast feed. A new simulated risk zone is generated every
 * `ctx.intervalSeconds` (default 9h) -- NOT randomly on every request --
 * and each place's priority is derived purely from its distance to that
 * zone's center. Clearly a simulation: see the "Simulation / Mock Forecast"
 * labeling wired into the UI wherever this provider's output is shown. */
const MIN_PRIORITY = 50;
const MAX_RISK_BONUS = 900;

export const mockForecastRewardProvider: RewardProvider = {
  kind: "evacuation_sim",

  getRewards(ctx: RewardContext): RewardSnapshot {
    const scenarioId = forecastScenarioIndex(ctx.secondsSinceStart, ctx.intervalSeconds);
    const zone = computeRiskZone(ctx.places, ctx.seed, scenarioId, ctx.startedAt, ctx.intervalSeconds);

    const rewards = ctx.places.map((place, index) => {
      if (index === 0) return 0; // depot
      const distanceKm = haversineKm(
        [place.latitude, place.longitude],
        [zone.centerLatitude, zone.centerLongitude],
      );
      const riskScore = Math.max(0, 1 - distanceKm / zone.radiusKm);
      return Math.round(MIN_PRIORITY + riskScore * MAX_RISK_BONUS);
    });

    return {
      rewards,
      forecast: {
        scenarioId: zone.scenarioId,
        generatedAt: zone.generatedAt,
        validUntil: zone.validUntil,
        riskZone: {
          centerLatitude: zone.centerLatitude,
          centerLongitude: zone.centerLongitude,
          radiusKm: zone.radiusKm,
        },
      },
    };
  },

  secondsUntilNextUpdate(ctx: RewardContext): number {
    const elapsedInInterval = Math.max(0, ctx.secondsSinceStart) % ctx.intervalSeconds;
    return ctx.intervalSeconds - elapsedInInterval;
  },
};

import { describe, expect, it } from "vitest";
import { touristRewardProvider } from "./tourist-reward-provider";
import { mockForecastRewardProvider } from "./mock-forecast-reward-provider";
import { rewardProviderForMode } from "./index";
import { orderedGeoPlaces } from "@/lib/env/geo-environment";
import type { RewardContext } from "./types";

const places = orderedGeoPlaces();

function makeCtx(overrides: Partial<RewardContext> = {}): RewardContext {
  return {
    seed: 42,
    startedAt: new Date("2026-01-15T03:30:00.000Z"),
    secondsSinceStart: 0,
    intervalSeconds: 45,
    places,
    ...overrides,
  };
}

describe("touristRewardProvider", () => {
  it("gives the depot no reward and every other place a positive one", () => {
    const { rewards } = touristRewardProvider.getRewards(makeCtx());
    expect(rewards[0]).toBe(0);
    expect(rewards.slice(1).every((r) => r >= 0)).toBe(true);
  });

  it("has no forecast info", () => {
    const snapshot = touristRewardProvider.getRewards(makeCtx());
    expect(snapshot.forecast).toBeUndefined();
  });

  it("changes rewards once the interval elapses", () => {
    const a = touristRewardProvider.getRewards(makeCtx({ secondsSinceStart: 0 }));
    const b = touristRewardProvider.getRewards(makeCtx({ secondsSinceStart: 45 }));
    expect(a.rewards).not.toEqual(b.rewards);
  });
});

describe("mockForecastRewardProvider", () => {
  it("gives the depot no reward and includes forecast/riskZone info", () => {
    const snapshot = mockForecastRewardProvider.getRewards(makeCtx({ intervalSeconds: 9 * 3600 }));
    expect(snapshot.rewards[0]).toBe(0);
    expect(snapshot.forecast).toBeDefined();
    expect(snapshot.forecast!.riskZone.radiusKm).toBeGreaterThan(0);
  });

  it("gives places closer to the risk zone a higher priority", () => {
    const snapshot = mockForecastRewardProvider.getRewards(makeCtx({ intervalSeconds: 9 * 3600 }));
    const zone = snapshot.forecast!.riskZone;

    let closestIndex = 1;
    let closestDist = Infinity;
    let farthestIndex = 1;
    let farthestDist = -Infinity;
    for (let i = 1; i < places.length; i++) {
      const d = Math.hypot(places[i].latitude - zone.centerLatitude, places[i].longitude - zone.centerLongitude);
      if (d < closestDist) {
        closestDist = d;
        closestIndex = i;
      }
      if (d > farthestDist) {
        farthestDist = d;
        farthestIndex = i;
      }
    }

    expect(snapshot.rewards[closestIndex]).toBeGreaterThanOrEqual(snapshot.rewards[farthestIndex]);
  });

  it("does NOT change every few seconds -- only when the scenario interval elapses", () => {
    const intervalSeconds = 9 * 3600;
    const a = mockForecastRewardProvider.getRewards(makeCtx({ intervalSeconds, secondsSinceStart: 10 }));
    const b = mockForecastRewardProvider.getRewards(makeCtx({ intervalSeconds, secondsSinceStart: 5000 }));
    expect(a.rewards).toEqual(b.rewards);

    const c = mockForecastRewardProvider.getRewards(makeCtx({ intervalSeconds, secondsSinceStart: intervalSeconds + 10 }));
    expect(c.rewards).not.toEqual(a.rewards);
  });
});

describe("rewardProviderForMode", () => {
  it("selects the right provider per mode", () => {
    expect(rewardProviderForMode("tourist")).toBe(touristRewardProvider);
    expect(rewardProviderForMode("evacuation_sim")).toBe(mockForecastRewardProvider);
  });
});

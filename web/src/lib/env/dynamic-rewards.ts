import { SeededRandom } from "@/lib/env/rng";
import { hashSeed } from "@/lib/env/seed-hash";

export const DEFAULT_REWARD_INTERVAL_SECONDS = 45;

export function rewardIntervalIndex(secondsSinceStart: number, intervalSeconds: number): number {
  return Math.floor(Math.max(0, secondsSinceStart) / intervalSeconds);
}

export function secondsUntilNextRewardUpdate(secondsSinceStart: number, intervalSeconds: number): number {
  const elapsedInInterval = Math.max(0, secondsSinceStart) % intervalSeconds;
  return intervalSeconds - elapsedInInterval;
}

/**
 * Deterministic per-interval reward multipliers: the same (sessionSeed,
 * intervalIndex) pair always yields the same values. That means every
 * player's request -- no matter which server instance handles it -- computes
 * an identical reward snapshot for "now" on the fly, with no stored mutable
 * state and no background timer/cron needed to actually change the numbers.
 */
export function computeDynamicRewards(
  baseRewards: number[],
  sessionSeed: number,
  intervalIndex: number,
): number[] {
  const rng = new SeededRandom(hashSeed(sessionSeed, intervalIndex));
  return baseRewards.map((base) => {
    const multiplier = 0.4 + rng.next() * 1.6; // 0.4x - 2.0x swing per interval
    return Math.round(base * multiplier);
  });
}

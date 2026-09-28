import { describe, expect, it } from "vitest";
import {
  computeDynamicRewards,
  rewardIntervalIndex,
  secondsUntilNextRewardUpdate,
} from "./dynamic-rewards";

describe("computeDynamicRewards", () => {
  const baseRewards = [0, 100, 80, 120, 60];

  it("is deterministic for the same (seed, interval)", () => {
    const a = computeDynamicRewards(baseRewards, 42, 5);
    const b = computeDynamicRewards(baseRewards, 42, 5);
    expect(a).toEqual(b);
  });

  it("differs across intervals -- rewards actually change over time", () => {
    const a = computeDynamicRewards(baseRewards, 42, 0);
    const b = computeDynamicRewards(baseRewards, 42, 1);
    expect(a).not.toEqual(b);
  });

  it("differs across sessions with different seeds", () => {
    const a = computeDynamicRewards(baseRewards, 1, 3);
    const b = computeDynamicRewards(baseRewards, 2, 3);
    expect(a).not.toEqual(b);
  });

  it("stays within the documented 0.4x-2.0x swing of each base reward", () => {
    const rewards = computeDynamicRewards(baseRewards, 7, 12);
    for (let i = 1; i < baseRewards.length; i++) {
      expect(rewards[i]).toBeGreaterThanOrEqual(Math.round(baseRewards[i] * 0.4));
      expect(rewards[i]).toBeLessThanOrEqual(Math.round(baseRewards[i] * 2.0) + 1);
    }
  });
});

describe("rewardIntervalIndex / secondsUntilNextRewardUpdate", () => {
  it("advances the interval index once the interval elapses", () => {
    expect(rewardIntervalIndex(0, 45)).toBe(0);
    expect(rewardIntervalIndex(44, 45)).toBe(0);
    expect(rewardIntervalIndex(45, 45)).toBe(1);
    expect(rewardIntervalIndex(90, 45)).toBe(2);
  });

  it("counts down to exactly the interval length right after a rollover", () => {
    expect(secondsUntilNextRewardUpdate(45, 45)).toBe(45);
    expect(secondsUntilNextRewardUpdate(44, 45)).toBe(1);
    expect(secondsUntilNextRewardUpdate(0, 45)).toBe(45);
  });
});

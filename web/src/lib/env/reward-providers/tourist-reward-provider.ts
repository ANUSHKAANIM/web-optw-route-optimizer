import {
  computeDynamicRewards,
  rewardIntervalIndex,
  secondsUntilNextRewardUpdate,
} from "@/lib/env/dynamic-rewards";
import type { RewardContext, RewardProvider, RewardSnapshot } from "./types";

/** Today's tourist-attraction reward mechanic: each place's base reward is
 * scaled by a deterministic per-interval multiplier (see dynamic-rewards.ts).
 * No forecast info -- there's no simulated scenario in tourist mode. */
export const touristRewardProvider: RewardProvider = {
  kind: "tourist",

  getRewards(ctx: RewardContext): RewardSnapshot {
    const baseRewards = ctx.places.map((p) => p.baseReward);
    const intervalIndex = rewardIntervalIndex(ctx.secondsSinceStart, ctx.intervalSeconds);
    const rewards = computeDynamicRewards(baseRewards, ctx.seed, intervalIndex);
    rewards[0] = 0;
    return { rewards };
  },

  secondsUntilNextUpdate(ctx: RewardContext): number {
    return secondsUntilNextRewardUpdate(ctx.secondsSinceStart, ctx.intervalSeconds);
  },
};

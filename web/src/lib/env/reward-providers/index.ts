import { touristRewardProvider } from "./tourist-reward-provider";
import { mockForecastRewardProvider } from "./mock-forecast-reward-provider";
import type { RewardProvider } from "./types";

export type { RewardContext, RewardProvider, RewardSnapshot, ForecastInfo } from "./types";
export { touristRewardProvider } from "./tourist-reward-provider";
export { mockForecastRewardProvider } from "./mock-forecast-reward-provider";

export const GAME_MODES = ["tourist", "evacuation_sim"] as const;
export type GameMode = (typeof GAME_MODES)[number];

export function rewardProviderForMode(mode: GameMode): RewardProvider {
  return mode === "evacuation_sim" ? mockForecastRewardProvider : touristRewardProvider;
}

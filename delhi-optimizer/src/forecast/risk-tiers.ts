/**
 * Multi-tier cyclone risk severity (Phase 2 of the 20,000-cell rolling-
 * horizon roadmap). Each tier carries a reward multiplier -- higher-risk
 * cells become more valuable to evacuate -- and a deadline, in hours from
 * the moment a cell FIRST enters an elevated tier, standing in for a real
 * forecast's storm-landfall ETA for that cell's region.
 *
 * These specific multiplier/deadline numbers are an original, hand-picked
 * design for this prototype, not derived from any of the reviewed papers
 * or a real meteorological model -- there is no historical cyclone data
 * here to calibrate against.
 */
export type RiskTier = "normal" | "watch" | "warning" | "severe" | "critical";

export interface RiskTierConfig {
  rewardMultiplier: number;
  /** Hours from first elevation into *some* non-normal tier until this
   * tier's evacuation deadline. null only for "normal" (no deadline). */
  deadlineHoursFromFirstElevation: number | null;
}

export const RISK_TIER_ORDER: RiskTier[] = ["normal", "watch", "warning", "severe", "critical"];

export const RISK_TIER_CONFIG: Record<RiskTier, RiskTierConfig> = {
  normal: { rewardMultiplier: 1.0, deadlineHoursFromFirstElevation: null },
  watch: { rewardMultiplier: 1.5, deadlineHoursFromFirstElevation: 48 },
  warning: { rewardMultiplier: 2.5, deadlineHoursFromFirstElevation: 24 },
  severe: { rewardMultiplier: 4.0, deadlineHoursFromFirstElevation: 12 },
  critical: { rewardMultiplier: 6.0, deadlineHoursFromFirstElevation: 6 },
};

export function tierRank(tier: RiskTier): number {
  return RISK_TIER_ORDER.indexOf(tier);
}

/** Maps the existing geometric risk score (0-1, distance to simulated
 * storm center -- see scenarios/risk-zone.ts) onto a discrete severity
 * tier. Thresholds are an arbitrary, documented design choice, not a
 * calibrated model. */
export function tierForRiskScore(riskScore: number): RiskTier {
  if (riskScore >= 0.85) return "critical";
  if (riskScore >= 0.65) return "severe";
  if (riskScore >= 0.4) return "warning";
  if (riskScore >= 0.15) return "watch";
  return "normal";
}

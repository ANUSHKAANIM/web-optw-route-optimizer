import type { GraphNode } from "@/types/graph";
import type { RelativeWindow } from "@/optimization/feasibility";
import { computeRiskZone, distanceToRiskCenterKm, type RiskZone } from "@/scenarios/risk-zone";
import { RISK_TIER_CONFIG, tierForRiskScore, type RiskTier } from "./risk-tiers";

/**
 * Stateful forecast engine for Phase 2 of the rolling-horizon roadmap.
 * Reuses the existing computeRiskZone() storm-center model (scenarios/
 * risk-zone.ts) instead of inventing a second one, but adds two things
 * that model doesn't have:
 *
 *  1. Per-cell MEMORY across forecast ticks -- computeRiskZone is stateless
 *     (recomputed fresh from (seed, tick) every call), but a cell's
 *     evacuation deadline and reward growth both depend on *when it first
 *     became at-risk*, which only a stateful engine can track.
 *  2. TOCPUR-style reward accumulation (Liu, Xiao & Stone, IROS 2021,
 *     Eq. 2): the longer an elevated-risk cell goes un-evacuated, the more
 *     its reward grows, reset to baseline only when a van actually
 *     evacuates it (markEvacuated). TOCPUR estimates the growth RATE via
 *     maximum likelihood from observed history; this engine uses a fixed
 *     hand-picked rate instead, since there's no historical data to
 *     estimate from in a synthetic prototype -- an explicit simplification
 *     of the paper's mechanism, not a faithful reproduction of it.
 *
 * Known simplification: a cell that de-escalates back to "normal" (the
 * simulated storm center moves away) has its elevation clock reset to
 * zero. TOCPUR's own cost never resets this way -- only a visit resets it.
 * Real cyclone risk also doesn't just vanish once elevated. This is an
 * accepted simplification for the prototype, not a deliberate match to
 * the paper's semantics.
 */

/** Reward grows this fraction per hour a cell has been continuously
 * elevated and un-evacuated, on top of its tier's base multiplier. */
const ACCUMULATION_RATE_PER_HOUR = 0.05;

interface CellForecastState {
  currentTier: RiskTier;
  /** Tick index this cell first left "normal" in its current elevation
   * episode -- null if currently normal. */
  firstElevatedAtTick: number | null;
  evacuated: boolean;
}

export interface CellForecastResult {
  tier: RiskTier;
  riskScore: number;
  /** Combined tier-base x accumulation-growth multiplier. Multiply a
   * cell's baseline demand-weighted priority by this to get its current
   * reward. */
  rewardMultiplier: number;
  /** Evacuation deadline window, in the same minutes-from-session-start
   * convention computeRelativeWindow()/planArrival() already use --
   * null means "no deadline, always accessible this session." Feed this
   * into feasibility.ts as a per-cell override of the node's static
   * openingHours. */
  window: RelativeWindow | null;
  hoursSinceElevated: number;
}

export interface ForecastTickResult {
  tick: number;
  zone: RiskZone;
  cellStates: Map<string, CellForecastResult>;
}

export class CycloneForecastEngine {
  private readonly state = new Map<string, CellForecastState>();

  constructor(
    private readonly cells: GraphNode[],
    private readonly seed: number,
    private readonly sessionStartedAt: Date,
    private readonly forecastIntervalSeconds: number,
  ) {
    for (const cell of cells) {
      this.state.set(cell.id, { currentTier: "normal", firstElevatedAtTick: null, evacuated: false });
    }
  }

  /** Call when a van actually evacuates this cell. Resets accumulated
   * urgency and elevated state -- TOCPUR Eq. 2's reset-on-visit. An
   * evacuated cell stays cleared for the rest of this engine's lifetime
   * (no re-population modeled). */
  markEvacuated(cellId: string): void {
    const s = this.state.get(cellId);
    if (!s) return;
    s.evacuated = true;
    s.currentTier = "normal";
    s.firstElevatedAtTick = null;
  }

  advanceTick(tick: number): ForecastTickResult {
    const zone = computeRiskZone(this.cells, this.seed, tick, this.sessionStartedAt, this.forecastIntervalSeconds);
    const outerRadius = zone.rings[zone.rings.length - 1].radiusKm;

    const cellStates = new Map<string, CellForecastResult>();

    for (const cell of this.cells) {
      const s = this.state.get(cell.id)!;

      if (cell.role === "shelter" || s.evacuated) {
        cellStates.set(cell.id, { tier: "normal", riskScore: 0, rewardMultiplier: 1, window: null, hoursSinceElevated: 0 });
        continue;
      }

      const distanceKm = distanceToRiskCenterKm(zone, cell);
      const riskScore = Math.max(0, Math.min(1, 1 - distanceKm / outerRadius));
      const measuredTier = tierForRiskScore(riskScore);

      if (measuredTier === "normal") {
        s.currentTier = "normal";
        s.firstElevatedAtTick = null;
      } else {
        if (s.firstElevatedAtTick === null) s.firstElevatedAtTick = tick;
        s.currentTier = measuredTier;
      }

      const hoursSinceElevated =
        s.firstElevatedAtTick !== null ? ((tick - s.firstElevatedAtTick) * this.forecastIntervalSeconds) / 3600 : 0;

      const config = RISK_TIER_CONFIG[s.currentTier];
      const rewardMultiplier = config.rewardMultiplier * (1 + ACCUMULATION_RATE_PER_HOUR * hoursSinceElevated);
      const window = this.computeDeadlineWindow(s);

      cellStates.set(cell.id, { tier: s.currentTier, riskScore, rewardMultiplier, window, hoursSinceElevated });
    }

    return { tick, zone, cellStates };
  }

  private computeDeadlineWindow(s: CellForecastState): RelativeWindow | null {
    if (s.currentTier === "normal" || s.firstElevatedAtTick === null) return null;
    const config = RISK_TIER_CONFIG[s.currentTier];
    if (config.deadlineHoursFromFirstElevation === null) return null;

    const elevatedAtMinutes = (s.firstElevatedAtTick * this.forecastIntervalSeconds) / 60;
    const deadlineMinutes = elevatedAtMinutes + config.deadlineHoursFromFirstElevation * 60;
    return { effectiveOpenMinutes: elevatedAtMinutes, closeMinutes: deadlineMinutes };
  }
}

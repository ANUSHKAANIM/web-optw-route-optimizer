import { computeRiskZone, distanceToRiskCenterKm, forecastScenarioIndex } from "@/scenarios/risk-zone";
import type { RewardContext, RiskPriorityProvider, RiskPrioritySnapshot } from "./reward-provider";

/**
 * MOCK external forecast provider (Sections 3/17 of the evacuation audit).
 * A new simulated risk zone is generated every `ctx.forecastIntervalSeconds`
 * (default 9h -- NOT randomly on every request), and from it this module
 * derives TWO separate numbers per node, on purpose:
 *
 *   riskScore  -- raw hazard estimate, continuous 0-1, purely geometric
 *                 (distance to the simulated risk zone center).
 *   priority   -- what the optimizer actually maximizes. NOT equal to
 *                 riskScore: a node with zero measured risk still has a
 *                 baseline priority proportional to its demand (people
 *                 there still need evacuating; forecasts are uncertain),
 *                 and risk scales that up rather than replacing it.
 *
 * This separation exists specifically because collapsing "how dangerous"
 * and "how urgent to collect" into one number was flagged as a real
 * modeling gap when this project was still a tourist-reward system.
 *
 * This provider never predicts cyclone movement, wind, or rainfall -- the
 * risk zone geometry is an external input it merely reads.
 */
const BASELINE_URGENCY_FRACTION = 0.3; // priority a zero-risk node still carries, purely from its demand
const MAX_PRIORITY_PER_PERSON = 1; // priority points per unit of demand at maximum risk

export const riskPriorityProvider: RiskPriorityProvider = {
  getSnapshot(ctx: RewardContext): RiskPrioritySnapshot {
    const scenarioId = forecastScenarioIndex(ctx.secondsSinceStart, ctx.forecastIntervalSeconds);
    const zone = computeRiskZone(ctx.nodes, ctx.seed, scenarioId, ctx.startedAt, ctx.forecastIntervalSeconds);
    const outerRadius = zone.rings[zone.rings.length - 1].radiusKm;

    const riskScores = new Map<string, number>();
    const priorities = new Map<string, number>();

    for (const node of ctx.nodes) {
      if (node.role === "shelter") {
        riskScores.set(node.id, 0);
        priorities.set(node.id, 0);
        continue;
      }

      const distanceKm = distanceToRiskCenterKm(zone, node);
      const riskScore = Math.max(0, Math.min(1, 1 - distanceKm / outerRadius));
      riskScores.set(node.id, riskScore);

      const urgency = BASELINE_URGENCY_FRACTION + (1 - BASELINE_URGENCY_FRACTION) * riskScore;
      priorities.set(node.id, Math.round(node.demand * urgency * MAX_PRIORITY_PER_PERSON));
    }

    return {
      riskScores,
      priorities,
      forecast: {
        scenarioId: zone.scenarioId,
        generatedAtIso: zone.generatedAtIso,
        nextUpdateIso: zone.nextUpdateIso,
        concentration: zone.concentration,
        riskZone: zone.rings.map((ring) => ({
          centerX: zone.centerX,
          centerY: zone.centerY,
          radiusKm: ring.radiusKm,
          level: ring.level,
        })),
      },
    };
  },

  secondsUntilNextForecast(ctx: RewardContext): number {
    const elapsed = Math.max(0, ctx.secondsSinceStart) % ctx.forecastIntervalSeconds;
    return ctx.forecastIntervalSeconds - elapsed;
  },
};

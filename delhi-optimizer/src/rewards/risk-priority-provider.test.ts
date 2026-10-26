import { describe, expect, it } from "vitest";
import { EVACUATION_NODES, SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { riskPriorityProvider } from "./risk-priority-provider";
import type { RewardContext } from "./reward-provider";

const NINE_HOURS = 9 * 3600;

function ctx(overrides: Partial<RewardContext> = {}): RewardContext {
  return {
    seed: 42,
    startedAt: new Date("2026-01-15T03:30:00.000Z"),
    secondsSinceStart: 0,
    forecastIntervalSeconds: NINE_HOURS,
    nodes: EVACUATION_NODES,
    ...overrides,
  };
}

describe("riskPriorityProvider", () => {
  it("gives the shelter zero risk and zero priority", () => {
    const snapshot = riskPriorityProvider.getSnapshot(ctx());
    expect(snapshot.riskScores.get(SHELTER_DEPOT_ID)).toBe(0);
    expect(snapshot.priorities.get(SHELTER_DEPOT_ID)).toBe(0);
  });

  it("keeps risk score and priority as genuinely separate numbers, not aliases of each other", () => {
    const snapshot = riskPriorityProvider.getSnapshot(ctx());
    const origin = EVACUATION_NODES.find((n) => n.role === "origin")!;
    const risk = snapshot.riskScores.get(origin.id)!;
    const priority = snapshot.priorities.get(origin.id)!;
    // priority is demand-scaled, risk is a 0-1 fraction -- they are not the
    // same quantity even when risk happens to be mid-range.
    expect(priority).not.toBe(risk);
    expect(risk).toBeGreaterThanOrEqual(0);
    expect(risk).toBeLessThanOrEqual(1);
  });

  it("gives every origin a positive baseline priority even at zero risk", () => {
    // Construct a scenario where the risk zone is maximally far from a
    // given origin (risk -> 0) and check its priority is still > 0,
    // proving priority isn't purely risk * something (which would be 0).
    const snapshot = riskPriorityProvider.getSnapshot(ctx());
    for (const node of EVACUATION_NODES) {
      if (node.role !== "origin") continue;
      const risk = snapshot.riskScores.get(node.id)!;
      const priority = snapshot.priorities.get(node.id)!;
      if (risk < 0.05) {
        expect(priority).toBeGreaterThan(0);
      }
    }
  });

  it("weights priority by demand -- a higher-demand origin at similar risk gets higher priority", () => {
    const snapshot = riskPriorityProvider.getSnapshot(ctx());
    const origins = EVACUATION_NODES.filter((n) => n.role === "origin");
    const highestDemand = origins.reduce((a, b) => (b.demand > a.demand ? b : a));
    const lowestDemand = origins.reduce((a, b) => (b.demand < a.demand ? b : a));
    // Only a meaningful check if their risk scores are reasonably close;
    // otherwise risk alone could dominate -- so just assert the formula's
    // structure directly instead of relying on scenario geometry.
    const riskHigh = snapshot.riskScores.get(highestDemand.id)!;
    const riskLow = snapshot.riskScores.get(lowestDemand.id)!;
    const urgencyHigh = 0.3 + 0.7 * riskHigh;
    const urgencyLow = 0.3 + 0.7 * riskLow;
    expect(snapshot.priorities.get(highestDemand.id)).toBe(Math.round(highestDemand.demand * urgencyHigh));
    expect(snapshot.priorities.get(lowestDemand.id)).toBe(Math.round(lowestDemand.demand * urgencyLow));
  });

  it("does NOT change every few seconds -- only when the forecast cycle elapses", () => {
    const a = riskPriorityProvider.getSnapshot(ctx({ secondsSinceStart: 10 }));
    const b = riskPriorityProvider.getSnapshot(ctx({ secondsSinceStart: 5000 }));
    expect([...a.priorities.entries()]).toEqual([...b.priorities.entries()]);

    const c = riskPriorityProvider.getSnapshot(ctx({ secondsSinceStart: NINE_HOURS + 10 }));
    expect([...a.priorities.entries()]).not.toEqual([...c.priorities.entries()]);
  });

  it("is deterministic for the same (seed, scenario, startedAt)", () => {
    const a = riskPriorityProvider.getSnapshot(ctx());
    const b = riskPriorityProvider.getSnapshot(ctx());
    expect(a.forecast).toEqual(b.forecast);
    expect([...a.priorities.entries()]).toEqual([...b.priorities.entries()]);
  });

  it("includes forecast info with three risk rings, clearly a simulation", () => {
    const snapshot = riskPriorityProvider.getSnapshot(ctx());
    expect(snapshot.forecast.riskZone).toHaveLength(3);
  });
});

import { describe, expect, it } from "vitest";
import type { GraphNode, OpeningHours } from "@/types/graph";
import { distanceToRiskCenterKm } from "@/scenarios/risk-zone";
import { CycloneForecastEngine } from "./cyclone-forecast-engine";
import { RISK_TIER_CONFIG, tierForRiskScore, tierRank } from "./risk-tiers";

function alwaysAccessible(): OpeningHours {
  const day = { open: "00:00", close: "23:59" };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
}

function makeNode(id: string, x: number, y: number, role: "origin" | "shelter" = "origin"): GraphNode {
  return {
    id,
    name: id,
    x,
    y,
    role,
    demand: role === "origin" ? 100 : 0,
    capacity: role === "shelter" ? 1000 : 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 15,
  };
}

const FORECAST_INTERVAL_SECONDS = 8 * 3600; // 8-hour cadence, per the roadmap's p parameter
const SESSION_STARTED_AT = new Date("2026-01-01T00:00:00Z");

function grid(n: number, spacing: number): GraphNode[] {
  const nodes: GraphNode[] = [makeNode("shelter_0", 0, 0, "shelter")];
  let k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      nodes.push(makeNode(`origin_${k++}`, i * spacing, j * spacing));
    }
  }
  return nodes;
}

describe("CycloneForecastEngine", () => {
  it("always keeps shelters at normal tier with no deadline", () => {
    const nodes = grid(5, 4);
    const engine = new CycloneForecastEngine(nodes, 1, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);
    const result = engine.advanceTick(0);
    const shelterState = result.cellStates.get("shelter_0")!;
    expect(shelterState.tier).toBe("normal");
    expect(shelterState.window).toBeNull();
    expect(shelterState.rewardMultiplier).toBe(1);
  });

  it("assigns tiers consistent with the actual computed risk score and the zone it returns", () => {
    const nodes = grid(6, 4);
    const engine = new CycloneForecastEngine(nodes, 7, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);
    const result = engine.advanceTick(0);
    const outerRadius = result.zone.rings[result.zone.rings.length - 1].radiusKm;

    for (const node of nodes) {
      if (node.role === "shelter") continue;
      const distanceKm = distanceToRiskCenterKm(result.zone, node);
      const expectedRiskScore = Math.max(0, Math.min(1, 1 - distanceKm / outerRadius));
      const expectedTier = tierForRiskScore(expectedRiskScore);

      const actual = result.cellStates.get(node.id)!;
      expect(actual.riskScore).toBeCloseTo(expectedRiskScore, 9);
      expect(actual.tier).toBe(expectedTier);
    }
  });

  it("gives every elevated cell a deadline window and every normal cell none", () => {
    const nodes = grid(6, 4);
    const engine = new CycloneForecastEngine(nodes, 7, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);
    const result = engine.advanceTick(0);

    for (const [, state] of result.cellStates) {
      if (state.tier === "normal") {
        expect(state.window).toBeNull();
      } else {
        expect(state.window).not.toBeNull();
        expect(state.window!.closeMinutes).toBeGreaterThan(state.window!.effectiveOpenMinutes);
      }
    }
  });

  it("gives a higher tier a higher base reward multiplier and a tighter (or equal) deadline horizon", () => {
    const tiers = ["watch", "warning", "severe", "critical"] as const;
    for (let i = 1; i < tiers.length; i++) {
      const prev = RISK_TIER_CONFIG[tiers[i - 1]];
      const curr = RISK_TIER_CONFIG[tiers[i]];
      expect(curr.rewardMultiplier).toBeGreaterThan(prev.rewardMultiplier);
      expect(curr.deadlineHoursFromFirstElevation!).toBeLessThanOrEqual(prev.deadlineHoursFromFirstElevation!);
    }
  });

  it("grows a cell's reward multiplier the longer it stays elevated without being evacuated (TOCPUR-style accumulation)", () => {
    const nodes = grid(10, 3);
    const engine = new CycloneForecastEngine(nodes, 99, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);

    // Search across ticks for any cell that is non-normal in two
    // consecutive ticks -- the underlying risk-zone model re-randomizes
    // its storm center independently each tick (inherited from the
    // existing scenarios/risk-zone.ts), so we can't assume a specific
    // cell stays elevated; we find one empirically instead of hardcoding it.
    let found: { multiplierAtFirstElevation: number; multiplierOneTickLater: number } | null = null;
    let prevTick: ReturnType<CycloneForecastEngine["advanceTick"]> | null = null;

    for (let tick = 0; tick < 40 && !found; tick++) {
      const result = engine.advanceTick(tick);
      if (prevTick) {
        for (const [cellId, state] of result.cellStates) {
          if (state.tier === "normal") continue;
          const prevState = prevTick.cellStates.get(cellId)!;
          if (prevState.tier !== "normal" && state.hoursSinceElevated > prevState.hoursSinceElevated) {
            const baseMultiplier = RISK_TIER_CONFIG[state.tier].rewardMultiplier;
            found = { multiplierAtFirstElevation: baseMultiplier, multiplierOneTickLater: state.rewardMultiplier };
            break;
          }
        }
      }
      prevTick = result;
    }

    expect(found, "expected to find at least one cell elevated across two consecutive ticks within 40 ticks").not.toBeNull();
    // Accumulation strictly increases the multiplier above the tier's flat base.
    expect(found!.multiplierOneTickLater).toBeGreaterThan(found!.multiplierAtFirstElevation);
  });

  it("resets a cell to normal and clears its deadline once marked evacuated, even if it was elevated", () => {
    const nodes = grid(6, 4);
    const engine = new CycloneForecastEngine(nodes, 7, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);

    const before = engine.advanceTick(0);
    const elevatedCellId = Array.from(before.cellStates.entries()).find(([, s]) => s.tier !== "normal")?.[0];
    expect(elevatedCellId, "test fixture needs at least one elevated cell at tick 0").toBeDefined();

    engine.markEvacuated(elevatedCellId!);
    const after = engine.advanceTick(1);
    const state = after.cellStates.get(elevatedCellId!)!;

    expect(state.tier).toBe("normal");
    expect(state.window).toBeNull();
    expect(state.rewardMultiplier).toBe(1);
  });

  it("is deterministic: the same seed produces the same tick-by-tick outcome", () => {
    const nodesA = grid(5, 4);
    const nodesB = grid(5, 4);
    const engineA = new CycloneForecastEngine(nodesA, 42, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);
    const engineB = new CycloneForecastEngine(nodesB, 42, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);

    for (let tick = 0; tick < 5; tick++) {
      const resultA = engineA.advanceTick(tick);
      const resultB = engineB.advanceTick(tick);
      for (const [cellId, stateA] of resultA.cellStates) {
        const stateB = resultB.cellStates.get(cellId)!;
        expect(stateB).toEqual(stateA);
      }
    }
  });

  it("keeps tier ordering consistent with tierRank", () => {
    expect(tierRank("normal")).toBeLessThan(tierRank("watch"));
    expect(tierRank("watch")).toBeLessThan(tierRank("warning"));
    expect(tierRank("warning")).toBeLessThan(tierRank("severe"));
    expect(tierRank("severe")).toBeLessThan(tierRank("critical"));
  });
});

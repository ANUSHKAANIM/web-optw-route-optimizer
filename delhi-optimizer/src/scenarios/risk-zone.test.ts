import { describe, expect, it } from "vitest";
import { EVACUATION_NODES } from "@/data/evacuation-nodes";
import { computeRiskZone, distanceToRiskCenterKm, forecastScenarioIndex, riskLevelForDistance } from "./risk-zone";

const STARTED_AT = new Date("2026-01-15T03:30:00.000Z");

describe("forecastScenarioIndex", () => {
  it("advances once the 9h interval elapses", () => {
    const nineHours = 9 * 3600;
    expect(forecastScenarioIndex(0, nineHours)).toBe(0);
    expect(forecastScenarioIndex(nineHours - 1, nineHours)).toBe(0);
    expect(forecastScenarioIndex(nineHours, nineHours)).toBe(1);
  });
});

describe("computeRiskZone", () => {
  it("is deterministic for the same (seed, scenarioId)", () => {
    const a = computeRiskZone(EVACUATION_NODES, 42, 3, STARTED_AT, 32400);
    const b = computeRiskZone(EVACUATION_NODES, 42, 3, STARTED_AT, 32400);
    expect(a).toEqual(b);
  });

  it("changes when the scenario advances", () => {
    const a = computeRiskZone(EVACUATION_NODES, 42, 0, STARTED_AT, 32400);
    const b = computeRiskZone(EVACUATION_NODES, 42, 1, STARTED_AT, 32400);
    expect(a.centerX).not.toBe(b.centerX);
  });

  it("produces three concentric rings, high risk innermost", () => {
    const zone = computeRiskZone(EVACUATION_NODES, 7, 2, STARTED_AT, 32400);
    expect(zone.rings.map((r) => r.level)).toEqual(["high", "medium", "low"]);
    expect(zone.rings[0].radiusKm).toBeLessThan(zone.rings[1].radiusKm);
    expect(zone.rings[1].radiusKm).toBeLessThan(zone.rings[2].radiusKm);
  });
});

describe("riskLevelForDistance / distanceToRiskCenterKm", () => {
  it("classifies distances into the right ring", () => {
    const zone = computeRiskZone(EVACUATION_NODES, 1, 0, STARTED_AT, 32400);
    expect(riskLevelForDistance(zone, 0)).toBe("high");
    expect(riskLevelForDistance(zone, zone.rings[2].radiusKm + 100)).toBe("none");
  });

  it("computes a real, non-negative distance for every node", () => {
    const zone = computeRiskZone(EVACUATION_NODES, 1, 0, STARTED_AT, 32400);
    for (const node of EVACUATION_NODES) {
      expect(distanceToRiskCenterKm(zone, node)).toBeGreaterThanOrEqual(0);
    }
  });
});

import { describe, expect, it } from "vitest";
import { computeRiskZone, forecastScenarioIndex } from "./risk-zone";
import { orderedGeoPlaces } from "@/lib/env/geo-environment";

const STARTED_AT = new Date("2026-01-15T03:30:00.000Z");
const places = orderedGeoPlaces();

describe("forecastScenarioIndex", () => {
  it("advances once the interval elapses", () => {
    const nineHours = 9 * 3600;
    expect(forecastScenarioIndex(0, nineHours)).toBe(0);
    expect(forecastScenarioIndex(nineHours - 1, nineHours)).toBe(0);
    expect(forecastScenarioIndex(nineHours, nineHours)).toBe(1);
  });
});

describe("computeRiskZone", () => {
  it("is deterministic for the same (seed, scenarioId)", () => {
    const a = computeRiskZone(places, 42, 3, STARTED_AT, 32400);
    const b = computeRiskZone(places, 42, 3, STARTED_AT, 32400);
    expect(a).toEqual(b);
  });

  it("changes when the scenario advances", () => {
    const a = computeRiskZone(places, 42, 0, STARTED_AT, 32400);
    const b = computeRiskZone(places, 42, 1, STARTED_AT, 32400);
    expect(a.centerLatitude).not.toBe(b.centerLatitude);
  });

  it("places the zone center within the real Delhi places bounding box", () => {
    const lats = places.map((p) => p.latitude);
    const lngs = places.map((p) => p.longitude);
    const zone = computeRiskZone(places, 7, 2, STARTED_AT, 32400);
    expect(zone.centerLatitude).toBeGreaterThanOrEqual(Math.min(...lats));
    expect(zone.centerLatitude).toBeLessThanOrEqual(Math.max(...lats));
    expect(zone.centerLongitude).toBeGreaterThanOrEqual(Math.min(...lngs));
    expect(zone.centerLongitude).toBeLessThanOrEqual(Math.max(...lngs));
  });

  it("stamps a validity window that starts at generation and lasts one interval", () => {
    const intervalSeconds = 32400;
    const zone = computeRiskZone(places, 1, 2, STARTED_AT, intervalSeconds);
    const generated = new Date(zone.generatedAt).getTime();
    const validUntil = new Date(zone.validUntil).getTime();
    expect(validUntil - generated).toBe(intervalSeconds * 1000);
    expect(generated).toBe(STARTED_AT.getTime() + 2 * intervalSeconds * 1000);
  });
});

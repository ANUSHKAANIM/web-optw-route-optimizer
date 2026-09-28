import { describe, expect, it } from "vitest";
import { haversineKm, isValidCoordinate } from "./haversine";

describe("haversineKm", () => {
  it("is zero for identical points", () => {
    expect(haversineKm([28.6139, 77.209], [28.6139, 77.209])).toBeCloseTo(0, 6);
  });

  it("is symmetric", () => {
    const a: [number, number] = [28.6129, 77.2295]; // India Gate
    const b: [number, number] = [28.5245, 77.1855]; // Qutub Minar
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 9);
  });

  it("matches the known real-world distance between India Gate and Qutub Minar (~11-12 km)", () => {
    const indiaGate: [number, number] = [28.6129, 77.2295];
    const qutubMinar: [number, number] = [28.5245, 77.1855];
    const km = haversineKm(indiaGate, qutubMinar);
    expect(km).toBeGreaterThan(9);
    expect(km).toBeLessThan(13);
  });

  it("obeys the triangle inequality", () => {
    const a: [number, number] = [28.6129, 77.2295];
    const b: [number, number] = [28.5245, 77.1855];
    const c: [number, number] = [28.6562, 77.241];
    expect(haversineKm(a, c)).toBeLessThanOrEqual(haversineKm(a, b) + haversineKm(b, c) + 1e-9);
  });
});

describe("isValidCoordinate", () => {
  it("accepts real Delhi coordinates", () => {
    expect(isValidCoordinate([28.6139, 77.209])).toBe(true);
  });

  it("rejects out-of-range or non-finite values", () => {
    expect(isValidCoordinate([91, 0])).toBe(false);
    expect(isValidCoordinate([0, 181])).toBe(false);
    expect(isValidCoordinate([NaN, 0])).toBe(false);
  });
});

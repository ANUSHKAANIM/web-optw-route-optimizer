import { describe, expect, it } from "vitest";
import type { GraphNode, OpeningHours } from "@/types/graph";
import { CycloneForecastEngine } from "./cyclone-forecast-engine";
import { priorityFromForecastTick } from "./priority-from-forecast";

function alwaysAccessible(): OpeningHours {
  const day = { open: "00:00", close: "23:59" };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
}

function makeNode(id: string, x: number, y: number, demand: number, role: "origin" | "shelter" = "origin"): GraphNode {
  return {
    id,
    name: id,
    x,
    y,
    role,
    demand: role === "origin" ? demand : 0,
    capacity: role === "shelter" ? 1000 : 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 15,
  };
}

const FORECAST_INTERVAL_SECONDS = 8 * 3600;
const SESSION_STARTED_AT = new Date("2026-01-01T00:00:00Z");

describe("priorityFromForecastTick", () => {
  it("gives shelters zero priority and zero risk score regardless of the tick", () => {
    const nodes = [makeNode("shelter_0", 0, 0, 0, "shelter"), makeNode("origin_0", 5, 5, 200)];
    const engine = new CycloneForecastEngine(nodes, 1, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);
    const tick = engine.advanceTick(0);
    const snapshot = priorityFromForecastTick(nodes, tick);

    expect(snapshot.priorities.get("shelter_0")).toBe(0);
    expect(snapshot.riskScores.get("shelter_0")).toBe(0);
  });

  it("gives a normal-tier origin baseline-urgency priority only (multiplier 1)", () => {
    // Place the origin far outside the simulated risk zone so it stays
    // "normal" regardless of where the storm center lands.
    const nodes = [makeNode("shelter_0", 0, 0, 0, "shelter"), makeNode("origin_far", 100000, 100000, 300)];
    const engine = new CycloneForecastEngine(nodes, 1, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);
    const tick = engine.advanceTick(0);
    const state = tick.cellStates.get("origin_far")!;
    expect(state.tier).toBe("normal");

    const snapshot = priorityFromForecastTick(nodes, tick);
    const expectedPriority = Math.round(300 * (0.3 + 0.7 * state.riskScore) * 1);
    expect(snapshot.priorities.get("origin_far")).toBe(expectedPriority);
  });

  it("gives an elevated-tier origin strictly more priority than the same origin would get at multiplier 1", () => {
    const nodes = [makeNode("shelter_0", 0, 0, 0, "shelter"), makeNode("origin_a", 5, 5, 300), makeNode("origin_b", -5, -5, 300)];
    const engine = new CycloneForecastEngine(nodes, 7, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);
    const tick = engine.advanceTick(0);

    const elevated = Array.from(tick.cellStates.entries()).find(([id, s]) => id !== "shelter_0" && s.tier !== "normal");
    expect(elevated, "test fixture needs at least one elevated origin").toBeDefined();
    const [elevatedId, state] = elevated!;

    const snapshot = priorityFromForecastTick(nodes, tick);
    const actualPriority = snapshot.priorities.get(elevatedId)!;

    const node = nodes.find((n) => n.id === elevatedId)!;
    const baselineOnlyPriority = Math.round(node.demand * (0.3 + 0.7 * state.riskScore) * 1);

    expect(actualPriority).toBeGreaterThan(baselineOnlyPriority);
  });
});

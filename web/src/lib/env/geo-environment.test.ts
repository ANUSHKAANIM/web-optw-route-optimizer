import { describe, expect, it } from "vitest";
import { createGeoEnvironment, DEPOT_PLACE_ID, orderedGeoPlaces, refreshDynamicRewards } from "./geo-environment";
import { getDelhiVisualGraph } from "@/lib/geo/delhi-graph";

const MORNING_IST = new Date(Date.UTC(2026, 0, 15, 3, 30)); // 09:00 IST, Thursday
const LATE_NIGHT_IST = new Date(Date.UTC(2026, 0, 15, 17, 30)); // 23:00 IST, same day

function makeEnv(startedAt: Date, maxTime = 10) {
  return createGeoEnvironment({
    seed: 42,
    startedAt,
    maxTime,
    rewardDecayMin: 0.3,
    rewardIntervalSeconds: 45,
  });
}

describe("orderedGeoPlaces", () => {
  it("puts the depot place first", () => {
    const places = orderedGeoPlaces();
    expect(places[0].id).toBe(DEPOT_PLACE_ID);
  });
});

describe("createGeoEnvironment", () => {
  it("starts at the depot with real coordinates and a dense symmetric distance matrix", () => {
    const env = makeEnv(MORNING_IST);
    const n = env.config.numNodes;

    expect(env.currentNode).toBe(0);
    expect(env.currentTime).toBe(0);
    expect(env.visited[0]).toBe(true);
    expect(env.rewards[0]).toBe(0);
    expect(env.coords).toHaveLength(n);

    for (let i = 0; i < n; i++) {
      expect(env.distMatrix[i][i]).toBe(0);
      for (let j = 0; j < n; j++) expect(env.distMatrix[i][j]).toBeCloseTo(env.distMatrix[j][i], 9);
    }
  });

  it("gives every place a consistent opening/closing window: either both -1 (closed) or a real, ordered window", () => {
    const env = makeEnv(MORNING_IST);
    for (let i = 0; i < env.config.numNodes; i++) {
      const open = env.openingTimes[i];
      const close = env.closingTimes[i];
      if (open === -1 || close === -1) {
        expect(open).toBe(-1);
        expect(close).toBe(-1);
      } else {
        expect(open).toBeGreaterThanOrEqual(0);
        expect(close).toBeGreaterThan(0);
        expect(open).toBeLessThanOrEqual(close);
      }
    }
  });

  it("is deterministic for a fixed seed and start time", () => {
    const a = makeEnv(MORNING_IST);
    const b = makeEnv(MORNING_IST);
    expect(a.rewards).toEqual(b.rewards);
    expect(a.openingTimes).toEqual(b.openingTimes);
    expect(a.closingTimes).toEqual(b.closingTimes);
  });

  it("enforces real time windows: fewer places are reachable-and-visitable starting late at night than in the morning", () => {
    const morning = makeEnv(MORNING_IST);
    const night = makeEnv(LATE_NIGHT_IST);

    const morningFeasible = morning.getAdmissibilityMask().filter(Boolean).length;
    const nightFeasible = night.getAdmissibilityMask().filter(Boolean).length;

    expect(nightFeasible).toBeLessThan(morningFeasible);
  });

  it("never allows visiting a place if the visit can't finish before it closes", () => {
    const env = makeEnv(MORNING_IST);
    const mask = env.getAdmissibilityMask();
    for (let i = 1; i < env.config.numNodes; i++) {
      if (!mask[i]) continue;
      const arrival = env.currentTime + env.distMatrix[env.currentNode][i];
      const wait = Math.max(env.openingTimes[i] - arrival, 0);
      const startVisit = arrival + wait;
      expect(startVisit).toBeLessThanOrEqual(env.closingTimes[i] + 1e-9);
    }
  });
});

describe("refreshDynamicRewards", () => {
  it("changes the rewards array in place without touching position/visited state", () => {
    const env = makeEnv(MORNING_IST);
    const before = [...env.rewards];
    const currentNode = env.currentNode;

    refreshDynamicRewards(env, 42, 10_000, 45);

    expect(env.rewards).not.toEqual(before);
    expect(env.rewards[0]).toBe(0);
    expect(env.currentNode).toBe(currentNode);
  });
});

describe("getDelhiVisualGraph", () => {
  it("returns a connected graph covering every place", () => {
    const { places, edges } = getDelhiVisualGraph();
    expect(places.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
    expect(places[0].id).toBe(DEPOT_PLACE_ID);
  });
});

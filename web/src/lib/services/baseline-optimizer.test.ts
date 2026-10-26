import { describe, expect, it } from "vitest";
import { OptwEnvironment } from "@/lib/env/optw-environment";
import { baselineHeuristicSearch } from "./baseline-optimizer";

function makeEnv(seed: number) {
  return new OptwEnvironment({
    numNodes: 25,
    maxTime: 20,
    rewardDecayMin: 0.3,
    enableForecastEvents: false,
    hazardRadius: 0.4,
    forecastUpdateInterval: 4,
    forecastNoise: 0.12,
    forecastTrackWaypoints: 5,
    seed,
  });
}

describe("baselineHeuristicSearch", () => {
  it("returns a valid route that starts and ends at the depot", () => {
    const result = baselineHeuristicSearch(makeEnv(11));
    expect(result.path[0]).toBe(0);
    expect(result.path[result.path.length - 1]).toBe(0);
    expect(result.totalReward).toBeGreaterThanOrEqual(0);
    expect(result.finalTime).toBeLessThanOrEqual(20 + 1e-6);
  });

  it("never visits the same node twice", () => {
    const result = baselineHeuristicSearch(makeEnv(22));
    const middle = result.path.slice(1, -1);
    expect(new Set(middle).size).toBe(middle.length);
  });

  it("does not mutate the environment passed in", () => {
    const env = makeEnv(5);
    baselineHeuristicSearch(env);
    expect(env.currentNode).toBe(0);
    expect(env.visited.slice(1).every((v) => !v)).toBe(true);
  });

  it("is deterministic for a fixed instance", () => {
    const a = baselineHeuristicSearch(makeEnv(99));
    const b = baselineHeuristicSearch(makeEnv(99));
    expect(a).toEqual(b);
  });
});

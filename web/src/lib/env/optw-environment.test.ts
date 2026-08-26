import { describe, expect, it } from "vitest";
import { OptwEnvironment, type OptwConfig } from "./optw-environment";

function makeEnv(overrides: Partial<OptwConfig> = {}) {
  return new OptwEnvironment({
    numNodes: 10,
    maxTime: 24,
    rewardDecayMin: 0.3,
    enableForecastEvents: false,
    hazardRadius: 0.4,
    forecastUpdateInterval: 4,
    forecastNoise: 0.12,
    forecastTrackWaypoints: 5,
    seed: 42,
    ...overrides,
  });
}

describe("OptwEnvironment", () => {
  it("starts at the depot with only the depot marked visited", () => {
    const env = makeEnv();
    expect(env.currentNode).toBe(0);
    expect(env.currentTime).toBe(0);
    expect(env.visited[0]).toBe(true);
    expect(env.visited.slice(1).every((v) => !v)).toBe(true);
    expect(env.rewards[0]).toBe(0);
  });

  it("is deterministic for a fixed seed", () => {
    const a = makeEnv({ seed: 7 });
    const b = makeEnv({ seed: 7 });
    expect(a.coords).toEqual(b.coords);
    expect(a.rewards).toEqual(b.rewards);
  });

  it("produces different instances for different seeds", () => {
    const a = makeEnv({ seed: 1 });
    const b = makeEnv({ seed: 2 });
    expect(a.coords).not.toEqual(b.coords);
  });

  it("never marks the depot or already-visited nodes as admissible", () => {
    const env = makeEnv();
    const mask = env.getAdmissibilityMask();
    expect(mask[0]).toBe(false);
  });

  it("marks a node infeasible once visited", () => {
    const env = makeEnv();
    const mask = env.getAdmissibilityMask();
    const firstFeasible = mask.findIndex(Boolean);
    expect(firstFeasible).toBeGreaterThan(0);

    env.step(firstFeasible);
    expect(env.visited[firstFeasible]).toBe(true);
    expect(env.getAdmissibilityMask()[firstFeasible]).toBe(false);
  });

  it("clamps the reward decay fraction between rewardDecayMin and 1.0", () => {
    const env = makeEnv({ rewardDecayMin: 0.3 });
    const effective = env.getEffectiveRewards();
    for (let i = 1; i < effective.length; i++) {
      const decayFraction = env.rewards[i] === 0 ? 0 : effective[i] / env.rewards[i];
      if (env.rewards[i] > 0) {
        expect(decayFraction).toBeGreaterThanOrEqual(0.3 - 1e-9);
        expect(decayFraction).toBeLessThanOrEqual(1.0 + 1e-9);
      }
    }
  });

  it("clone() produces an independent copy", () => {
    const env = makeEnv();
    const mask = env.getAdmissibilityMask();
    const firstFeasible = mask.findIndex(Boolean);
    const clone = env.clone();

    env.step(firstFeasible);

    expect(clone.currentNode).toBe(0);
    expect(clone.visited[firstFeasible]).toBe(false);
  });

  it("eventually terminates (admissibility mask becomes all-false)", () => {
    const env = makeEnv({ numNodes: 8, maxTime: 6 });
    let done = false;
    let steps = 0;
    while (!done && steps < 100) {
      const mask = env.getAdmissibilityMask();
      const next = mask.findIndex(Boolean);
      if (next === -1) break;
      ({ done } = env.step(next));
      steps++;
    }
    expect(steps).toBeLessThan(100);
  });
});

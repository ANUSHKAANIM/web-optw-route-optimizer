import { describe, expect, it } from "vitest";
import { OptwEnvironment } from "@/lib/env/optw-environment";
import { optimizerService } from "@/lib/services/optimizer.service.impl";

/** End-to-end check that the ONNX model loads under onnxruntime-node and
 * that greedy/beam search over the TypeScript-ported environment produce
 * valid, terminating routes -- the same guarantee run_pipeline.py's
 * greedy_search/beam_search give in Python. Doesn't require a database. */
describe("optimizerService (real ONNX inference)", () => {
  it("greedySearch returns a valid route that starts and ends at the depot", async () => {
    const env = new OptwEnvironment({
      numNodes: 20,
      maxTime: 24,
      rewardDecayMin: 0.3,
      enableForecastEvents: false,
      hazardRadius: 0.4,
      forecastUpdateInterval: 4,
      forecastNoise: 0.12,
      forecastTrackWaypoints: 5,
      seed: 123,
    });

    const result = await optimizerService.greedySearch(env);

    expect(result.path[0]).toBe(0);
    expect(result.path[result.path.length - 1]).toBe(0);
    expect(result.totalReward).toBeGreaterThanOrEqual(0);
    expect(result.finalTime).toBeLessThanOrEqual(env.config.maxTime + 1e-6);
    // No node (other than the depot, which brackets the route) visited twice.
    const middle = result.path.slice(1, -1);
    expect(new Set(middle).size).toBe(middle.length);
  }, 30_000);

  it("beamSearch with width>1 never does worse than a width-1 beam (greedy-equivalent)", async () => {
    const makeEnv = () =>
      new OptwEnvironment({
        numNodes: 15,
        maxTime: 20,
        rewardDecayMin: 0.3,
        enableForecastEvents: false,
        hazardRadius: 0.4,
        forecastUpdateInterval: 4,
        forecastNoise: 0.12,
        forecastTrackWaypoints: 5,
        seed: 99,
      });

    const narrow = await optimizerService.beamSearch(makeEnv(), 1);
    const wide = await optimizerService.beamSearch(makeEnv(), 16);

    expect(wide.totalReward).toBeGreaterThanOrEqual(narrow.totalReward - 1e-6);
  }, 30_000);
});

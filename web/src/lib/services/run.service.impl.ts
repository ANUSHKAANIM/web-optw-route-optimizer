import { OptwEnvironment } from "@/lib/env/optw-environment";
import { restoreEnvironment, snapshotEnvironment } from "@/lib/env/serialization";
import { createSeed } from "@/lib/env/rng";
import { initialDecoderState } from "@/lib/services/inference.service";
import {
  restoreDecoderState,
  snapshotDecoderState,
} from "@/lib/services/decoder-state-serialization";
import { applyChosenAction, optimizerService } from "@/lib/services/optimizer.service.impl";
import { runRepository } from "@/lib/repositories/run.repository";
import type { CreateRunRequest, ListRunsQuery } from "@/lib/dto/run.dto";
import { InfeasibleActionError, RunAlreadyCompletedError } from "@/lib/errors/domain-error";
import type { Run, RunEvent } from "@/db/schema";
import type { ComparisonView, RunService, RunView } from "@/lib/services/run.service";

function toRunView(run: Run, forecastJustUpdated = false): RunView {
  const envSnapshot = run.envState as ReturnType<typeof snapshotEnvironment>;
  return {
    run,
    recommendation: run.recommendation as RunView["recommendation"],
    coords: envSnapshot.coords,
    rewards: envSnapshot.rewards,
    maxTime: envSnapshot.config.maxTime,
    done: run.status === "completed",
    forecastJustUpdated,
  };
}

async function createRun(request: CreateRunRequest): Promise<RunView> {
  const seed = request.seed ?? createSeed();

  const env = new OptwEnvironment({
    numNodes: request.numNodes,
    maxTime: request.maxTime,
    rewardDecayMin: request.rewardDecayMin,
    enableForecastEvents: request.enableForecastEvents,
    hazardRadius: request.hazardRadius,
    forecastUpdateInterval: request.forecastUpdateInterval,
    forecastNoise: request.forecastNoise,
    forecastTrackWaypoints: 5,
    seed,
  });

  const decoderState = initialDecoderState(env.config.numNodes);
  const { recommendation, advancedDecoderState } = await optimizerService.recommend(
    env,
    decoderState,
    request.beamWidth,
  );

  const run = await runRepository.create({
    numNodes: request.numNodes,
    maxTime: request.maxTime,
    beamWidth: request.beamWidth,
    rewardDecayMin: request.rewardDecayMin,
    forecastEnabled: request.enableForecastEvents,
    seed,
    status: "in_progress",
    initialEnvState: snapshotEnvironment(env),
    envState: snapshotEnvironment(env),
    decoderState: snapshotDecoderState(advancedDecoderState),
    recommendation,
    path: [0],
    currentNode: 0,
    currentTime: 0,
    totalReward: 0,
  });

  return toRunView(run);
}

async function getRun(id: number): Promise<RunView> {
  const run = await runRepository.findById(id);
  return toRunView(run);
}

async function stepRun(id: number, node: number): Promise<RunView> {
  const existing = await runRepository.findById(id);
  if (existing.status === "completed") throw new RunAlreadyCompletedError(id);

  const env = restoreEnvironment(existing.envState as Parameters<typeof restoreEnvironment>[0]);
  const decoderStateBefore = restoreDecoderState(
    existing.decoderState as Parameters<typeof restoreDecoderState>[0],
  );

  const mask = env.getAdmissibilityMask();
  if (!mask[node]) throw new InfeasibleActionError(node);

  const { reward, done } = env.step(node);
  const decoderStateAfter = applyChosenAction(decoderStateBefore, node);

  const path = [...(existing.path as number[]), node];
  const totalReward = existing.totalReward + reward;

  await runRepository.appendEvent({
    runId: id,
    stepIndex: path.length - 1,
    node,
    reward,
    cumulativeReward: totalReward,
    currentTime: env.currentTime,
    forecastUpdated: env.lastStepForecastUpdated,
  });

  let recommendation;
  if (done) {
    const returnTravelTime = env.distMatrix[env.currentNode][0];
    recommendation = {
      path: [...path, 0],
      totalReward,
      finalTime: env.currentTime + returnTravelTime,
      feasibleNodes: [],
      effectiveRewards: env.getEffectiveRewards(),
    };
  } else {
    const result = await optimizerService.recommend(env, decoderStateAfter, existing.beamWidth);
    recommendation = result.recommendation;
  }

  const updated = await runRepository.update(id, {
    envState: snapshotEnvironment(env),
    decoderState: snapshotDecoderState(decoderStateAfter),
    recommendation,
    path,
    currentNode: env.currentNode,
    currentTime: env.currentTime,
    totalReward,
    status: done ? "completed" : "in_progress",
    finalTime: done ? recommendation.finalTime : null,
  });

  return toRunView(updated, env.lastStepForecastUpdated);
}

async function endRun(id: number): Promise<RunView> {
  const existing = await runRepository.findById(id);
  if (existing.status === "completed") return toRunView(existing);

  const env = restoreEnvironment(existing.envState as Parameters<typeof restoreEnvironment>[0]);
  const returnTravelTime = env.distMatrix[env.currentNode][0];
  const finalTime = env.currentTime + returnTravelTime;
  const path = [...(existing.path as number[]), 0];

  const recommendation = {
    path,
    totalReward: existing.totalReward,
    finalTime,
    feasibleNodes: [],
    effectiveRewards: env.getEffectiveRewards(),
  };

  const updated = await runRepository.update(id, {
    path,
    recommendation,
    status: "completed",
    finalTime,
  });

  return toRunView(updated);
}

async function compareRun(id: number): Promise<ComparisonView> {
  const existing = await runRepository.findById(id);
  const initialSnapshot = existing.initialEnvState as Parameters<typeof restoreEnvironment>[0];

  const [greedy, beam] = await Promise.all([
    optimizerService.greedySearch(restoreEnvironment(initialSnapshot)),
    optimizerService.beamSearch(restoreEnvironment(initialSnapshot), existing.beamWidth),
  ]);

  return {
    coords: initialSnapshot.coords,
    rewards: initialSnapshot.rewards,
    maxTime: initialSnapshot.config.maxTime,
    greedy,
    beam,
    beamWidth: existing.beamWidth,
  };
}

async function listEvents(id: number): Promise<RunEvent[]> {
  return runRepository.listEvents(id);
}

async function listRuns(query: ListRunsQuery) {
  return runRepository.list(query);
}

export const runService: RunService = {
  createRun,
  getRun,
  stepRun,
  endRun,
  compareRun,
  listEvents,
  listRuns,
};

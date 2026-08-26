import { OptwEnvironment } from "@/lib/env/optw-environment";
import {
  embeddingForNode,
  initialDecoderState,
  runInferenceStep,
  type DecoderState,
} from "@/lib/services/inference.service";
import type {
  OptimizerService,
  RecommendationResult,
  RouteResult,
} from "@/lib/services/optimizer.service";

interface BeamState {
  env: OptwEnvironment;
  decoderState: DecoderState;
  path: number[];
  totalReward: number;
  logProbScore: number;
  done: boolean;
}

function finalizeRoute(env: OptwEnvironment, path: number[], totalReward: number): RouteResult {
  const returnTravelTime = env.distMatrix[env.currentNode][0];
  return {
    path: [...path, 0],
    totalReward,
    finalTime: env.currentTime + returnTravelTime,
  };
}

function topKFeasibleIndices(probs: number[], mask: boolean[], k: number): number[] {
  const feasible = mask
    .map((isFeasible, idx) => (isFeasible ? idx : -1))
    .filter((idx) => idx !== -1);
  feasible.sort((a, b) => probs[b] - probs[a]);
  return feasible.slice(0, k);
}

async function greedySearch(envInitial: OptwEnvironment): Promise<RouteResult> {
  const env = envInitial.clone();
  let decoderState = initialDecoderState(env.config.numNodes);
  const path = [0];
  let totalReward = 0;

  while (true) {
    const adjMask = env.getAdjacencyMatrix();
    const mask = env.getAdmissibilityMask();
    if (!mask.some(Boolean)) break;

    const { staticFeats, dynamicFeats } = env.getState();
    const { probs, nextDecoderState } = await runInferenceStep({
      staticFeats,
      dynamicFeats,
      adjMask,
      mask,
      decoderState,
    });

    const action = argmax(probs);
    const { reward, done } = env.step(action);

    path.push(action);
    totalReward += reward;
    decoderState = {
      hLstm: nextDecoderState.hLstm,
      cLstm: nextDecoderState.cLstm,
      prevHE: nextDecoderState.prevHE,
      currentEmbedding: embeddingForNode(nextDecoderState.prevHE, action),
    };

    if (done) break;
  }

  return finalizeRoute(env, path, totalReward);
}

async function beamSearch(
  envInitial: OptwEnvironment,
  beamWidth: number,
  seed?: { decoderState: DecoderState; startNode: number },
): Promise<RouteResult> {
  const startNode = seed?.startNode ?? 0;
  const initialDecoder = seed?.decoderState ?? initialDecoderState(envInitial.config.numNodes);

  let beams: BeamState[] = [
    {
      env: envInitial.clone(),
      decoderState: initialDecoder,
      path: [startNode],
      totalReward: 0,
      logProbScore: 0,
      done: false,
    },
  ];
  const completed: BeamState[] = [];

  while (beams.length > 0) {
    const candidates: BeamState[] = [];

    for (const beam of beams) {
      if (beam.done) {
        completed.push(beam);
        continue;
      }

      const mask = beam.env.getAdmissibilityMask();
      if (!mask.some(Boolean)) {
        completed.push({ ...beam, done: true });
        continue;
      }

      const adjMask = beam.env.getAdjacencyMatrix();
      const { staticFeats, dynamicFeats } = beam.env.getState();
      const { probs, nextDecoderState } = await runInferenceStep({
        staticFeats,
        dynamicFeats,
        adjMask,
        mask,
        decoderState: beam.decoderState,
      });

      const topNodes = topKFeasibleIndices(probs, mask, beamWidth);

      for (const action of topNodes) {
        const nextEnv = beam.env.clone();
        const { reward, done } = nextEnv.step(action);

        candidates.push({
          env: nextEnv,
          decoderState: {
            hLstm: nextDecoderState.hLstm,
            cLstm: nextDecoderState.cLstm,
            prevHE: nextDecoderState.prevHE,
            currentEmbedding: embeddingForNode(nextDecoderState.prevHE, action),
          },
          path: [...beam.path, action],
          totalReward: beam.totalReward + reward,
          logProbScore: beam.logProbScore + Math.log(probs[action] + 1e-8),
          done,
        });
      }
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => b.logProbScore - a.logProbScore);
    beams = candidates.slice(0, beamWidth);
  }

  const allCompleted = [...completed, ...beams];
  const best = allCompleted.reduce((a, b) => (b.totalReward > a.totalReward ? b : a));

  return finalizeRoute(best.env, best.path, best.totalReward);
}

async function recommend(
  env: OptwEnvironment,
  decoderState: DecoderState,
  beamWidth: number,
): Promise<{ recommendation: RecommendationResult; advancedDecoderState: DecoderState }> {
  const adjMask = env.getAdjacencyMatrix();
  const mask = env.getAdmissibilityMask();
  const { staticFeats, dynamicFeats } = env.getState();

  const { nextDecoderState } = await runInferenceStep({
    staticFeats,
    dynamicFeats,
    adjMask,
    mask,
    decoderState,
  });

  const feasibleNodes = mask.map((v, i) => (v ? i : -1)).filter((i) => i !== -1);

  const seedForBeam: DecoderState = {
    hLstm: nextDecoderState.hLstm,
    cLstm: nextDecoderState.cLstm,
    prevHE: decoderState.prevHE,
    currentEmbedding: decoderState.currentEmbedding,
  };

  const route = feasibleNodes.length
    ? await beamSearch(env, beamWidth, { decoderState: seedForBeam, startNode: env.currentNode })
    : finalizeRoute(env, [env.currentNode], 0);

  return {
    recommendation: {
      ...route,
      feasibleNodes,
      effectiveRewards: env.getEffectiveRewards(),
    },
    // Full decoder update to use IF the user follows this decision point and
    // moves to some action; embeddingForNode is applied by the caller once
    // the actual chosen action is known.
    advancedDecoderState: {
      hLstm: nextDecoderState.hLstm,
      cLstm: nextDecoderState.cLstm,
      prevHE: nextDecoderState.prevHE,
      currentEmbedding: decoderState.currentEmbedding,
    },
  };
}

function argmax(values: number[]): number {
  let bestIdx = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[bestIdx]) bestIdx = i;
  }
  return bestIdx;
}

export const optimizerService: OptimizerService = {
  greedySearch,
  beamSearch,
  recommend,
};

/** Finalizes the decoder state after the user's chosen action, given the
 * `advancedDecoderState` returned by `recommend()` for the same decision point. */
export function applyChosenAction(
  advancedDecoderState: DecoderState,
  action: number,
): DecoderState {
  return {
    hLstm: advancedDecoderState.hLstm,
    cLstm: advancedDecoderState.cLstm,
    prevHE: advancedDecoderState.prevHE,
    currentEmbedding: embeddingForNode(advancedDecoderState.prevHE, action),
  };
}

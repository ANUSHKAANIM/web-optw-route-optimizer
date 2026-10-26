import type { Graph, Weekday } from "@/types/graph";
import type { Route } from "@/types/game";
import { computeNodeStates, computeRelativeWindow, planArrival } from "@/optimization/feasibility";
import { buildStepFeatures, buildAdjacencyMask } from "./features";
import { runInferenceStep, initialDecoderState, embeddingForNode, type DecoderState } from "./inference";

/**
 * Neural-policy route planner: the trained single-agent PointerNetwork
 * scores candidate next villages, beam search explores the top `beamWidth`
 * partial routes instead of committing to the single greedy choice, and
 * every candidate move is gated by THIS project's own feasibility engine
 * (computeNodeStates) -- not the model's own naive admissibility, which
 * knows nothing about shelter capacity or other teams' claimed origins.
 *
 * This is the "decomposition" approach to multi-team coordination: the
 * model itself was never trained with multiple agents or a shared capacity
 * pool in its state (see src/rl/README.md). Per-team feasibility already
 * excludes every origin any OTHER team has evacuated (via `alreadyVisited`,
 * the same global-visited-origin set game.service.ts computes) and bounds
 * the remaining shelter capacity (`demandServedSoFar`/`shelterCapacity`),
 * so two teams cannot be double-assigned the same village or jointly
 * exceed capacity -- but there is no learned coordination between what
 * different teams choose beyond that shared exclusion.
 *
 * Returns a `Route` in the exact shape computeBaselineRoute produces, so
 * callers can compare the two side by side. If no feasible move exists
 * even at the very first step, returns an explicit empty route (stops: []
 * via the depot-only beam) rather than throwing.
 */
export interface BeamSearchInput {
  graph: Graph;
  currentNodeId: string;
  depotNodeId: string;
  totalGameMinutes: number;
  gameStartMinutesOfDay: number;
  weekday: Weekday;
  priorities: ReadonlyMap<string, number>;
  riskScores: ReadonlyMap<string, number>;
  demandServedSoFar: number;
  shelterCapacity: number;
  /** Origins already evacuated by any team -- never offered again. */
  alreadyVisited?: ReadonlySet<string>;
  beamWidth?: number;
  maxDepth?: number;
}

interface PathStop {
  nodeId: string;
  arrivalMinutes: number;
  waitMinutes: number;
  departureMinutes: number;
  rewardCollected: number;
  demandServed: number;
}

interface BeamState {
  decoderState: DecoderState;
  currentNodeId: string;
  elapsedMinutes: number;
  visited: Set<string>;
  path: PathStop[];
  totalReward: number;
  totalDemandServed: number;
  totalDistanceKm: number;
  demandServedSoFar: number;
  logProbScore: number;
  done: boolean;
}

const DEFAULT_BEAM_WIDTH = 8;

export async function computeNeuralRoute(input: BeamSearchInput): Promise<Route> {
  const start = Date.now();
  const {
    graph,
    currentNodeId,
    depotNodeId,
    totalGameMinutes,
    gameStartMinutesOfDay,
    weekday,
    priorities,
    riskScores,
    demandServedSoFar,
    shelterCapacity,
    alreadyVisited,
    beamWidth = DEFAULT_BEAM_WIDTH,
    maxDepth,
  } = input;

  const initialVisited = new Set<string>([currentNodeId, ...(alreadyVisited ?? [])]);

  let beams: BeamState[] = [
    {
      decoderState: initialDecoderState(graph.nodes.length),
      currentNodeId,
      elapsedMinutes: 0,
      visited: initialVisited,
      path: [],
      totalReward: 0,
      totalDemandServed: 0,
      totalDistanceKm: 0,
      demandServedSoFar,
      logProbScore: 0,
      done: false,
    },
  ];
  const completed: BeamState[] = [];
  const depthLimit = maxDepth ?? graph.nodes.length;

  for (let depth = 0; depth < depthLimit && beams.some((b) => !b.done); depth++) {
    const candidates: BeamState[] = [];

    for (const beam of beams) {
      if (beam.done) {
        completed.push(beam);
        continue;
      }

      const states = computeNodeStates({
        graph,
        currentNodeId: beam.currentNodeId,
        depotNodeId,
        elapsedMinutes: beam.elapsedMinutes,
        totalGameMinutes,
        gameStartMinutesOfDay,
        weekday,
        visited: beam.visited,
        priorities,
        riskScores,
        demandServedSoFar: beam.demandServedSoFar,
        shelterCapacity,
      });
      const feasibleIds = new Set(states.filter((s) => s.feasible).map((s) => s.nodeId));
      if (feasibleIds.size === 0) {
        completed.push({ ...beam, done: true });
        continue;
      }

      const featuresInput = {
        graph,
        currentNodeId: beam.currentNodeId,
        depotNodeId,
        elapsedMinutes: beam.elapsedMinutes,
        totalGameMinutes,
        gameStartMinutesOfDay,
        weekday,
        priorities,
      };
      const { staticFeats, dynamicFeats } = buildStepFeatures(featuresInput);
      const adjMask = buildAdjacencyMask(featuresInput, beam.visited);
      const mask = graph.nodes.map((n) => feasibleIds.has(n.id));

      const { probs, nextDecoderState } = await runInferenceStep({
        staticFeats,
        dynamicFeats,
        adjMask,
        mask,
        decoderState: beam.decoderState,
      });

      const feasibleIndices = graph.nodes.map((_, i) => i).filter((i) => mask[i]);
      feasibleIndices.sort((a, b) => probs[b] - probs[a]);
      const topIndices = feasibleIndices.slice(0, beamWidth);

      for (const idx of topIndices) {
        const node = graph.nodes[idx];
        const window = computeRelativeWindow(node, weekday, gameStartMinutesOfDay);
        if (!window) continue; // defensive; feasible=true implies this can't happen
        const plan = planArrival(graph, beam.currentNodeId, node.id, beam.elapsedMinutes, window, node.serviceDurationMinutes);
        const reward = priorities.get(node.id) ?? 0;
        const demandServed = node.role === "origin" ? node.demand : 0;
        const distance = graph.distanceKm.get(beam.currentNodeId)?.get(node.id) ?? 0;

        candidates.push({
          decoderState: {
            hLstm: nextDecoderState.hLstm,
            cLstm: nextDecoderState.cLstm,
            prevHE: nextDecoderState.prevHE,
            currentEmbedding: embeddingForNode(nextDecoderState.prevHE, idx),
          },
          currentNodeId: node.id,
          elapsedMinutes: plan.finishVisitMinutes,
          visited: new Set([...beam.visited, node.id]),
          path: [
            ...beam.path,
            {
              nodeId: node.id,
              arrivalMinutes: plan.arrivalMinutes,
              waitMinutes: plan.waitMinutes,
              departureMinutes: plan.finishVisitMinutes,
              rewardCollected: reward,
              demandServed,
            },
          ],
          totalReward: beam.totalReward + reward,
          totalDemandServed: beam.totalDemandServed + demandServed,
          totalDistanceKm: beam.totalDistanceKm + distance,
          demandServedSoFar: beam.demandServedSoFar + demandServed,
          logProbScore: beam.logProbScore + Math.log((probs[idx] ?? 0) + 1e-8),
          done: false,
        });
      }
    }

    if (candidates.length === 0) break;
    candidates.sort((a, b) => b.logProbScore - a.logProbScore);
    beams = candidates.slice(0, beamWidth);
  }

  const all = [...completed, ...beams];
  const best = all.reduce((a, b) => (b.totalReward > a.totalReward ? b : a));

  const returnDistanceKm = graph.distanceKm.get(best.currentNodeId)?.get(depotNodeId) ?? 0;
  const returnTravelMinutes = graph.travelTimeMinutes.get(best.currentNodeId)?.get(depotNodeId) ?? 0;

  return {
    stops: best.path,
    totalDistanceKm: best.totalDistanceKm + returnDistanceKm,
    totalTravelMinutes: best.elapsedMinutes + returnTravelMinutes,
    totalReward: best.totalReward,
    totalDemandServed: best.totalDemandServed,
    computeTimeMs: Date.now() - start,
  };
}

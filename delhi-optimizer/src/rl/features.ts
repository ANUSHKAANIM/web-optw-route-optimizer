import type { Graph, GraphNode, Weekday } from "@/types/graph";
import { computeRelativeWindow, planArrival } from "@/optimization/feasibility";

/**
 * Builds the exact (N,7) static / (N,9) dynamic feature tensors the trained
 * PointerNetwork expects, matching `env.py`'s `get_state()` formula field
 * for field -- but fed from THIS project's own evacuation graph instead of
 * env.py's synthetic random instance. See rl/README.md for the documented
 * mismatches this substitution still carries (travel time is the graph's
 * own point-to-point minutes, not Euclidean coordinate distance; reward is
 * risk-weighted demand priority, not a random 1-9 integer; and the model
 * was trained with every node open from t=0 to t=maxTime, so nonzero
 * accessibility windows are an out-of-distribution input for it). Node
 * coordinates themselves are no longer a mismatch: both env.py's training
 * data and this graph use abstract (x, y) plane positions, not real-world
 * geography.
 *
 * This module only builds the NUMBERS the model reads. It never decides
 * feasibility -- that stays the exclusive job of
 * `@/optimization/feasibility`'s computeNodeStates, which beam-search.ts
 * uses as the actual gating mask.
 */

export interface StepFeatures {
  /** (N, 7), in graph.nodes order. */
  staticFeats: number[][];
  /** (N, 9), in graph.nodes order. */
  dynamicFeats: number[][];
}

export interface BuildFeaturesInput {
  graph: Graph;
  currentNodeId: string;
  depotNodeId: string;
  elapsedMinutes: number;
  totalGameMinutes: number;
  gameStartMinutesOfDay: number;
  weekday: Weekday;
  priorities: ReadonlyMap<string, number>;
}

function normalizedCoords(nodes: GraphNode[]): [number, number][] {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const centerX = (Math.max(...xs) + Math.min(...xs)) / 2;
  const centerY = (Math.max(...ys) + Math.min(...ys)) / 2;
  const spread = Math.max(
    1e-6,
    ...xs.map((v) => Math.abs(v - centerX)),
    ...ys.map((v) => Math.abs(v - centerY)),
  );
  return nodes.map((n) => [(n.x - centerX) / spread, (n.y - centerY) / spread]);
}

function decayFraction(t: number, totalGameMinutes: number, rewardDecayMin = 0.3): number {
  const frac = 1 - (1 - rewardDecayMin) * (t / totalGameMinutes);
  return Math.min(Math.max(frac, rewardDecayMin), 1.0);
}

export function buildStepFeatures(input: BuildFeaturesInput): StepFeatures {
  const { graph, currentNodeId, elapsedMinutes, totalGameMinutes, gameStartMinutesOfDay, weekday, priorities } = input;
  const nodes = graph.nodes;
  const coords = normalizedCoords(nodes);

  const windows = nodes.map((node) => computeRelativeWindow(node, weekday, gameStartMinutesOfDay));
  // A node with no accessible window today reads as "already closed": an
  // empty [totalGameMinutes, totalGameMinutes] window, which is naturally
  // infeasible without feeding the model an extreme out-of-range number.
  const openMinutes = windows.map((w) => w?.effectiveOpenMinutes ?? totalGameMinutes);
  const closeMinutes = windows.map((w) => w?.closeMinutes ?? totalGameMinutes);

  const rewards = nodes.map((n) => priorities.get(n.id) ?? 0);
  const sMax = Math.max(1, ...rewards) * 1.1;

  const travelFromCurrent = nodes.map(
    (n) => graph.travelTimeMinutes.get(currentNodeId)?.get(n.id) ?? Number.POSITIVE_INFINITY,
  );

  const staticFeats = nodes.map((node, i) => [
    coords[i][0],
    coords[i][1],
    node.serviceDurationMinutes / totalGameMinutes,
    openMinutes[i] / totalGameMinutes,
    closeMinutes[i] / totalGameMinutes,
    rewards[i] / sMax,
    1,
  ]);

  const dynamicFeats = nodes.map((node, i) => {
    const tAfterTravel = elapsedMinutes + travelFromCurrent[i];
    return [
      (openMinutes[i] - elapsedMinutes) / totalGameMinutes,
      (closeMinutes[i] - elapsedMinutes) / totalGameMinutes,
      elapsedMinutes / totalGameMinutes,
      (totalGameMinutes - elapsedMinutes) / totalGameMinutes,
      (openMinutes[i] - tAfterTravel) / totalGameMinutes,
      (closeMinutes[i] - tAfterTravel) / totalGameMinutes,
      tAfterTravel / totalGameMinutes,
      (totalGameMinutes - tAfterTravel) / totalGameMinutes,
      (rewards[i] * decayFraction(tAfterTravel, totalGameMinutes)) / sMax,
    ];
  });

  return { staticFeats, dynamicFeats };
}

/**
 * 1-step lookahead adjacency mask (N, N), mirroring env.py's
 * `get_adjacency_matrix` -- used only as the transformer's internal
 * attention mask, never as a feasibility decision. Deliberately excludes
 * the shelter-capacity constraint (env.py's model has no concept of it
 * either); the real gate is computeNodeStates, applied separately by
 * beam-search.ts.
 */
export function buildAdjacencyMask(input: BuildFeaturesInput, visited: ReadonlySet<string>): boolean[][] {
  const { graph, currentNodeId, depotNodeId, elapsedMinutes, totalGameMinutes, gameStartMinutesOfDay, weekday } = input;
  const nodes = graph.nodes;
  const n = nodes.length;
  const adj: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));

  for (let i = 0; i < n; i++) {
    const nodeI = nodes[i];
    if (visited.has(nodeI.id) || nodeI.id === currentNodeId) continue;
    const windowI = computeRelativeWindow(nodeI, weekday, gameStartMinutesOfDay);
    if (!windowI) continue;
    const planI = planArrival(graph, currentNodeId, nodeI.id, elapsedMinutes, windowI, nodeI.serviceDurationMinutes);
    if (!planI.canFinishBeforeClosing) continue;

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const nodeJ = nodes[j];
      if (visited.has(nodeJ.id) || nodeJ.id === currentNodeId) continue;
      const windowJ = computeRelativeWindow(nodeJ, weekday, gameStartMinutesOfDay);
      if (!windowJ) continue;
      const planJ = planArrival(graph, nodeI.id, nodeJ.id, planI.finishVisitMinutes, windowJ, nodeJ.serviceDurationMinutes);
      if (!planJ.canFinishBeforeClosing) continue;

      const returnTravel = graph.travelTimeMinutes.get(nodeJ.id)?.get(depotNodeId) ?? Number.POSITIVE_INFINITY;
      const timeHome = planJ.finishVisitMinutes + returnTravel;
      adj[i][j] = timeHome <= totalGameMinutes;
    }
  }
  return adj;
}

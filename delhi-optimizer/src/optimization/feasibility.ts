import type { Graph, Weekday, GraphNode } from "@/types/graph";
import type { NodeState, InfeasibilityReason } from "@/types/game";

/**
 * The core time-window + capacity feasibility engine. Everything time-
 * related is expressed as minutes-relative-to-game-start rather than
 * wall-clock minutes-of-day, which sidesteps midnight-wraparound entirely:
 * a node's accessibility window is converted ONCE, relative to the fixed
 * moment the game began, so every later comparison is a plain number line
 * -- no day-rollover arithmetic needed. (This does mean a session spanning
 * past midnight isn't modeled; game durations here are a few hours, well
 * within a single day, so that's an accepted, documented limitation, not a
 * bug.)
 */

export interface FeasibilityInput {
  graph: Graph;
  currentNodeId: string;
  depotNodeId: string;
  /** Minutes of simulated time this player has used so far. */
  elapsedMinutes: number;
  totalGameMinutes: number;
  /** Wall-clock minutes-of-day (0-1440) when the game session began -- the
   * fixed reference point every node's window is computed against. */
  gameStartMinutesOfDay: number;
  /** The weekday the game began on. */
  weekday: Weekday;
  visited: ReadonlySet<string>;
  /** nodeId -> current priority, supplied by a RiskPriorityProvider. The
   * feasibility engine never inspects where this number came from. */
  priorities: ReadonlyMap<string, number>;
  /** nodeId -> raw risk score, 0-1. Passed through to NodeState for
   * display only -- never used in the feasibility decision itself. */
  riskScores: ReadonlyMap<string, number>;
  /** Population evacuated so far by this player (sum of visited origins'
   * demand). Checked against the shelter's capacity before any further
   * origin can be marked feasible. */
  demandServedSoFar: number;
  /** The destination shelter's total capacity. */
  shelterCapacity: number;
}

function parseHHMM(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export interface RelativeWindow {
  /** Minutes-from-game-start the node becomes accessible -- already
   * clamped to 0 if it was already accessible when the game started. */
  effectiveOpenMinutes: number;
  /** Minutes-from-game-start the node becomes inaccessible. */
  closeMinutes: number;
}

/** Converts a node's accessibility window for one weekday into the
 * minutes-from-game-start number line described above. Returns null if the
 * node is inaccessible all day, or already inaccessible before the game
 * even started (both are permanently-infeasible-this-session, so callers
 * treat them the same way). Shared by the feasibility engine and route
 * policies, so "what does this node's window look like right now" is
 * computed in exactly one place. */
export function computeRelativeWindow(
  node: GraphNode,
  weekday: Weekday,
  gameStartMinutesOfDay: number,
): RelativeWindow | null {
  const hours = node.openingHours[weekday];
  if (!hours || hours.closed) return null;

  const openRelative = parseHHMM(hours.open) - gameStartMinutesOfDay;
  const closeMinutes = parseHHMM(hours.close) - gameStartMinutesOfDay;
  if (closeMinutes <= 0) return null;

  return { effectiveOpenMinutes: Math.max(openRelative, 0), closeMinutes };
}

export interface ArrivalPlan {
  travelMinutes: number;
  arrivalMinutes: number;
  waitMinutes: number;
  startVisitMinutes: number;
  finishVisitMinutes: number;
  /** Whether the visit both starts after the node becomes accessible and
   * finishes before it becomes inaccessible again. Does NOT check the
   * return-to-shelter game-time budget or shelter capacity -- see
   * `computeNodeStates` for those. */
  canFinishBeforeClosing: boolean;
}

/** Given a node's relative window, works out what arriving there right now
 * would actually look like: travel time, any wait for accessibility, and
 * whether the visit fits before the window closes. */
export function planArrival(
  graph: Graph,
  fromNodeId: string,
  toNodeId: string,
  elapsedMinutes: number,
  window: RelativeWindow,
  serviceDurationMinutes: number,
): ArrivalPlan {
  const travelMinutes = graph.travelTimeMinutes.get(fromNodeId)?.get(toNodeId) ?? Infinity;
  const arrivalMinutes = elapsedMinutes + travelMinutes;
  const waitMinutes = Math.max(window.effectiveOpenMinutes - arrivalMinutes, 0);
  const startVisitMinutes = arrivalMinutes + waitMinutes;
  const finishVisitMinutes = startVisitMinutes + serviceDurationMinutes;

  return {
    travelMinutes,
    arrivalMinutes,
    waitMinutes,
    startVisitMinutes,
    finishVisitMinutes,
    canFinishBeforeClosing: startVisitMinutes <= window.closeMinutes,
  };
}

export function computeNodeStates(input: FeasibilityInput): NodeState[] {
  const {
    graph,
    currentNodeId,
    depotNodeId,
    elapsedMinutes,
    totalGameMinutes,
    weekday,
    gameStartMinutesOfDay,
    visited,
    priorities,
    riskScores,
    demandServedSoFar,
    shelterCapacity,
  } = input;

  return graph.nodes.map((node) => {
    const priority = priorities.get(node.id) ?? 0;
    const riskScore = riskScores.get(node.id) ?? 0;
    const isSelfOrVisited = node.id === currentNodeId || visited.has(node.id);
    const window = computeRelativeWindow(node, weekday, gameStartMinutesOfDay);

    if (!window) {
      return {
        nodeId: node.id,
        riskScore,
        currentPriority: priority,
        isOpenNow: false,
        minutesUntilClosing: null,
        visited: visited.has(node.id),
        feasible: false,
        infeasibleReason: isSelfOrVisited ? "already_done" : "closed_today",
      };
    }

    const plan = planArrival(graph, currentNodeId, node.id, elapsedMinutes, window, node.serviceDurationMinutes);
    const returnTravel = graph.travelTimeMinutes.get(node.id)?.get(depotNodeId) ?? Infinity;
    const withinGameBudget = plan.finishVisitMinutes + returnTravel <= totalGameMinutes;
    const withinShelterCapacity = node.role !== "origin" || demandServedSoFar + node.demand <= shelterCapacity;

    const isOpenNow = elapsedMinutes >= window.effectiveOpenMinutes && elapsedMinutes < window.closeMinutes;
    const minutesUntilClosing = window.closeMinutes - elapsedMinutes;

    const feasible = !isSelfOrVisited && plan.canFinishBeforeClosing && withinGameBudget && withinShelterCapacity;
    const infeasibleReason: InfeasibilityReason | undefined = feasible
      ? undefined
      : isSelfOrVisited
        ? "already_done"
        : !plan.canFinishBeforeClosing
          ? "time_window"
          : !withinGameBudget
            ? "time_budget"
            : "shelter_capacity";

    return {
      nodeId: node.id,
      riskScore,
      currentPriority: priority,
      isOpenNow,
      minutesUntilClosing: minutesUntilClosing > 0 ? minutesUntilClosing : null,
      visited: visited.has(node.id),
      feasible,
      infeasibleReason,
    };
  });
}

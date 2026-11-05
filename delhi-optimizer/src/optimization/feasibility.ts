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
  /** This van's own carrying capacity -- distinct from shelterCapacity
   * (the shelter's aggregate, session-wide limit shared across every
   * van). undefined = no vehicle-capacity constraint, fully backward
   * compatible with every call site that predates this field. Phase 7:
   * "persons already picked up remain in the vehicle until a shelter
   * drop-off" -- since this project's routes are a single continuous
   * trip back to the depot (no intermediate drop-offs modeled yet), the
   * onboard count simply accumulates for the whole route, same as
   * demandServedSoFar does for the shelter. */
  vehicleCapacity?: number;
  /** Demand THIS van is currently carrying onboard, picked up earlier in
   * its own route-in-progress -- distinct from demandServedSoFar.
   * Ignored when vehicleCapacity is undefined. */
  onboardDemandSoFar?: number;
  /** Per-cell forecast-driven evacuation deadline (CycloneForecastEngine's
   * CellForecastResult.window), nodeId -> window or null. A present entry
   * NARROWS that node's static openingHours window to whichever closes
   * first; a node with no entry here is unaffected (falls back to its
   * static window alone, the pre-Phase-7.5 behavior). Optional so every
   * caller that predates the forecast-driven deadline keeps working
   * unchanged. */
  deadlineWindows?: ReadonlyMap<string, RelativeWindow | null>;
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

/** Intersects a node's static weekly openingHours window with an optional
 * forecast-driven deadline override: the effective window is whichever is
 * MORE restrictive on each end (opens later of the two, closes earlier of
 * the two). `deadlineOverride` of undefined means "no forecast deadline
 * known for this node" (falls back to the static window alone); explicit
 * null means "this node has no forecast deadline even though an entry was
 * looked up" (same result, kept distinct for callers that want to tell
 * the two apart). A deadline that lands before the node even opens, or
 * closes before it, naturally makes `canFinishBeforeClosing` false
 * downstream -- no separate "already missed" case needed. */
export function effectiveWindow(
  node: GraphNode,
  weekday: Weekday,
  gameStartMinutesOfDay: number,
  deadlineOverride?: RelativeWindow | null,
): RelativeWindow | null {
  const staticWindow = computeRelativeWindow(node, weekday, gameStartMinutesOfDay);
  if (!deadlineOverride) return staticWindow;
  if (!staticWindow) return null;
  return {
    effectiveOpenMinutes: Math.max(staticWindow.effectiveOpenMinutes, deadlineOverride.effectiveOpenMinutes),
    closeMinutes: Math.min(staticWindow.closeMinutes, deadlineOverride.closeMinutes),
  };
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
    vehicleCapacity,
    onboardDemandSoFar,
    deadlineWindows,
  } = input;

  return graph.nodes.map((node) => {
    const priority = priorities.get(node.id) ?? 0;
    const riskScore = riskScores.get(node.id) ?? 0;
    const isSelfOrVisited = node.id === currentNodeId || visited.has(node.id);
    const window = effectiveWindow(node, weekday, gameStartMinutesOfDay, deadlineWindows?.get(node.id));

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
    const withinVehicleCapacity =
      vehicleCapacity === undefined || node.role !== "origin" || (onboardDemandSoFar ?? 0) + node.demand <= vehicleCapacity;

    const isOpenNow = elapsedMinutes >= window.effectiveOpenMinutes && elapsedMinutes < window.closeMinutes;
    const minutesUntilClosing = window.closeMinutes - elapsedMinutes;

    const feasible =
      !isSelfOrVisited && plan.canFinishBeforeClosing && withinGameBudget && withinShelterCapacity && withinVehicleCapacity;
    const infeasibleReason: InfeasibilityReason | undefined = feasible
      ? undefined
      : isSelfOrVisited
        ? "already_done"
        : !plan.canFinishBeforeClosing
          ? "time_window"
          : !withinGameBudget
            ? "time_budget"
            : !withinShelterCapacity
              ? "shelter_capacity"
              : "vehicle_capacity";

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

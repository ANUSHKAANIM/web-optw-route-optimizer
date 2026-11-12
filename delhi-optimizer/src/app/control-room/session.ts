import { SyntheticCellProvider } from "@/data/synthetic-cell-provider";
import { buildGraph } from "@/graph/build-graph";
import { planeDistanceKm } from "@/graph/plane-distance";
import { routeCluster, DEFAULT_CLUSTER_ROUTING_THRESHOLDS, type ClusterTeam, type ClusterRoutingThresholds } from "@/solver/cluster-router";
import { resolveTeamProcessingOrder } from "@/solver/contested-cell-arbitration";
import { CycloneForecastEngine, type ForecastTickResult } from "@/forecast/cyclone-forecast-engine";
import { priorityFromForecastTick } from "@/forecast/priority-from-forecast";
import type { GraphNode } from "@/types/graph";
import type { Route } from "@/types/game";
import { positionAtMinute, type Waypoint } from "./van-timeline";

/**
 * A small, fast demo scenario wired through the SAME real solver stack
 * /rolling-horizon uses (cluster-router's greedy/neural/exact dispatch,
 * the real forecast engine) -- just sized down (20 nodes, 2 shelters, 4
 * vans) so every tick is fast enough to click through live.
 *
 * Deliberately NOT built on RollingHorizonController: that controller
 * only ever knows a van's position as "at its shelter" (a documented
 * limitation -- see its own VanState comment) and always replans a van's
 * route starting FROM the shelter. This page needs the opposite: a van's
 * new route must start from wherever it VISUALLY currently is (the
 * client's own animated position along its current route), not reset to
 * the shelter every tick. Since the backend has no continuous-position
 * concept of its own, the client sends its current (x, y) for every van
 * on each advanceForecast() call (see control-room-view.tsx's
 * handleAdvance), and this module builds a FRESH graph each tick that
 * includes a synthetic "current position" node per van (role: "shelter"
 * so it's never itself treated as a collectible origin), then routes
 * every van jointly from there via the same routeCluster() dispatcher
 * every other live page uses -- so exact/neural still work correctly
 * even though every van's start point moves tick to tick.
 *
 * Two shelters, not one: each van has a fixed HOME shelter (it must
 * return there -- the depot in its own routeCluster() call), but every
 * van can still be sent to ANY of the 18 villages regardless of which
 * shelter is geographically closer -- there's no per-shelter catchment
 * here, just a shared candidate pool with a cross-shelter exclusion set
 * (so the two shelters' vans never both claim the same village in one
 * tick, same `visited`-carried-across-the-loop pattern
 * rolling-horizon-controller.ts uses across its own clusters). Genuine
 * fleet-wide REASSIGNMENT (a van permanently switching shelters, Phase B)
 * is out of scope here -- home shelters are fixed at session creation.
 */

export type SolverTier = "fast" | "real";

export const SOLVER_TIER_THRESHOLDS: Record<SolverTier, ClusterRoutingThresholds> = {
  fast: { maxCandidatesForExact: 0, maxCandidatesForNeural: 0 },
  real: { maxCandidatesForExact: 0, maxCandidatesForNeural: DEFAULT_CLUSTER_ROUTING_THRESHOLDS.maxCandidatesForNeural },
};

const SEED = 2026;
const SESSION_STARTED_AT = new Date();
/** Two clocks, deliberately separate (the demo runs at fast-forward):
 *  - SCREEN time: the countdown on the page. Short (2 min) so a live demo
 *    keeps moving; still clickable at any time to pull the next forecast
 *    early (see actions.ts).
 *  - STORM time: what one forecast update represents in the simulated
 *    world. Every deadline, the planning horizon and each van's shift are
 *    measured in storm time, so they stay realistic regardless of how fast
 *    the demo plays. 2 min on screen = one 6 h forecast cycle. */
export const FORECAST_INTERVAL_SECONDS = 120;
export const STORM_HOURS_PER_FORECAST = 6;
const STORM_SECONDS_PER_FORECAST = STORM_HOURS_PER_FORECAST * 3600;
export const SHELTER_COUNT = 2;
export const VAN_COUNT = 4;
const VANS_PER_SHELTER = VAN_COUNT / SHELTER_COUNT;
/** H, the rolling-horizon lookahead: each replan only plans the next 8 h
 * of storm time -- longer than the 6 h gap between forecasts (so a van
 * never runs out of plan before the next replan), far shorter than its
 * whole shift. Re-planned with a fresh 8 h window on every forecast. */
export const LOOKAHEAD_HOURS = 8;
const LOOKAHEAD_MINUTES = LOOKAHEAD_HOURS * 60;
/** A van's total shift in storm time. Unlike the old fixed per-tick
 * budget, this depletes: each forecast cycle consumes 6 h of it, and a
 * replan may only use min(what's left, H). */
export const VAN_SHIFT_HOURS = 48;
const VAN_SHIFT_MINUTES = VAN_SHIFT_HOURS * 60;
/** Per-trip carrying capacity (Phase 7's vehicleCapacity). Without this,
 * a van's greedy/neural solve has no reason to ever stop picking up MORE
 * villages as long as time allows -- with a 10h budget on a ~30km-wide
 * map, that meant whichever van got processed first could legitimately
 * claim nearly every village in one route, leaving nothing for the
 * others (this is what made vans 3/4 end up idle). A realistic per-trip
 * capacity forces every van to make a bounded trip instead, so the
 * shared village pool actually gets split across all 4. */
const VAN_CAPACITY = 650;

export const VAN_COLORS = ["#5ec8ff", "#ffd166", "#6ee7a0", "#b69cff"];

export interface VanPosition {
  vanId: number;
  x: number;
  y: number;
}

export interface ControlRoomSession {
  cells: GraphNode[];
  shelters: GraphNode[];
  origins: GraphNode[];
  /** Fixed at session creation -- which shelter each van must return to. */
  vanHomeShelterId: Map<number, string>;
  forecastEngine: CycloneForecastEngine;
  lastTick: ForecastTickResult | null;
  currentTick: number;
  /** Real (screen) time the last forecast was pulled -- the screen
   * countdown runs FORECAST_INTERVAL_SECONDS from here. */
  lastForecastAt: Date;
  vanRoutes: Map<number, Route>;
  /** Each van's position AT THE START of its currently-displayed route --
   * i.e. wherever it was when the last tick was pulled. The client is the
   * source of truth for where a van visually is mid-route; this is only
   * the snapshot used to build that route in the first place, kept so a
   * fresh page load can still render something sensible. */
  vanStartPositions: Map<number, VanPosition>;
  /** Which shelter a van's CURRENT route actually ends at -- the home
   * shelter is used as the depot while CHOOSING villages (time-budget/
   * capacity feasibility is checked against it), but once the stop
   * sequence is fixed, the van drops off at whichever shelter is
   * genuinely nearest to its last stop, even if that's not its home.
   * Forcing every van back to a fixed home base regardless of where it
   * ends up wastes real distance -- confirmed live, up to 4x farther than
   * necessary. Equal to the home shelter whenever the van has no stops
   * (nothing to optimize) or home already happens to be nearest. */
  vanDropoffShelterId: Map<number, string>;
  /** Villages a van has actually driven past on an animated route --
   * reported by the client (markEvacuatedSync, called the instant its
   * animation passes a stop) and persisted here across ticks. Every
   * future advanceForecast() call excludes these from every van's
   * candidate pool, so a masked village never gets offered to another
   * van (or re-offered to the same one). */
  evacuatedCellIds: Set<string>;
  /** Each van's current route as a storm-time timeline (start -> stops ->
   * drop-off), see van-timeline.ts. Drives both the 6 h "where is it at
   * the next forecast" step here and the client's animation. */
  vanWaypoints: Map<number, Waypoint[]>;
  /** People currently on board each van -- picked up but not yet dropped
   * at a shelter. Carried across replans: a van replanned mid-route keeps
   * its passengers and has only VAN_CAPACITY minus this left. */
  vanLoad: Map<number, number>;
  /** People actually delivered to each shelter over the WHOLE session --
   * a shelter fills up and stays full, it doesn't reset every forecast. */
  shelterServed: Map<string, number>;
  solverTier: SolverTier;
  log: string[];
}

function createSession(seed: number = SEED, startedAt: Date = SESSION_STARTED_AT): ControlRoomSession {
  const cells = new SyntheticCellProvider({
    cellCount: 20,
    clusterCount: SHELTER_COUNT,
    planeHalfSizeKm: 16,
    isolatedFraction: 0,
    clusterJitterKm: 9,
    seed,
  }).getNodes();
  const shelters = cells.filter((n) => n.role === "shelter");
  const origins = cells.filter((n) => n.role === "origin");
  const forecastEngine = new CycloneForecastEngine(cells, seed, startedAt, STORM_SECONDS_PER_FORECAST);

  const vanHomeShelterId = new Map<number, string>();
  const vanStartPositions = new Map<number, VanPosition>();
  const vanDropoffShelterId = new Map<number, string>();
  for (let i = 0; i < VAN_COUNT; i++) {
    const home = shelters[Math.floor(i / VANS_PER_SHELTER) % shelters.length];
    vanHomeShelterId.set(i, home.id);
    vanStartPositions.set(i, { vanId: i, x: home.x, y: home.y });
    vanDropoffShelterId.set(i, home.id);
  }

  return {
    cells,
    shelters,
    origins,
    vanHomeShelterId,
    forecastEngine,
    lastTick: null,
    currentTick: -1,
    lastForecastAt: startedAt,
    vanRoutes: new Map(),
    vanStartPositions,
    vanDropoffShelterId,
    evacuatedCellIds: new Set(),
    vanWaypoints: new Map(),
    vanLoad: new Map(Array.from({ length: VAN_COUNT }, (_, i) => [i, 0])),
    shelterServed: new Map(shelters.map((s) => [s.id, 0])),
    solverTier: "real",
    log: [],
  };
}

const globalForControlRoom = globalThis as unknown as { controlRoomSession?: ControlRoomSession };
// A session cached across dev hot-reloads from before the storm-time /
// rolling-horizon change has no lastForecastAt and a 2-minute forecast
// engine -- discard it rather than mixing old and new clocks.
const cachedSession = globalForControlRoom.controlRoomSession;
export const session = cachedSession && cachedSession.shelterServed ? cachedSession : createSession();
if (process.env.NODE_ENV !== "production") globalForControlRoom.controlRoomSession = session;

export function logEvent(message: string): void {
  session.log.unshift(message);
  session.log = session.log.slice(0, 8);
}

/** Builds a synthetic "current position" node for a van -- role "shelter"
 * (never a routing candidate), demand/capacity 0, positioned exactly
 * where the client says that van currently is. */
function vanPositionNode(pos: VanPosition): GraphNode {
  return {
    id: `van_pos_${pos.vanId}`,
    name: `Van ${pos.vanId + 1} position`,
    x: pos.x,
    y: pos.y,
    role: "shelter",
    demand: 0,
    capacity: 0,
    openingHours: {
      monday: { open: "00:00", close: "23:59" },
      tuesday: { open: "00:00", close: "23:59" },
      wednesday: { open: "00:00", close: "23:59" },
      thursday: { open: "00:00", close: "23:59" },
      friday: { open: "00:00", close: "23:59" },
      saturday: { open: "00:00", close: "23:59" },
      sunday: { open: "00:00", close: "23:59" },
    },
    serviceDurationMinutes: 0,
  };
}


/** Pulls the next forecast and replans every van.
 *
 * Step 1 -- play out the last 6 h of storm time on the PREVIOUS routes,
 * server-side from each route's timeline (not from wherever the
 * animation happened to be when Skip was clicked): every stop reached by
 * minute 360 is evacuated and its people go on board; a van whose route
 * ends by then drops its passengers at its drop-off shelter (a running
 * total that never resets) and waits there. A van still mid-route is
 * replanned from its exact 6 h position, passengers still on board.
 *
 * Step 2 -- replan. FLEET-WIDE processing order: resolveTeamProcessingOrder
 * runs ONCE across all 4 vans from BOTH shelters together, so the van
 * genuinely closest to the highest-priority village gets first claim on
 * it regardless of which shelter it calls home. Each van is then routed
 * individually via its OWN home shelter as depot (routeCluster can't
 * batch vans with different depots into one call), with only its free
 * seats (VAN_CAPACITY minus passengers on board) and only the shelter
 * space not already used or reserved. */
export async function advanceForecast(): Promise<void> {
  const stepMinutes = STORM_HOURS_PER_FORECAST * 60;
  if (session.currentTick >= 0) playOutPreviousRoutes(stepMinutes);

  const nextTick = session.currentTick + 1;
  session.lastTick = session.forecastEngine.advanceTick(nextTick);
  session.currentTick = nextTick;
  session.lastForecastAt = new Date();

  // Storm time at this replan, and what's left of every van's shift.
  const nowMinutes = stormMinutesElapsed();
  const shiftLeftMinutes = Math.max(0, VAN_SHIFT_MINUTES - nowMinutes);
  const planningMinutes = Math.min(shiftLeftMinutes, LOOKAHEAD_MINUTES);

  const { priorities, riskScores } = priorityFromForecastTick(session.cells, session.lastTick);
  const thresholds = SOLVER_TIER_THRESHOLDS[session.solverTier];
  // Per-village forecast-driven evacuation deadline. The engine reports
  // windows in storm-minutes-from-session-start, but every solver's clock
  // starts at 0 = "now" (this replan), so shift each window back by
  // nowMinutes -- same fix RollingHorizonController.replan applies.
  const deadlineWindows = new Map(
    Array.from(session.lastTick.cellStates.entries(), ([cellId, state]) => [
      cellId,
      state.window && {
        effectiveOpenMinutes: Math.max(state.window.effectiveOpenMinutes - nowMinutes, 0),
        closeMinutes: state.window.closeMinutes - nowMinutes,
      },
    ] as const),
  );

  const positionNodes = Array.from(session.vanStartPositions.values(), vanPositionNode);
  const graph = buildGraph([...session.shelters, ...session.origins, ...positionNodes]);

  // Shelters and van-position markers are never candidates (priority 0 is
  // NOT the same as ineligible -- without this a van would "visit" a
  // shelter or another van's marker as a zero-value stop).
  const nonCandidateIds = new Set<string>([...session.shelters.map((s) => s.id), ...positionNodes.map((p) => p.id)]);
  const visited = new Set<string>([...session.evacuatedCellIds, ...nonCandidateIds]);

  // Shelter space already used (delivered, persistent) PLUS the space
  // every loaded van will need when it unloads -- reserved at its home
  // shelter up front so this replan can't give that space away.
  const shelterCommitted = new Map<string, number>(session.shelters.map((s) => [s.id, session.shelterServed.get(s.id) ?? 0]));
  for (const [vanId, load] of session.vanLoad) {
    const home = session.vanHomeShelterId.get(vanId)!;
    shelterCommitted.set(home, (shelterCommitted.get(home) ?? 0) + load);
  }

  session.vanRoutes.clear();
  session.vanWaypoints.clear();

  const methods: string[] = [];
  let totalRouted = 0;

  if (planningMinutes > 0) {
    const allTeams: ClusterTeam[] = Array.from(session.vanStartPositions.keys(), (vanId) => ({
      teamId: vanId,
      currentNodeId: `van_pos_${vanId}`,
      // Rolling horizon: plan only the next H of storm time (or less, once
      // the shift is nearly over); the next forecast replans a fresh window.
      remainingMinutes: planningMinutes,
      shiftedGameStartMinutesOfDay: 9 * 60,
      // Only the seats still free -- passengers picked up earlier stay on board.
      vehicleCapacity: Math.max(0, VAN_CAPACITY - (session.vanLoad.get(vanId) ?? 0)),
    }));
    // resolveTeamProcessingOrder only reads cluster.graph -- the shelter
    // named here is a don't-care.
    const fleetOrder = resolveTeamProcessingOrder({ shelterId: session.shelters[0].id, graph }, allTeams, priorities);

    for (const team of fleetOrder) {
      const homeShelterId = session.vanHomeShelterId.get(team.teamId)!;
      const shelter = session.shelters.find((s) => s.id === homeShelterId)!;
      const load = session.vanLoad.get(team.teamId) ?? 0;

      const result = await routeCluster({
        cluster: { shelterId: homeShelterId, graph },
        teams: [team],
        weekday: "monday",
        priorities,
        riskScores,
        demandServedSoFar: shelterCommitted.get(homeShelterId) ?? 0,
        shelterCapacity: shelter.capacity,
        alreadyVisited: visited,
        thresholds,
        deadlineWindows,
      });
      methods.push(result.method);

      const route = result.routesByTeam.get(team.teamId);
      if (route && route.stops.length > 0) {
        // Feasibility (time, capacity) was checked against the home
        // shelter. Once the stops are fixed, unload at a strictly closer
        // shelter instead -- but only one with room for everyone on
        // board, so no shelter is ever overfilled.
        const lastStop = graph.nodesById.get(route.stops[route.stops.length - 1].nodeId)!;
        const dropoff = nearestShelterWithRoom(lastStop, load + route.totalDemandServed, homeShelterId, shelterCommitted);
        if (dropoff.id !== homeShelterId) {
          route.totalDistanceKm +=
            (graph.distanceKm.get(lastStop.id)?.get(dropoff.id) ?? 0) - (graph.distanceKm.get(lastStop.id)?.get(homeShelterId) ?? 0);
          route.totalTravelMinutes +=
            (graph.travelTimeMinutes.get(lastStop.id)?.get(dropoff.id) ?? 0) -
            (graph.travelTimeMinutes.get(lastStop.id)?.get(homeShelterId) ?? 0);
          // Move this van's reservation from home to where it really unloads.
          shelterCommitted.set(homeShelterId, (shelterCommitted.get(homeShelterId) ?? 0) - load);
          shelterCommitted.set(dropoff.id, (shelterCommitted.get(dropoff.id) ?? 0) + load);
        }
        shelterCommitted.set(dropoff.id, (shelterCommitted.get(dropoff.id) ?? 0) + route.totalDemandServed);
        setVanRoute(team.teamId, route, dropoff, graph);
        for (const stop of route.stops) visited.add(stop.nodeId);
        totalRouted++;
      } else if (load > 0) {
        // Nothing new worth picking up, but people are on board: drive
        // straight to the nearest shelter that can take them.
        const pos = session.vanStartPositions.get(team.teamId)!;
        const dropoff = nearestShelterWithRoom(pos, load, homeShelterId, shelterCommitted);
        if (dropoff.id !== homeShelterId) {
          shelterCommitted.set(homeShelterId, (shelterCommitted.get(homeShelterId) ?? 0) - load);
          shelterCommitted.set(dropoff.id, (shelterCommitted.get(dropoff.id) ?? 0) + load);
        }
        const posId = `van_pos_${team.teamId}`;
        const returnOnly: Route = {
          stops: [],
          totalDistanceKm: graph.distanceKm.get(posId)?.get(dropoff.id) ?? 0,
          totalTravelMinutes: graph.travelTimeMinutes.get(posId)?.get(dropoff.id) ?? 0,
          totalReward: 0,
          totalDemandServed: 0,
          computeTimeMs: 0,
        };
        setVanRoute(team.teamId, returnOnly, dropoff, graph);
      }
    }
  }

  const sheltered = Array.from(session.shelterServed.values()).reduce((a, b) => a + b, 0);
  const onBoard = Array.from(session.vanLoad.values()).reduce((a, b) => a + b, 0);
  logEvent(
    planningMinutes > 0
      ? `Forecast ${nextTick} (storm +${nowMinutes / 60} h): storm in the ${session.lastTick.zone.concentration.toLowerCase()} -- ${totalRouted} van route(s) replanned for the next ${planningMinutes / 60} h (${methods.join(", ")}). ${sheltered} sheltered, ${onBoard} on board.`
      : `Forecast ${nextTick}: every van's ${VAN_SHIFT_HOURS} h shift is used up -- ${sheltered} people sheltered in total.`,
  );
}

/** Advance every van `minutes` of storm time along its current route:
 * evacuate the stops it reaches, unload at the shelter if it gets there. */
function playOutPreviousRoutes(minutes: number): void {
  for (const [vanId, waypoints] of session.vanWaypoints) {
    const route = session.vanRoutes.get(vanId);
    if (!route) continue;
    let load = session.vanLoad.get(vanId) ?? 0;
    for (const stop of route.stops) {
      if (stop.arrivalMinutes > minutes) break;
      if (!session.evacuatedCellIds.has(stop.nodeId)) session.evacuatedCellIds.add(stop.nodeId);
      load += stop.demandServed;
    }
    const end = waypoints[waypoints.length - 1];
    if (end.arriveMinutes <= minutes) {
      const dropoffId = session.vanDropoffShelterId.get(vanId)!;
      session.shelterServed.set(dropoffId, (session.shelterServed.get(dropoffId) ?? 0) + load);
      load = 0;
    }
    session.vanLoad.set(vanId, load);
    const pos = positionAtMinute(waypoints, minutes);
    session.vanStartPositions.set(vanId, { vanId, x: pos.x, y: pos.y });
  }
}

/** Stores a van's route plus its storm-time timeline (start -> stops -> drop-off). */
function setVanRoute(vanId: number, route: Route, dropoff: GraphNode, graph: ReturnType<typeof buildGraph>): void {
  const start = session.vanStartPositions.get(vanId)!;
  const waypoints: Waypoint[] = [{ x: start.x, y: start.y, arriveMinutes: 0, departMinutes: 0 }];
  let lastId = `van_pos_${vanId}`;
  let lastDepart = 0;
  for (const stop of route.stops) {
    const node = graph.nodesById.get(stop.nodeId)!;
    waypoints.push({ x: node.x, y: node.y, arriveMinutes: stop.arrivalMinutes, departMinutes: stop.departureMinutes });
    lastId = stop.nodeId;
    lastDepart = stop.departureMinutes;
  }
  const arrive = lastDepart + (graph.travelTimeMinutes.get(lastId)?.get(dropoff.id) ?? 0);
  waypoints.push({ x: dropoff.x, y: dropoff.y, arriveMinutes: arrive, departMinutes: arrive });
  session.vanRoutes.set(vanId, route);
  session.vanWaypoints.set(vanId, waypoints);
  session.vanDropoffShelterId.set(vanId, dropoff.id);
}

/** Nearest shelter to `point` with room for `people` more, falling back
 * to the home shelter (where the space was reserved). */
function nearestShelterWithRoom(
  point: { x: number; y: number },
  people: number,
  homeShelterId: string,
  committed: ReadonlyMap<string, number>,
): GraphNode {
  let best = session.shelters.find((s) => s.id === homeShelterId)!;
  let bestDist = planeDistanceKm([point.x, point.y], [best.x, best.y]);
  for (const s of session.shelters) {
    if (s.id === homeShelterId) continue;
    const room = s.capacity - (committed.get(s.id) ?? 0);
    const d = planeDistanceKm([point.x, point.y], [s.x, s.y]);
    if (room >= people && d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best;
}

/** Storm time elapsed at the current forecast, in minutes. Forecast 0 is
 * storm time 0; each later forecast is another 6 h. */
export function stormMinutesElapsed(): number {
  return Math.max(0, session.currentTick) * STORM_HOURS_PER_FORECAST * 60;
}

/** When the on-screen countdown reaches zero -- screen time, not storm time. */
export function screenNextUpdateIso(): string {
  return new Date(session.lastForecastAt.getTime() + FORECAST_INTERVAL_SECONDS * 1000).toISOString();
}

export function setSolverTierSync(tier: SolverTier): void {
  session.solverTier = tier;
  logEvent(tier === "real" ? "Solver switched to Real (neural Pointer Network)." : "Solver switched to Fast (greedy).");
}

/** Called by the client the instant a van's animation actually passes a
 * stop -- masks that village immediately (not just at the next tick), so
 * it's already excluded the next time ANY van is replanned. Idempotent:
 * reporting the same village twice (e.g. two vans whose routes briefly
 * both still list it, right up until the next replan drops it from one
 * of them) is a no-op the second time. */
export function markEvacuatedSync(nodeId: string): void {
  if (session.evacuatedCellIds.has(nodeId)) return;
  session.evacuatedCellIds.add(nodeId);
  const node = session.cells.find((n) => n.id === nodeId);
  logEvent(`${node?.name ?? nodeId} evacuated -- masked for every other van.`);
}

/** Starts a brand new session: a freshly seeded scenario (new village/
 * shelter layout, new forecast track), tick back to -1, every van back
 * at its (new) home shelter, nothing evacuated. `session` is a module-
 * level `const` other files already hold a reference to, so this mutates
 * its fields in place via Object.assign rather than creating a new
 * object -- replacing the binding wouldn't be visible to anything that
 * imported `session` before this call. */
export function resetSessionSync(): void {
  const fresh = createSession(Date.now() & 0xffffffff, new Date());
  Object.assign(session, fresh);
  logEvent("New session started -- fresh scenario, every van reset to its home shelter.");
}

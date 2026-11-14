import { SyntheticCellProvider } from "@/data/synthetic-cell-provider";
import { buildGraph, AVG_TRAVEL_SPEED_KMH } from "@/graph/build-graph";
import { planeDistanceKm } from "@/graph/plane-distance";
import { routeCluster, DEFAULT_CLUSTER_ROUTING_THRESHOLDS, type ClusterTeam, type ClusterRoutingThresholds } from "@/solver/cluster-router";
import { resolveTeamProcessingOrder } from "@/solver/contested-cell-arbitration";
import { CycloneForecastEngine, type ForecastTickResult } from "@/forecast/cyclone-forecast-engine";
import { priorityFromForecastTick } from "@/forecast/priority-from-forecast";
import type { GraphNode } from "@/types/graph";
import type { Route } from "@/types/game";
import { positionAtMinute, type Waypoint } from "./van-timeline";
import { getAppSolverTier, setAppSolverTier } from "@/lib/solver-preference";

/**
 * A small, fast demo scenario wired through the SAME real solver stack
 * /rolling-horizon uses (cluster-router's greedy/neural/exact dispatch,
 * the real forecast engine) -- just sized down (20 villages, 2 shelters, 4
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
 * van can still be sent to ANY of the 20 villages regardless of which
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
const SCHEDULED_CYCLE_MINUTES = STORM_HOURS_PER_FORECAST * 60;
/** Storm minutes that pass per real (screen) second: 360 / 120 = 3. */
const STORM_MINUTES_PER_SCREEN_SECOND = SCHEDULED_CYCLE_MINUTES / FORECAST_INTERVAL_SECONDS;
/** The forecast engine ticks once per storm MINUTE (tick = storm minutes
 * since the start), so a forecast can be issued at any moment -- on the
 * regular 6 h schedule or as a sudden special advisory in between -- and
 * every deadline it computes is still exact. */
const ENGINE_TICK_SECONDS = 60;
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
  /** How many forecasts (scheduled + special) have been issued, minus 1. */
  currentTick: number;
  /** Real (screen) time the last forecast was pulled. */
  lastForecastAt: Date;
  /** Storm time (minutes since the start) of the last forecast. Grows by
   * exactly 6 h for a scheduled forecast, or by however much storm time
   * has really passed for a special advisory. */
  stormMinutes: number;
  /** Storm time of the next SCHEDULED forecast (multiples of 6 h) -- a
   * special advisory doesn't move the regular schedule. */
  nextScheduledMinutes: number;
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
  /** Back-to-back trips planned for each van in the current 8 h window
   * (source of truth -- vanRoutes/vanWaypoints/vanDropoffShelterId are
   * derived from this by rebuildVanViews). */
  vanTrips: Map<number, VanTrip[]>;
  /** People currently on board each van -- picked up but not yet dropped
   * at a shelter. Carried across replans: a van replanned mid-route keeps
   * its passengers and has only VAN_CAPACITY minus this left. */
  vanLoad: Map<number, number>;
  /** People actually delivered to each shelter over the WHOLE session --
   * a shelter fills up and stays full, it doesn't reset every forecast. */
  shelterServed: Map<string, number>;
  solverTier: SolverTier;
  log: string[];
  /** Why each village is (or isn't) in a van's plan this window -- shown
   * when hovering a village. Recomputed on every forecast. */
  villageStatus: Map<string, VillageStatus>;
}

export interface VillageStatus {
  /** "assigned" = in some van's plan; "waiting" = not this window. */
  state: "assigned" | "waiting" | "evacuated";
  /** One plain-language line, e.g. "Van 2, trip 1 -- arrives in 1.4 h". */
  reason: string;
  /** The planner's score for this village this forecast. */
  score: number;
  /** Hours left until this village's deadline (null = no deadline). */
  deadlineHours: number | null;
}

function createSession(seed: number = SEED, startedAt: Date = SESSION_STARTED_AT): ControlRoomSession {
  const cells = new SyntheticCellProvider({
    // 20 villages + 2 shelters, spread over a slightly bigger map: half the
    // villages around the two towns, half scattered across the whole map,
    // and none closer than 3.5 km to another node -- so dots and route
    // lines don't pile up on each other.
    cellCount: 22,
    clusterCount: SHELTER_COUNT,
    planeHalfSizeKm: 20,
    isolatedFraction: 0.5,
    clusterJitterKm: 9,
    minSpacingKm: 3.5,
    seed,
  }).getNodes();
  const shelters = cells.filter((n) => n.role === "shelter");
  const origins = cells.filter((n) => n.role === "origin");
  const forecastEngine = new CycloneForecastEngine(cells, seed, startedAt, ENGINE_TICK_SECONDS);

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
    stormMinutes: 0,
    nextScheduledMinutes: 0,
    vanRoutes: new Map(),
    vanStartPositions,
    vanDropoffShelterId,
    evacuatedCellIds: new Set(),
    vanWaypoints: new Map(),
    vanTrips: new Map(),
    vanLoad: new Map(Array.from({ length: VAN_COUNT }, (_, i) => [i, 0])),
    shelterServed: new Map(shelters.map((s) => [s.id, 0])),
    solverTier: "real",
    log: [],
    villageStatus: new Map(),
  };
}

const globalForControlRoom = globalThis as unknown as { controlRoomSession?: ControlRoomSession };
// A session cached across dev hot-reloads from before the storm-time /
// rolling-horizon change has no lastForecastAt and a 2-minute forecast
// engine -- discard it rather than mixing old and new clocks.
const cachedSession = globalForControlRoom.controlRoomSession;
export const session = cachedSession && cachedSession.nextScheduledMinutes !== undefined && cachedSession.origins.length === 20 ? cachedSession : createSession();
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
 * Step 1 -- play out the last 6 h of storm time on the PREVIOUS plans,
 * server-side from each van's trip timeline (not from wherever the
 * animation happened to be when Skip was clicked): every stop reached by
 * minute 360 is evacuated and its people go on board; every trip that
 * ends by then unloads at its shelter (a running total that never
 * resets). A van still mid-trip is replanned from its exact 6 h position,
 * passengers still on board.
 *
 * Step 2 -- replan as many BACK-TO-BACK trips as fit in the 8 h window:
 * when a trip ends at a shelter with time left, the van immediately
 * starts another from there (empty seats again) instead of idling until
 * the next forecast. Trips are handed out round-robin -- every van's
 * trip 1, then every van's trip 2, ... -- in the FLEET-WIDE processing
 * order from resolveTeamProcessingOrder, so one van can't chain three
 * trips and claim villages another van is closer to. Each trip is routed
 * via the van's OWN home shelter as depot (routeCluster can't batch vans
 * with different depots), with only its free seats and only the shelter
 * space not already used or reserved. */
export async function advanceForecast(kind: "scheduled" | "special" = "scheduled"): Promise<void> {
  const first = session.currentTick < 0;
  const untilScheduled = session.nextScheduledMinutes - session.stormMinutes;
  let stepMinutes: number;
  if (first) {
    stepMinutes = 0;
  } else if (kind === "scheduled") {
    // Skip / countdown: jump to the next scheduled forecast.
    stepMinutes = untilScheduled;
  } else {
    // Special advisory: issued NOW -- only the storm time that has really
    // passed on screen since the last forecast (at least 1 min, and never
    // past the next scheduled one).
    const screenSeconds = (Date.now() - session.lastForecastAt.getTime()) / 1000;
    stepMinutes = Math.max(1, Math.min(untilScheduled - 1, Math.round(screenSeconds * STORM_MINUTES_PER_SCREEN_SECOND)));
  }
  if (!first) playOutPreviousPlans(stepMinutes);

  session.stormMinutes += stepMinutes;
  if (first || kind === "scheduled") session.nextScheduledMinutes = session.stormMinutes + SCHEDULED_CYCLE_MINUTES;
  session.lastTick = session.forecastEngine.advanceTick(session.stormMinutes);
  session.currentTick += 1;
  const nextTick = session.currentTick;
  session.lastForecastAt = new Date();

  // Storm time at this replan, and what's left of every van's shift.
  const nowMinutes = stormMinutesElapsed();
  const shiftLeftMinutes = Math.max(0, VAN_SHIFT_MINUTES - nowMinutes);
  const planningMinutes = Math.min(shiftLeftMinutes, LOOKAHEAD_MINUTES);

  const lastTick = session.lastTick;
  // At-risk villages first: an unthreatened village scores only 5% of its
  // population (vs the project-wide 30%), so a big safe village no longer
  // outranks a small threatened one -- safe villages are picked only when
  // a van has spare time and nothing at-risk is reachable.
  const { priorities, riskScores } = priorityFromForecastTick(session.cells, lastTick, SAFE_VILLAGE_URGENCY);
  const thresholds = SOLVER_TIER_THRESHOLDS[getAppSolverTier()];
  // Per-village forecast-driven evacuation deadlines. The engine reports
  // windows in storm-minutes-from-session-start, but every solver's clock
  // starts at 0 = the start of the trip being planned, so shift each
  // window back by (now + trip start) -- otherwise a deadline that already
  // passed would look hours away. Same fix RollingHorizonController uses.
  const deadlineWindowsFrom = (tripStartMinutes: number) => {
    const shift = nowMinutes + tripStartMinutes;
    return new Map(
      Array.from(lastTick.cellStates.entries(), ([cellId, state]) => [
        cellId,
        state.window && {
          effectiveOpenMinutes: Math.max(state.window.effectiveOpenMinutes - shift, 0),
          closeMinutes: state.window.closeMinutes - shift,
        },
      ] as const),
    );
  };

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

  session.vanTrips.clear();
  const methods: string[] = [];

  if (planningMinutes > 0) {
    // Per-van planning cursor: where the next trip starts, when, with how
    // many people already on board.
    const cursor = new Map<number, { nodeId: string; atMinutes: number; load: number; done: boolean }>(
      Array.from(session.vanStartPositions.keys(), (vanId) => [
        vanId,
        { nodeId: `van_pos_${vanId}`, atMinutes: 0, load: session.vanLoad.get(vanId) ?? 0, done: false },
      ]),
    );
    const allTeams: ClusterTeam[] = Array.from(cursor.entries(), ([vanId, c]) => ({
      teamId: vanId,
      currentNodeId: c.nodeId,
      remainingMinutes: planningMinutes,
      shiftedGameStartMinutesOfDay: 9 * 60,
      vehicleCapacity: Math.max(0, VAN_CAPACITY - c.load),
    }));
    // resolveTeamProcessingOrder only reads cluster.graph -- the shelter
    // named here is a don't-care.
    const fleetOrder = resolveTeamProcessingOrder({ shelterId: session.shelters[0].id, graph }, allTeams, priorities).map((t) => t.teamId);

    for (let round = 0; round < MAX_TRIPS_PER_WINDOW; round++) {
      let anyPlanned = false;
      for (const vanId of fleetOrder) {
        const c = cursor.get(vanId)!;
        // Less than MIN_TRIP_MINUTES left in the window isn't worth a trip.
        if (c.done || planningMinutes - c.atMinutes < MIN_TRIP_MINUTES) continue;
        const homeShelterId = session.vanHomeShelterId.get(vanId)!;
        const shelter = session.shelters.find((s) => s.id === homeShelterId)!;

        const result = await routeCluster({
          cluster: { shelterId: homeShelterId, graph },
          teams: [
            {
              teamId: vanId,
              currentNodeId: c.nodeId,
              // Rolling horizon: only what's left of the H window.
              remainingMinutes: planningMinutes - c.atMinutes,
              shiftedGameStartMinutesOfDay: 9 * 60,
              // Only the seats still free -- passengers already on board stay.
              vehicleCapacity: Math.max(0, VAN_CAPACITY - c.load),
            },
          ],
          weekday: "monday",
          priorities,
          riskScores,
          demandServedSoFar: shelterCommitted.get(homeShelterId) ?? 0,
          shelterCapacity: shelter.capacity,
          alreadyVisited: visited,
          thresholds,
          deadlineWindows: deadlineWindowsFrom(c.atMinutes),
        });
        if (round === 0) methods.push(result.method);

        const route = result.routesByTeam.get(vanId);
        const startPoint = graph.nodesById.get(c.nodeId)!;
        if (route && route.stops.length > 0) {
          // Feasibility (time, capacity) was checked against the home
          // shelter. Once the stops are fixed, unload at a strictly closer
          // shelter instead -- but only one with room for everyone on
          // board, so no shelter is ever overfilled.
          const lastStop = graph.nodesById.get(route.stops[route.stops.length - 1].nodeId)!;
          const dropoff = nearestShelterWithRoom(lastStop, c.load + route.totalDemandServed, homeShelterId, shelterCommitted);
          if (dropoff.id !== homeShelterId && c.load > 0) {
            // Move this van's reservation from home to where it really unloads.
            shelterCommitted.set(homeShelterId, (shelterCommitted.get(homeShelterId) ?? 0) - c.load);
            shelterCommitted.set(dropoff.id, (shelterCommitted.get(dropoff.id) ?? 0) + c.load);
          }
          shelterCommitted.set(dropoff.id, (shelterCommitted.get(dropoff.id) ?? 0) + route.totalDemandServed);
          const trip = makeTrip(route, c.atMinutes, startPoint, dropoff, graph);
          addTrip(vanId, trip);
          for (const stop of route.stops) visited.add(stop.nodeId);
          // Unloaded at the shelter: next trip starts there, seats empty.
          cursor.set(vanId, { nodeId: dropoff.id, atMinutes: trip.endMinutes, load: 0, done: false });
          anyPlanned = true;
        } else if (c.load > 0) {
          // Nothing new worth picking up, but people are on board: drive
          // straight to the nearest shelter that can take them.
          const dropoff = nearestShelterWithRoom(startPoint, c.load, homeShelterId, shelterCommitted);
          if (dropoff.id !== homeShelterId) {
            shelterCommitted.set(homeShelterId, (shelterCommitted.get(homeShelterId) ?? 0) - c.load);
            shelterCommitted.set(dropoff.id, (shelterCommitted.get(dropoff.id) ?? 0) + c.load);
          }
          const empty: Route = { stops: [], totalDistanceKm: 0, totalTravelMinutes: 0, totalReward: 0, totalDemandServed: 0, computeTimeMs: 0 };
          const trip = makeTrip(empty, c.atMinutes, startPoint, dropoff, graph);
          addTrip(vanId, trip);
          cursor.set(vanId, { nodeId: dropoff.id, atMinutes: trip.endMinutes, load: 0, done: false });
          anyPlanned = true;
        } else {
          c.done = true;
        }
      }
      if (!anyPlanned) break;
    }
  }

  rebuildVanViews();
  session.villageStatus = explainVillages(priorities, nowMinutes, planningMinutes, shelterCommitted);

  const trips = Array.from(session.vanTrips.values()).reduce((a, t) => a + t.length, 0);
  const sheltered = Array.from(session.shelterServed.values()).reduce((a, b) => a + b, 0);
  const onBoard = Array.from(session.vanLoad.values()).reduce((a, b) => a + b, 0);
  logEvent(
    planningMinutes > 0
      ? `${kind === "special" && !first ? "SPECIAL ADVISORY" : "Forecast"} ${nextTick} (storm +${(nowMinutes / 60).toFixed(1)} h${kind === "special" && !first ? `, ${(stepMinutes / 60).toFixed(1)} h after the last one` : ""}): every van rerouted from where it is now; storm in the ${lastTick.zone.concentration.toLowerCase()} -- ${trips} trip(s) planned across ${session.vanTrips.size} van(s) for the next ${planningMinutes / 60} h (${methods.join(", ")}). ${sheltered} sheltered, ${onBoard} on board.`
      : `Forecast ${nextTick}: every van's ${VAN_SHIFT_HOURS} h shift is used up -- ${sheltered} people sheltered in total.`,
  );
}

/** Urgency floor for an unthreatened village in this page's scoring (the
 * project-wide default is 0.3) -- see the priorityFromForecastTick call. */
const SAFE_VILLAGE_URGENCY = 0.05;

/** One plain-language reason per village for the hover tooltip: which van
 * is coming and when, or the first rule that explains why none is. */
function explainVillages(
  priorities: ReadonlyMap<string, number>,
  nowMinutes: number,
  planningMinutes: number,
  shelterCommitted: ReadonlyMap<string, number>,
): Map<string, VillageStatus> {
  const out = new Map<string, VillageStatus>();
  const tick = session.lastTick!;
  const assigned = new Map<string, { vanId: number; trip: number; arrive: number }>();
  for (const [vanId, trips] of session.vanTrips) {
    trips.forEach((t, k) => {
      for (const s of t.stops) assigned.set(s.nodeId, { vanId, trip: k + 1, arrive: s.arrivalMinutes });
    });
  }
  const freeRoom = Math.max(0, ...session.shelters.map((s) => s.capacity - (shelterCommitted.get(s.id) ?? 0)));
  const hours = (min: number) => `${(min / 60).toFixed(1)} h`;

  for (const village of session.origins) {
    const score = priorities.get(village.id) ?? 0;
    const state = tick.cellStates.get(village.id);
    const minutesLeft = state?.window ? state.window.closeMinutes - nowMinutes : null;
    const deadlineHours = minutesLeft === null ? null : minutesLeft / 60;
    const base = { score, deadlineHours };

    if (session.evacuatedCellIds.has(village.id)) {
      out.set(village.id, { ...base, state: "evacuated", reason: "Already evacuated." });
      continue;
    }
    const a = assigned.get(village.id);
    if (a) {
      out.set(village.id, { ...base, state: "assigned", reason: `Van ${a.vanId + 1}, trip ${a.trip} -- arrives in ${hours(a.arrive)}.` });
      continue;
    }
    // Not in any plan -- report the first rule that explains it.
    const nearestKm = Math.min(...Array.from(session.vanStartPositions.values(), (p) => planeDistanceKm([p.x, p.y], [village.x, village.y])));
    const reachMinutes = (nearestKm / AVG_TRAVEL_SPEED_KMH) * 60;
    let reason: string;
    if (planningMinutes <= 0) {
      reason = "Every van's shift is over.";
    } else if (minutesLeft !== null && minutesLeft <= 0) {
      reason = `Missed: its deadline passed ${hours(-minutesLeft)} ago.`;
    } else if (minutesLeft !== null && reachMinutes > minutesLeft) {
      reason = `No van can get there before its deadline (${hours(minutesLeft)} left, nearest van ${hours(reachMinutes)} away).`;
    } else if (village.demand > freeRoom) {
      reason = `No shelter has room for ${village.demand} more people.`;
    } else if (!state || state.tier === "normal") {
      reason = "Not threatened -- vans are busy with at-risk villages this window. Replanned next forecast.";
    } else if (reachMinutes * 2 > planningMinutes) {
      reason = `Too far for this ${hours(planningMinutes)} window (nearest van ${hours(reachMinutes)} away). Replanned next forecast.`;
    } else {
      reason = "Lower score than the villages the vans could fit this window. Replanned next forecast.";
    }
    out.set(village.id, { ...base, state: "waiting", reason });
  }
  return out;
}

/** Upper bound on back-to-back trips per van per 8 h window. */
const MAX_TRIPS_PER_WINDOW = 6;
/** Don't start a new trip with less than this left in the window. */
const MIN_TRIP_MINUTES = 30;

/** One out-and-back run: start -> pickups -> unload at a shelter. All
 * times are storm minutes since this forecast's replan. */
export interface VanTrip {
  startMinutes: number;
  endMinutes: number;
  /** Pickups, with arrival/departure already offset by startMinutes. */
  stops: Route["stops"];
  dropoffShelterId: string;
  totalDistanceKm: number;
  totalReward: number;
  totalDemandServed: number;
  waypoints: Waypoint[];
}

function makeTrip(route: Route, offset: number, start: GraphNode, dropoff: GraphNode, graph: ReturnType<typeof buildGraph>): VanTrip {
  const stops = route.stops.map((s) => ({ ...s, arrivalMinutes: s.arrivalMinutes + offset, departureMinutes: s.departureMinutes + offset }));
  const waypoints: Waypoint[] = [{ x: start.x, y: start.y, arriveMinutes: offset, departMinutes: offset }];
  let lastId = start.id;
  let lastDepart = offset;
  let km = 0;
  for (const stop of stops) {
    const node = graph.nodesById.get(stop.nodeId)!;
    km += graph.distanceKm.get(lastId)?.get(node.id) ?? 0;
    waypoints.push({ x: node.x, y: node.y, arriveMinutes: stop.arrivalMinutes, departMinutes: stop.departureMinutes });
    lastId = node.id;
    lastDepart = stop.departureMinutes;
  }
  km += graph.distanceKm.get(lastId)?.get(dropoff.id) ?? 0;
  const end = lastDepart + (graph.travelTimeMinutes.get(lastId)?.get(dropoff.id) ?? 0);
  waypoints.push({ x: dropoff.x, y: dropoff.y, arriveMinutes: end, departMinutes: end });
  return {
    startMinutes: offset,
    endMinutes: end,
    stops,
    dropoffShelterId: dropoff.id,
    totalDistanceKm: km,
    totalReward: route.totalReward,
    totalDemandServed: route.totalDemandServed,
    waypoints,
  };
}

function addTrip(vanId: number, trip: VanTrip): void {
  const list = session.vanTrips.get(vanId) ?? [];
  list.push(trip);
  session.vanTrips.set(vanId, list);
}

/** Derives the per-van views (merged route, full timeline, final drop-off)
 * the page and animation read, from session.vanTrips. */
function rebuildVanViews(): void {
  session.vanRoutes.clear();
  session.vanWaypoints.clear();
  for (const [vanId, trips] of session.vanTrips) {
    if (trips.length === 0) continue;
    const last = trips[trips.length - 1];
    session.vanRoutes.set(vanId, {
      stops: trips.flatMap((t) => t.stops),
      totalDistanceKm: trips.reduce((a, t) => a + t.totalDistanceKm, 0),
      totalTravelMinutes: last.endMinutes,
      totalReward: trips.reduce((a, t) => a + t.totalReward, 0),
      totalDemandServed: trips.reduce((a, t) => a + t.totalDemandServed, 0),
      computeTimeMs: 0,
    });
    // Each trip's first waypoint is where the previous one ended -- drop
    // the duplicate so the path is one continuous line.
    session.vanWaypoints.set(vanId, trips.flatMap((t, i) => (i === 0 ? t.waypoints : t.waypoints.slice(1))));
    session.vanDropoffShelterId.set(vanId, last.dropoffShelterId);
  }
}

/** Advance every van `minutes` of storm time along its planned trips:
 * evacuate the stops it reaches, unload at each shelter it reaches. */
function playOutPreviousPlans(minutes: number): void {
  for (const [vanId, trips] of session.vanTrips) {
    let load = session.vanLoad.get(vanId) ?? 0;
    for (const trip of trips) {
      if (trip.startMinutes > minutes) break;
      for (const stop of trip.stops) {
        if (stop.arrivalMinutes > minutes) break;
        session.evacuatedCellIds.add(stop.nodeId);
        load += stop.demandServed;
      }
      if (trip.endMinutes <= minutes) {
        session.shelterServed.set(trip.dropoffShelterId, (session.shelterServed.get(trip.dropoffShelterId) ?? 0) + load);
        load = 0;
      }
    }
    session.vanLoad.set(vanId, load);
    const waypoints = session.vanWaypoints.get(vanId);
    if (waypoints) {
      const pos = positionAtMinute(waypoints, minutes);
      session.vanStartPositions.set(vanId, { vanId, x: pos.x, y: pos.y });
    }
  }
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

/** Storm time elapsed at the current forecast, in minutes. */
export function stormMinutesElapsed(): number {
  return session.stormMinutes;
}

/** Storm minutes between the last forecast and the next SCHEDULED one --
 * 360 after a scheduled forecast, less after a special advisory. */
export function stormMinutesUntilScheduled(): number {
  return session.currentTick < 0 ? 0 : session.nextScheduledMinutes - session.stormMinutes;
}

/** When the on-screen countdown reaches the next scheduled forecast --
 * screen time, at 2 min per 6 h of storm time. */
export function screenNextUpdateIso(): string {
  const screenSeconds = stormMinutesUntilScheduled() / STORM_MINUTES_PER_SCREEN_SECOND;
  return new Date(session.lastForecastAt.getTime() + screenSeconds * 1000).toISOString();
}

export function setSolverTierSync(tier: SolverTier): void {
  session.solverTier = tier;
  setAppSolverTier(tier);
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

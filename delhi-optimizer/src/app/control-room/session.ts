import { SyntheticCellProvider } from "@/data/synthetic-cell-provider";
import { buildGraph } from "@/graph/build-graph";
import { planeDistanceKm } from "@/graph/plane-distance";
import { routeCluster, DEFAULT_CLUSTER_ROUTING_THRESHOLDS, type ClusterTeam, type ClusterRoutingThresholds } from "@/solver/cluster-router";
import { resolveTeamProcessingOrder } from "@/solver/contested-cell-arbitration";
import { CycloneForecastEngine, type ForecastTickResult } from "@/forecast/cyclone-forecast-engine";
import { priorityFromForecastTick } from "@/forecast/priority-from-forecast";
import type { GraphNode } from "@/types/graph";
import type { Route } from "@/types/game";

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
/** Real-world forecast cadence shown by the countdown -- short (2min) on
 * purpose for a live demo page. Still clickable at any time regardless of
 * how much is left (see actions.ts). */
export const FORECAST_INTERVAL_SECONDS = 120;
export const SHELTER_COUNT = 2;
export const VAN_COUNT = 4;
const VANS_PER_SHELTER = VAN_COUNT / SHELTER_COUNT;
/** Fixed per-tick planning budget -- same convention RollingHorizonController
 * itself uses (remainingMinutes is never decremented tick to tick there
 * either); each tick is an independent fresh plan, not a depleting shift. */
const VAN_BUDGET_MINUTES = 600;
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
  const forecastEngine = new CycloneForecastEngine(cells, seed, startedAt, FORECAST_INTERVAL_SECONDS);

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
    vanRoutes: new Map(),
    vanStartPositions,
    vanDropoffShelterId,
    evacuatedCellIds: new Set(),
    solverTier: "real",
    log: [],
  };
}

const globalForControlRoom = globalThis as unknown as { controlRoomSession?: ControlRoomSession };
export const session = globalForControlRoom.controlRoomSession ?? createSession();
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

function nearestShelter(point: { x: number; y: number }, shelters: GraphNode[]): GraphNode {
  let best = shelters[0];
  let bestDist = planeDistanceKm([point.x, point.y], [best.x, best.y]);
  for (const s of shelters.slice(1)) {
    const d = planeDistanceKm([point.x, point.y], [s.x, s.y]);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/** Pulls the next forecast and replans every van, each starting from its
 * own current (x, y) rather than its shelter. FLEET-WIDE processing
 * order: resolveTeamProcessingOrder runs ONCE across all 4 vans from
 * BOTH shelters together, so the van genuinely closest to the highest-
 * priority village gets first claim on it regardless of which shelter it
 * calls home -- not "whichever shelter is processed first always wins",
 * which was a real, confirmed bug (a van 21km away claimed the most
 * urgent village while a van 5.7km away, from the other shelter, sat
 * idle). Each van is then routed individually, in that fleet order, via
 * its OWN home shelter as depot -- routeCluster can't batch vans with
 * different depots into one joint call, so this is deliberately one call
 * per van rather than one call per shelter. */
export async function advanceForecast(vanPositions: VanPosition[]): Promise<void> {
  const nextTick = session.currentTick + 1;
  session.lastTick = session.forecastEngine.advanceTick(nextTick);
  session.currentTick = nextTick;

  for (const p of vanPositions) session.vanStartPositions.set(p.vanId, p);

  const { priorities, riskScores } = priorityFromForecastTick(session.cells, session.lastTick);
  const thresholds = SOLVER_TIER_THRESHOLDS[session.solverTier];

  const positionNodes = Array.from(session.vanStartPositions.values(), vanPositionNode);
  const graph = buildGraph([...session.shelters, ...session.origins, ...positionNodes]);

  // Start from what's already been evacuated, PLUS every shelter and
  // every van's synthetic position node -- none of those are real
  // villages, but computeNodeStates/computeBaselineRoute don't filter
  // candidates by role, only by priority and feasibility (see
  // optimization/feasibility.ts). A shelter or another van's position
  // marker has priority 0, same as "nothing better to do here", which is
  // NOT the same as "ineligible" -- without this explicit exclusion a
  // van will happily "visit" another van's position or a shelter as a
  // zero-value stop once real villages run low, which is a real bug
  // (confirmed live: a van's route included "shelter_1" and another
  // van's position node as stops), not just a cosmetic nit.
  const nonCandidateIds = new Set<string>([...session.shelters.map((s) => s.id), ...positionNodes.map((p) => p.id)]);
  const visited = new Set<string>([...session.evacuatedCellIds, ...nonCandidateIds]);

  const allTeams: ClusterTeam[] = Array.from(session.vanStartPositions.keys(), (vanId) => ({
    teamId: vanId,
    currentNodeId: `van_pos_${vanId}`,
    remainingMinutes: VAN_BUDGET_MINUTES,
    shiftedGameStartMinutesOfDay: 9 * 60,
    vehicleCapacity: VAN_CAPACITY,
  }));
  // resolveTeamProcessingOrder never reads cluster.shelterId, only
  // cluster.graph -- the shelter named here is a don't-care, just needs
  // SOME valid GraphCluster shape to pass the combined graph through.
  const fleetOrder = resolveTeamProcessingOrder({ shelterId: session.shelters[0].id, graph }, allTeams, priorities);

  const demandServedByShelter = new Map<string, number>(session.shelters.map((s) => [s.id, 0]));
  let totalRouted = 0;
  const methods: string[] = [];

  for (const team of fleetOrder) {
    const homeShelterId = session.vanHomeShelterId.get(team.teamId)!;
    const shelter = session.shelters.find((s) => s.id === homeShelterId)!;

    const result = await routeCluster({
      cluster: { shelterId: homeShelterId, graph },
      teams: [team],
      weekday: "monday",
      priorities,
      riskScores,
      demandServedSoFar: demandServedByShelter.get(homeShelterId) ?? 0,
      shelterCapacity: shelter.capacity,
      alreadyVisited: visited,
      thresholds,
    });

    const route = result.routesByTeam.get(team.teamId);
    if (route) {
      // The route was computed assuming it returns to the home shelter
      // (that's what feasibility/capacity were checked against) -- but
      // once the stop sequence is fixed, drop off wherever is actually
      // nearest to the last stop instead. A strictly closer shelter is
      // always a strictly SHORTER return leg, so this can only improve
      // the route, never break the feasibility already confirmed.
      let dropoffShelterId = homeShelterId;
      if (route.stops.length > 0) {
        const lastStop = graph.nodesById.get(route.stops[route.stops.length - 1].nodeId)!;
        const dropoff = nearestShelter(lastStop, session.shelters);
        if (dropoff.id !== homeShelterId) {
          const oldReturnKm = graph.distanceKm.get(lastStop.id)?.get(homeShelterId) ?? 0;
          const oldReturnMin = graph.travelTimeMinutes.get(lastStop.id)?.get(homeShelterId) ?? 0;
          const newReturnKm = graph.distanceKm.get(lastStop.id)?.get(dropoff.id) ?? 0;
          const newReturnMin = graph.travelTimeMinutes.get(lastStop.id)?.get(dropoff.id) ?? 0;
          route.totalDistanceKm += newReturnKm - oldReturnKm;
          route.totalTravelMinutes += newReturnMin - oldReturnMin;
          dropoffShelterId = dropoff.id;
        }
      }
      session.vanRoutes.set(team.teamId, route);
      session.vanDropoffShelterId.set(team.teamId, dropoffShelterId);
      for (const stop of route.stops) visited.add(stop.nodeId);
      // Credited to wherever the van ACTUALLY drops off, so next tick's
      // capacity bookkeeping reflects reality -- this tick's own
      // feasibility check already ran against the home shelter's
      // capacity, a documented approximation (the solver doesn't know
      // the eventual dropoff point until after it's already chosen the
      // stop sequence).
      demandServedByShelter.set(dropoffShelterId, (demandServedByShelter.get(dropoffShelterId) ?? 0) + route.totalDemandServed);
      totalRouted++;
    }
    methods.push(result.method);
  }

  logEvent(
    `Forecast ${nextTick}: storm now in the ${session.lastTick.zone.concentration.toLowerCase()} -- ${totalRouted} van route(s) updated (${methods.join(", ")}).`,
  );
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

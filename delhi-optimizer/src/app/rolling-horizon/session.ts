import { SyntheticCellProvider } from "@/data/synthetic-cell-provider";
import { buildClusteredGraph, type GraphCluster } from "@/graph/spatial-clustering";
import { RollingHorizonController, type VanState } from "@/game/rolling-horizon-controller";
import { DEFAULT_CLUSTER_ROUTING_THRESHOLDS, type ClusterRoutingThresholds } from "@/solver/cluster-router";
import type { GraphNode } from "@/types/graph";
import type { Route } from "@/types/game";

export type SolverTier = "fast" | "real";

/** "fast" forces every replan to the greedy tier (same thresholds the
 * controller was built with below) -- ~150ms for a full 12-van tick,
 * measured. "real" opens up the neural (Pointer Network + beam search)
 * tier at DEFAULT_CLUSTER_ROUTING_THRESHOLDS -- measured ~5s for a full
 * 12-van tick on this session's real cluster sizes (~80 nodes/cluster
 * average puts most clusters in the neural band, not exact). The exact
 * MILP tier is deliberately NEVER opened here even in "real" mode --
 * measured ~125s for one tick once clusters exceed a few dozen
 * candidates, which they do at this scale; DEFAULT_CLUSTER_ROUTING_
 * THRESHOLDS's own maxCandidatesForExact (40) already keeps it rare, and
 * this session's average ~80-node cluster sits above that anyway. */
export const SOLVER_TIER_THRESHOLDS: Record<SolverTier, ClusterRoutingThresholds> = {
  fast: { maxCandidatesForExact: 0, maxCandidatesForNeural: 0 },
  real: { maxCandidatesForExact: 0, maxCandidatesForNeural: DEFAULT_CLUSTER_ROUTING_THRESHOLDS.maxCandidatesForNeural },
};

/**
 * The ONE genuinely stateful page in this project (everything else --
 * /scale-preview, /dashboard -- is deliberately stateless and URL-driven,
 * recomputed fresh per request). RollingHorizonController itself is
 * inherently stateful: commit windows, van positions, and forecast
 * accumulation all need to persist across calls, which a per-request
 * server component can't provide on its own.
 *
 * This holds ONE global session in a module-level singleton (the same
 * `globalThis` pattern src/lib/prisma.ts already uses to survive Next.js
 * dev-mode hot reload re-evaluating this module). This is a single-user
 * demo pattern -- it does NOT support multiple concurrent independent
 * sessions, and would need a real per-session store (keyed by a session
 * id, likely backed by a database) before this could serve more than one
 * viewer at a time. That's an explicit, acknowledged limitation, not an
 * oversight: building real multi-session persistence is a much bigger
 * undertaking (the same kind of work the existing multiplayer game's
 * Postgres-backed session already does for the small-scale scenario) and
 * wasn't asked for here.
 */

const SEED = 7;
const SESSION_STARTED_AT = new Date();
/** The REAL forecast cadence (p) -- how often the underlying cyclone
 * forecast itself actually refreshes in-world. Drives the countdown
 * timer and the forecast geometry's own "next update" timestamp. */
export const FORECAST_INTERVAL_SECONDS = 8 * 3600;
/** How much simulated wall-clock time ONE "Advance Tick" click
 * represents for replanning purposes -- deliberately NOT the same as
 * the 8h forecast cadence above. At 480min/tick, a van's ~30min commit
 * window (tau) always expires long before the next tick fires, so
 * EVERY van gets replanned EVERY tick regardless of tau -- the commit
 * window's blocking effect was real but never observable. 15 minutes,
 * smaller than tau (30min), means a van committed this tick is still
 * genuinely committed (and correctly skipped) on the next one or two
 * ticks -- the actual behavior tau is supposed to produce. */
export const TICK_STEP_MINUTES = 15;
const LOOKAHEAD_MINUTES = 180; // H: this replan only reasons 3h ahead, not the full shift
const COMMIT_WINDOW_MINUTES = 30; // tau
const VAN_COUNT = 12;
const VAN_SHIFT_MINUTES = 480; // 8-hour shift budget per van

export interface RollingHorizonSession {
  cells: GraphNode[];
  clusters: GraphCluster[];
  controller: RollingHorizonController;
  /** -1 = no tick has run yet. */
  currentTick: number;
  /** Most recent route per van, persisted here because the controller
   * itself only returns routes transiently from each call -- it doesn't
   * remember them for later display. */
  vanRoutes: Map<number, Route>;
  log: string[];
  /** Fast (greedy, default) vs real (neural Pointer Network + beam
   * search) solver tier for every subsequent replan -- see
   * SOLVER_TIER_THRESHOLDS above for why exact MILP is never an option
   * here. Toggled by the user via setSolverTier(), read by every Server
   * Action in actions.ts as a per-call override, not baked into the
   * controller's own fixed config (so it can change mid-session). */
  solverTier: SolverTier;
}

function createSession(): RollingHorizonSession {
  const cells = new SyntheticCellProvider({ seed: SEED }).getNodes();
  const clusters = buildClusteredGraph(cells);
  const controller = new RollingHorizonController(cells, clusters, SEED, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS, {
    commitWindowMinutes: COMMIT_WINDOW_MINUTES,
    lookaheadMinutes: LOOKAHEAD_MINUTES,
    weekday: "monday",
    // Forced to the greedy tier: this page is clicked live in a browser,
    // so replan latency matters more than showcasing the exact/neural
    // tiers here -- those are already exercised directly in
    // cluster-router.test.ts and milp.test.ts. Raise these if slower,
    // more thorough replans are ever wanted on this specific page.
    thresholds: { maxCandidatesForExact: 0, maxCandidatesForNeural: 0 },
  });

  // A fixed fleet spread across shelters region-wide, NOT just the ones
  // near the storm (which moves every tick) -- assignVansToClusters
  // (Phase 4) figures out who's actually closest once the storm's
  // current position is known on each replan, same as the real design.
  const shelters = clusters.map((c) => c.graph.nodesById.get(c.shelterId)!);
  const step = Math.max(1, Math.floor(shelters.length / VAN_COUNT));
  for (let i = 0; i < VAN_COUNT; i++) {
    const shelter = shelters[(i * step) % shelters.length];
    const van: VanState = {
      vanId: i,
      currentNodeId: shelter.id,
      remainingMinutes: VAN_SHIFT_MINUTES,
      shiftedGameStartMinutesOfDay: 9 * 60,
      committedUntilMinutes: 0,
    };
    controller.registerVan(van);
  }

  return { cells, clusters, controller, currentTick: -1, vanRoutes: new Map(), log: [], solverTier: "fast" };
}

const globalForSession = globalThis as unknown as { rollingHorizonSession?: RollingHorizonSession };
export const session = globalForSession.rollingHorizonSession ?? createSession();
if (process.env.NODE_ENV !== "production") globalForSession.rollingHorizonSession = session;

export function logEvent(message: string): void {
  session.log.unshift(message);
  session.log = session.log.slice(0, 10);
}

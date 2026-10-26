import { evacuationGraph } from "@/api/route.service";
import { istMinutesOfDay, istWeekday } from "@/lib/ist-clock";
import { computeBaselineRoute } from "@/optimization/baseline-policy";
import { computeNeuralRoute } from "@/rl/beam-search";
import { riskPriorityProvider } from "@/rewards";
import type { Route } from "@/types/game";
import { gameRepository } from "./game.repository";
import { globallyVisitedOrigins, rewardContextFor, shelterCapacityOf } from "./game.service";
import { PlayerFinishedError, SessionEndedError } from "./game.errors";

/**
 * Dynamic replanning: recomputes a team's remaining route from its ACTUAL
 * current node (never the original depot), using the latest shared
 * evacuation state -- completed rescues, shared shelter capacity, and every
 * origin any OTHER team has already evacuated. Computes BOTH the baseline
 * greedy policy and the neural-policy-plus-beam-search decomposition on the
 * exact same inputs, so the two stay fairly comparable (Section 5).
 *
 * This function is read-only: it never mutates the player or session row.
 * Committing a result (so it's cached for display and visible to the
 * player across polls) is a separate, explicit step -- `commitPlan` below
 * -- because planning can take time (beam search is measured at
 * ~100-450x the baseline's latency) and another team may rescue a village,
 * or a new forecast may arrive, before that commit lands. See
 * `commitPlan`'s doc comment for the staleness protections.
 *
 * The neural route is NEVER preferred over the baseline just because it
 * exists: `selected` picks it only when it is both feasible (produced by
 * the SAME feasibility gate as the baseline, so "feasible" is automatic
 * for any non-thrown result) and strictly higher total reward. Measured
 * evidence so far (src/rl/evaluate.test.ts) shows neural reward ratios of
 * 1.000, 0.864, and 0.895 against the baseline on the real evacuation
 * scenario -- i.e. the baseline currently wins or ties every time that was
 * measured. This function does not hide or contradict that.
 */

export interface ReplanSnapshot {
  /** The forecast cycle this plan was computed against -- identical to
   * `SessionView.forecast.scenarioId`. A later `commitPlan` call fails
   * explicitly if the live scenario has since advanced past this. */
  scenarioVersion: number;
  /** The session's shared shelter-capacity total at snapshot time. */
  sessionDemandServed: number;
  /** Optimistic-lock stamp for the player row this plan was computed
   * against -- NOT re-serialized; pass the exact value back to commitPlan. */
  playerUpdatedAt: Date;
}

export interface RouteWithTiming {
  route: Route;
  computeTimeMs: number;
}

export type ReplanOutcome =
  | {
      status: "stale_scenario_version";
      requestedScenarioVersion: number;
      currentScenarioVersion: number;
    }
  | {
      status: "ok";
      snapshot: ReplanSnapshot;
      baseline: RouteWithTiming;
      /** Absent (not merely empty) only if the neural model itself failed
       * to load/run -- a real operational fault, not "no route found".
       * `computeNeuralRoute` always returns an explicit empty Route (never
       * throws) when no feasible move exists; see beam-search.ts. */
      neural: RouteWithTiming | { error: string };
      selected: { method: "baseline" | "neural"; route: Route };
    };

/**
 * Recomputes a team's remaining route from its current state. Pass
 * `requestedScenarioVersion` to require planning against a SPECIFIC
 * forecast cycle (e.g. retrying after a `stale_scenario_version` result);
 * omitted, it plans against whatever is live right now.
 */
export async function replanRoute(
  sessionId: number,
  playerId: number,
  requestedScenarioVersion?: number,
  beamWidth?: number,
): Promise<ReplanOutcome> {
  const [session, player, allPlayers] = await Promise.all([
    gameRepository.findSessionById(sessionId),
    gameRepository.findPlayerById(sessionId, playerId),
    gameRepository.listPlayers(sessionId),
  ]);
  if (session.status === "ended") throw new SessionEndedError(sessionId);
  if (player.status === "FINISHED") throw new PlayerFinishedError(playerId);

  const ctx = rewardContextFor(session);
  const snapshotForecast = riskPriorityProvider.getSnapshot(ctx);
  const currentScenarioVersion = snapshotForecast.forecast.scenarioId;

  if (requestedScenarioVersion !== undefined && requestedScenarioVersion !== currentScenarioVersion) {
    return { status: "stale_scenario_version", requestedScenarioVersion, currentScenarioVersion };
  }

  const weekday = istWeekday(session.startedAt);
  const gameStartMinutesOfDay = istMinutesOfDay(session.startedAt);
  const shelterCapacity = shelterCapacityOf(session.depotNodeId);
  const alreadyVisited = globallyVisitedOrigins(allPlayers);

  const routeInput = {
    graph: evacuationGraph,
    currentNodeId: player.currentNodeId,
    depotNodeId: session.depotNodeId,
    totalGameMinutes: session.totalGameMinutes - player.elapsedMinutes,
    gameStartMinutesOfDay: gameStartMinutesOfDay + player.elapsedMinutes,
    weekday,
    priorities: snapshotForecast.priorities,
    riskScores: snapshotForecast.riskScores,
    demandServedSoFar: session.demandServed,
    shelterCapacity,
    alreadyVisited,
  };

  const baselineStart = Date.now();
  const baselineRoute = computeBaselineRoute(routeInput);
  const baseline: RouteWithTiming = { route: baselineRoute, computeTimeMs: Date.now() - baselineStart };

  let neural: RouteWithTiming | { error: string };
  try {
    const neuralStart = Date.now();
    const neuralRoute = await computeNeuralRoute({ ...routeInput, beamWidth });
    neural = { route: neuralRoute, computeTimeMs: Date.now() - neuralStart };
  } catch (err) {
    // The neural path is explicitly allowed to fail operationally (e.g. the
    // ONNX model file missing in some environment) without taking down
    // replanning -- the baseline is always available as the safe fallback.
    neural = { error: err instanceof Error ? err.message : String(err) };
  }

  const selected: { method: "baseline" | "neural"; route: Route } =
    "route" in neural && neural.route.totalReward > baseline.route.totalReward
      ? { method: "neural", route: neural.route }
      : { method: "baseline", route: baseline.route };

  return {
    status: "ok",
    snapshot: {
      scenarioVersion: currentScenarioVersion,
      sessionDemandServed: session.demandServed,
      playerUpdatedAt: player.updatedAt,
    },
    baseline,
    neural,
    selected,
  };
}

export type CommitPlanOutcome =
  | { committed: true; planScenarioVersion: number }
  | { committed: false; reason: "stale_capacity" | "route_conflict" | "stale_player_state" | "stale_scenario_version" };

/**
 * Commits a `replanRoute` result as this player's cached current plan --
 * ONLY if nothing relevant has changed since `snapshot` was taken. All
 * three checks happen atomically inside one transaction
 * (gameRepository.commitPlayerPlanIfFresh), so a slow planning call can
 * never silently overwrite state that moved on while it ran:
 *
 *   - `stale_capacity`: the shared shelter capacity pool changed since
 *     snapshot (another team's collect landed).
 *   - `route_conflict`: another team's path now already contains one of
 *     this route's own stops.
 *   - `stale_player_state`: THIS player's row changed (moved, collected,
 *     or finished) since snapshot -- the plan was computed against a
 *     position the player is no longer actually at.
 *
 * Also re-checks the forecast scenario version BEFORE even attempting
 * that transaction: unlike the other three, a scenario rollover isn't a
 * row that can be conditionally updated, so it's checked as a fast,
 * explicit pre-check against the live session clock. The residual race
 * window this leaves (a rollover landing in the few ms between this check
 * and the transaction below) is immaterial given forecast intervals are
 * configured in hours, not milliseconds.
 *
 * Never holds the transaction open across planning -- by the time this is
 * called, `replanRoute`'s expensive work is already done; this is just the
 * fast verify-and-write.
 */
export async function commitPlan(
  sessionId: number,
  playerId: number,
  snapshot: ReplanSnapshot,
  method: "baseline" | "neural",
  route: Route,
): Promise<CommitPlanOutcome> {
  const expectedPlayerUpdatedAt =
    snapshot.playerUpdatedAt instanceof Date ? snapshot.playerUpdatedAt : new Date(snapshot.playerUpdatedAt);

  const session = await gameRepository.findSessionById(sessionId);
  const currentScenarioVersion = riskPriorityProvider.getSnapshot(rewardContextFor(session)).forecast.scenarioId;
  if (currentScenarioVersion !== snapshot.scenarioVersion) {
    return { committed: false, reason: "stale_scenario_version" };
  }

  const result = await gameRepository.commitPlayerPlanIfFresh({
    sessionId,
    playerId,
    expectedPlayerUpdatedAt,
    expectedSessionDemandServed: snapshot.sessionDemandServed,
    routeStopNodeIds: route.stops.map((s) => s.nodeId),
    planData: {
      // Prisma's Json input type wants a structurally plain JSON value, not
      // a nominally-typed `Route` -- a round-trip through JSON gives it
      // exactly that without changing the actual data.
      planRoute: JSON.parse(JSON.stringify(route)),
      planMethod: method,
      planScenarioVersion: snapshot.scenarioVersion,
      planComputedAt: new Date(),
    },
  });

  if (!result.ok) return { committed: false, reason: result.reason };
  return { committed: true, planScenarioVersion: snapshot.scenarioVersion };
}

export const replanService = {
  replanRoute,
  commitPlan,
};

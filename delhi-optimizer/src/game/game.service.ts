import type { GameSession, Player } from "@prisma/client";
import { EVACUATION_NODES, EVACUATION_NODES_BY_ID } from "@/data/evacuation-nodes";
import { evacuationGraph } from "@/api/route.service";
import { istMinutesOfDay, istWeekday } from "@/lib/ist-clock";
import { computeNodeStates, computeRelativeWindow, planArrival } from "@/optimization/feasibility";
import { computeBaselineRoute } from "@/optimization/baseline-policy";
import { riskPriorityProvider, type ForecastInfo, type RewardContext } from "@/rewards";
import { createSeed } from "@/rewards/seeded-random";
import { gameRepository } from "./game.repository";
import {
  CapacityExceededError,
  InfeasibleVisitError,
  PlayerFinishedError,
  SessionEndedError,
  UnknownNodeError,
} from "./game.errors";
import type { Route, InfeasibilityReason } from "@/types/game";
import type { CreateSessionRequest, JoinSessionRequest } from "./game.dto";

const PLAYER_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

export interface PlayerSummary {
  id: number;
  name: string;
  color: string;
  currentNodeId: string;
  elapsedMinutes: number;
  totalReward: number;
  /** People this player personally delivered to the shelter so far,
   * derived from their own path -- a personal stat, distinct from the
   * session's shared, contested `demandServed` capacity pool below. */
  demandServed: number;
  visitedCount: number;
  status: "active" | "finished";
}

export interface CommittedPlan {
  method: string;
  route: Route;
  /** The forecast cycle this plan was computed against -- see
   * replan.service.ts's ReplanSnapshot.scenarioVersion. */
  scenarioVersion: number;
  computedAtIso: string;
  /** True once the live forecast has advanced past the cycle this plan was
   * computed against -- a pure read-time comparison, not a push
   * notification; replan.service.ts's commitPlan is what actually refuses
   * to accept a stale commit. */
  isStale: boolean;
}

export interface PlayerDetail extends PlayerSummary {
  path: string[];
  feasibleNodeIds: string[];
  /** Why each currently-infeasible node is blocked, keyed by nodeId --
   * absent entries are either feasible or not applicable. Purely
   * explanatory, computed from computeNodeStates's own per-node reason;
   * never influences any routing decision. */
  infeasibleReasons: Record<string, InfeasibilityReason>;
  /** BaselineRoutePolicy's route from the player's current position -- the
   * eventual RL-vs-baseline-vs-CPLEX comparison's non-learned reference.
   * Always fresh, always computed -- never removed or replaced by the
   * cached `plan` below. */
  baselineRoute: Route;
  /** The last plan explicitly committed via replan.service.ts's
   * commitPlan, if any -- cached so an expensive beam-search/baseline
   * recompute isn't repeated on every poll. Absent until a team has
   * actually committed one. */
  plan?: CommittedPlan;
}

export interface SessionView {
  session: {
    id: number;
    depotNodeId: string;
    totalGameMinutes: number;
    forecastIntervalSeconds: number;
    startedAtIso: string;
    weekday: string;
    gameStartMinutesOfDay: number;
    status: string;
    /** The shelter's shared, contested capacity pool -- one number every
     * player in the session draws from, not a per-player budget. */
    shelterCapacity: number;
    demandServed: number;
  };
  priorities: Record<string, number>;
  riskScores: Record<string, number>;
  secondsUntilNextForecast: number;
  forecast?: ForecastInfo;
  players: PlayerSummary[];
  self?: PlayerDetail;
}

export function secondsSinceStart(session: GameSession): number {
  return Math.max(0, (Date.now() - session.startedAt.getTime()) / 1000) + (session.devTimeOffsetSeconds ?? 0);
}

export function shelterCapacityOf(depotNodeId: string): number {
  return evacuationGraph.nodesById.get(depotNodeId)?.capacity ?? 0;
}

/** Sum of demand for every origin this player has personally visited -- a
 * personal leaderboard stat, derived from their path rather than stored,
 * since it's always recomputable and never contested the way the shared
 * session-level `demandServed` pool is. */
function demandServedByPath(path: string[]): number {
  let total = 0;
  for (const nodeId of path) {
    const node = EVACUATION_NODES_BY_ID[nodeId];
    if (node?.role === "origin") total += node.demand;
  }
  return total;
}

/** Every origin already evacuated by ANY player in the session -- once an
 * origin's demand is served, it's globally done: no other player should
 * ever see it as feasible or get it suggested, even though each player's
 * own path/elapsedMinutes/score stay fully isolated. */
export function globallyVisitedOrigins(players: Player[]): Set<string> {
  const visited = new Set<string>();
  for (const p of players) {
    for (const nodeId of p.path as string[]) {
      if (EVACUATION_NODES_BY_ID[nodeId]?.role === "origin") visited.add(nodeId);
    }
  }
  return visited;
}

export function rewardContextFor(session: GameSession): RewardContext {
  return {
    seed: session.seed,
    startedAt: session.startedAt,
    secondsSinceStart: secondsSinceStart(session),
    forecastIntervalSeconds: session.forecastIntervalSeconds,
    nodes: EVACUATION_NODES,
  };
}

function toPlayerSummary(p: Player): PlayerSummary {
  const path = p.path as string[];
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    currentNodeId: p.currentNodeId,
    elapsedMinutes: p.elapsedMinutes,
    totalReward: p.totalReward,
    demandServed: demandServedByPath(path),
    visitedCount: path.length,
    status: p.status === "FINISHED" ? "finished" : "active",
  };
}

function toPlayerDetail(
  session: GameSession,
  player: Player,
  allPlayers: Player[],
  priorities: Map<string, number>,
  riskScores: Map<string, number>,
  currentScenarioVersion: number,
): PlayerDetail {
  const path = player.path as string[];
  const weekday = istWeekday(session.startedAt);
  const gameStartMinutesOfDay = istMinutesOfDay(session.startedAt);
  const shelterCapacity = shelterCapacityOf(session.depotNodeId);
  const globallyVisited = globallyVisitedOrigins(allPlayers);
  const visited = new Set([...path, ...globallyVisited]);

  const states = computeNodeStates({
    graph: evacuationGraph,
    currentNodeId: player.currentNodeId,
    depotNodeId: session.depotNodeId,
    elapsedMinutes: player.elapsedMinutes,
    totalGameMinutes: session.totalGameMinutes,
    gameStartMinutesOfDay,
    weekday,
    visited,
    priorities,
    riskScores,
    demandServedSoFar: session.demandServed,
    shelterCapacity,
  });

  const baselineRoute = computeBaselineRoute({
    graph: evacuationGraph,
    currentNodeId: player.currentNodeId,
    depotNodeId: session.depotNodeId,
    totalGameMinutes: session.totalGameMinutes - player.elapsedMinutes,
    gameStartMinutesOfDay: gameStartMinutesOfDay + player.elapsedMinutes,
    weekday,
    priorities,
    riskScores,
    demandServedSoFar: session.demandServed,
    shelterCapacity,
    alreadyVisited: globallyVisited,
  });

  const plan: CommittedPlan | undefined =
    player.planRoute && player.planMethod && player.planScenarioVersion !== null && player.planComputedAt
      ? {
          method: player.planMethod,
          route: player.planRoute as unknown as Route,
          scenarioVersion: player.planScenarioVersion,
          computedAtIso: player.planComputedAt.toISOString(),
          isStale: player.planScenarioVersion !== currentScenarioVersion,
        }
      : undefined;

  const infeasibleReasons: Record<string, InfeasibilityReason> = {};
  for (const s of states) {
    if (s.infeasibleReason) infeasibleReasons[s.nodeId] = s.infeasibleReason;
  }

  return {
    ...toPlayerSummary(player),
    path,
    feasibleNodeIds: states.filter((s) => s.feasible).map((s) => s.nodeId),
    infeasibleReasons,
    baselineRoute,
    plan,
  };
}

function toSessionView(session: GameSession, players: Player[], selfPlayerId?: number): SessionView {
  const ctx = rewardContextFor(session);
  const snapshot = riskPriorityProvider.getSnapshot(ctx);
  const self = selfPlayerId !== undefined ? players.find((p) => p.id === selfPlayerId) : undefined;

  return {
    session: {
      id: session.id,
      depotNodeId: session.depotNodeId,
      totalGameMinutes: session.totalGameMinutes,
      forecastIntervalSeconds: session.forecastIntervalSeconds,
      startedAtIso: session.startedAt.toISOString(),
      weekday: istWeekday(session.startedAt),
      gameStartMinutesOfDay: istMinutesOfDay(session.startedAt),
      status: session.status,
      shelterCapacity: shelterCapacityOf(session.depotNodeId),
      demandServed: session.demandServed,
    },
    priorities: Object.fromEntries(snapshot.priorities),
    riskScores: Object.fromEntries(snapshot.riskScores),
    secondsUntilNextForecast: riskPriorityProvider.secondsUntilNextForecast(ctx),
    forecast: snapshot.forecast,
    players: players.map(toPlayerSummary),
    self: self
      ? toPlayerDetail(session, self, players, snapshot.priorities, snapshot.riskScores, snapshot.forecast.scenarioId)
      : undefined,
  };
}

async function createPlayerInternal(session: GameSession, name: string, colorIndex: number): Promise<Player> {
  return gameRepository.createPlayer({
    session: { connect: { id: session.id } },
    name,
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    currentNodeId: session.depotNodeId,
    elapsedMinutes: 0,
    totalReward: 0,
    path: [session.depotNodeId],
    status: "ACTIVE",
  });
}

async function createSession(request: CreateSessionRequest): Promise<SessionView> {
  if (!evacuationGraph.nodesById.has(request.depotNodeId)) throw new UnknownNodeError(request.depotNodeId);

  const session = await gameRepository.createSession({
    seed: request.seed ?? createSeed(),
    depotNodeId: request.depotNodeId,
    totalGameMinutes: request.totalGameMinutes,
    forecastIntervalSeconds: request.forecastIntervalSeconds,
    status: "active",
  });

  const player = await createPlayerInternal(session, request.playerName, 0);
  return toSessionView(session, [player], player.id);
}

async function joinSession(sessionId: number, request: JoinSessionRequest): Promise<SessionView> {
  const session = await gameRepository.findSessionById(sessionId);
  if (session.status === "ended") throw new SessionEndedError(sessionId);

  const existing = await gameRepository.listPlayers(sessionId);
  const player = await createPlayerInternal(session, request.playerName, existing.length);
  return toSessionView(session, [...existing, player], player.id);
}

async function getSessionView(sessionId: number, playerId?: number): Promise<SessionView> {
  const [session, players] = await Promise.all([
    gameRepository.findSessionById(sessionId),
    gameRepository.listPlayers(sessionId),
  ]);
  return toSessionView(session, players, playerId);
}

/**
 * Server-authoritative "visit and collect": the client only ever requests a
 * nodeId; every fact about whether that's actually reachable, open, not
 * already visited, and within the shelter's remaining capacity is
 * recomputed here from persisted state, never trusted from the request.
 * The capacity check is advisory at this point -- the authoritative check
 * happens atomically inside gameRepository.collectOrigin below, since this
 * read can be stale by the time it commits (Decision 6's contested
 * resource).
 */
async function collectNode(sessionId: number, playerId: number, nodeId: string): Promise<SessionView> {
  const [session, player, allPlayers] = await Promise.all([
    gameRepository.findSessionById(sessionId),
    gameRepository.findPlayerById(sessionId, playerId),
    gameRepository.listPlayers(sessionId),
  ]);
  if (session.status === "ended") throw new SessionEndedError(sessionId);
  if (player.status === "FINISHED") throw new PlayerFinishedError(playerId);

  const node = evacuationGraph.nodesById.get(nodeId);
  if (!node) throw new UnknownNodeError(nodeId);

  const weekday = istWeekday(session.startedAt);
  const gameStartMinutesOfDay = istMinutesOfDay(session.startedAt);
  const shelterCapacity = shelterCapacityOf(session.depotNodeId);
  const globallyVisited = globallyVisitedOrigins(allPlayers);
  const visited = new Set([...(player.path as string[]), ...globallyVisited]);

  const ctx = rewardContextFor(session);
  const snapshot = riskPriorityProvider.getSnapshot(ctx);

  const states = computeNodeStates({
    graph: evacuationGraph,
    currentNodeId: player.currentNodeId,
    depotNodeId: session.depotNodeId,
    elapsedMinutes: player.elapsedMinutes,
    totalGameMinutes: session.totalGameMinutes,
    gameStartMinutesOfDay,
    weekday,
    visited,
    priorities: snapshot.priorities,
    riskScores: snapshot.riskScores,
    demandServedSoFar: session.demandServed,
    shelterCapacity,
  });

  const targetState = states.find((s) => s.nodeId === nodeId);
  if (!targetState?.feasible) throw new InfeasibleVisitError(nodeId);

  const window = computeRelativeWindow(node, weekday, gameStartMinutesOfDay);
  if (!window) throw new InfeasibleVisitError(nodeId); // defensive; feasible=true implies this can't happen

  const plan = planArrival(evacuationGraph, player.currentNodeId, nodeId, player.elapsedMinutes, window, node.serviceDurationMinutes);
  const reward = snapshot.priorities.get(nodeId) ?? 0;
  const demandAmount = node.role === "origin" ? node.demand : 0;

  const newPath = [...(player.path as string[]), nodeId];
  const newElapsed = plan.finishVisitMinutes;
  const newTotalReward = player.totalReward + reward;

  // Auto-finish once no further move is feasible from the new position,
  // using the capacity pool as it stands right now -- a real commit may
  // still shrink remaining capacity further once the atomic reservation
  // below lands, but that only ever makes fewer things feasible, so a
  // player correctly marked "finished" here never needed to un-finish.
  const nextStates = computeNodeStates({
    graph: evacuationGraph,
    currentNodeId: nodeId,
    depotNodeId: session.depotNodeId,
    elapsedMinutes: newElapsed,
    totalGameMinutes: session.totalGameMinutes,
    gameStartMinutesOfDay,
    weekday,
    visited: new Set([...newPath, ...globallyVisited]),
    priorities: snapshot.priorities,
    riskScores: snapshot.riskScores,
    demandServedSoFar: session.demandServed + demandAmount,
    shelterCapacity,
  });
  const noMovesLeft = !nextStates.some((s) => s.feasible);

  const result = await gameRepository.collectOrigin({
    sessionId,
    playerId,
    demandAmount,
    shelterCapacity,
    playerUpdate: {
      currentNodeId: nodeId,
      elapsedMinutes: newElapsed,
      totalReward: newTotalReward,
      path: newPath,
      status: noMovesLeft ? "FINISHED" : "ACTIVE",
      finishedAt: noMovesLeft ? new Date() : null,
      lastSeenAt: new Date(),
    },
  });

  if (!result) throw new CapacityExceededError(nodeId);

  const updatedSession: GameSession = { ...session, demandServed: result.demandServed };
  return toSessionView(
    updatedSession,
    allPlayers.map((p) => (p.id === result.player.id ? result.player : p)),
    playerId,
  );
}

async function endPlayer(sessionId: number, playerId: number): Promise<SessionView> {
  const [session, player] = await Promise.all([
    gameRepository.findSessionById(sessionId),
    gameRepository.findPlayerById(sessionId, playerId),
  ]);

  if (player.status !== "FINISHED") {
    await gameRepository.updatePlayer(player.id, {
      status: "FINISHED",
      finishedAt: new Date(),
      lastSeenAt: new Date(),
    });
  }

  const allPlayers = await gameRepository.listPlayers(sessionId);
  return toSessionView(session, allPlayers, playerId);
}

/**
 * Dev/demo-only action: jumps the session's forecast clock forward by
 * exactly one interval, so a demo can show a new forecast -- and the
 * feasible rerouting it triggers -- without waiting the real interval.
 * Never used by normal gameplay; see devTimeOffsetSeconds on GameSession.
 */
async function advanceForecast(sessionId: number): Promise<SessionView> {
  const session = await gameRepository.findSessionById(sessionId);
  const updated = await gameRepository.updateSession(sessionId, {
    devTimeOffsetSeconds: session.devTimeOffsetSeconds + session.forecastIntervalSeconds,
  });
  const players = await gameRepository.listPlayers(sessionId);
  return toSessionView(updated, players);
}

export const gameService = {
  createSession,
  joinSession,
  getSessionView,
  collectNode,
  endPlayer,
  advanceForecast,
};

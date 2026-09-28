import type { OptwEnvironment } from "@/lib/env/optw-environment";
import {
  createGeoEnvironment,
  orderedGeoPlaces,
  refreshDynamicRewards,
} from "@/lib/env/geo-environment";
import { computeDynamicRewards, rewardIntervalIndex, secondsUntilNextRewardUpdate } from "@/lib/env/dynamic-rewards";
import { createSeed } from "@/lib/env/rng";
import { getDelhiVisualGraph } from "@/lib/geo/delhi-graph";
import { initialDecoderState } from "@/lib/services/inference.service";
import { restoreDecoderState, snapshotDecoderState } from "@/lib/services/decoder-state-serialization";
import { applyChosenAction, optimizerService } from "@/lib/services/optimizer.service.impl";
import type { RecommendationResult } from "@/lib/services/optimizer.service";
import { gameRepository } from "@/lib/repositories/game.repository";
import {
  InfeasibleActionError,
  PlayerAlreadyFinishedError,
  SessionEndedError,
} from "@/lib/errors/domain-error";
import type { CreateSessionRequest, JoinSessionRequest } from "@/lib/dto/game.dto";
import type { GameSession, Player } from "@/db/schema";

const PLAYER_COLORS = [
  "#ef4444", "#3b82f6", "#22c55e", "#f59e0b",
  "#a855f7", "#06b6d4", "#ec4899", "#84cc16",
];

export interface PlaceView {
  id: string;
  name: string;
  category: string;
  latitude: number;
  longitude: number;
  visitDurationMinutes: number;
  index: number;
}

export interface PlayerSummary {
  id: number;
  name: string;
  color: string;
  currentNode: number;
  currentTime: number;
  totalReward: number;
  visitedCount: number;
  status: "active" | "finished";
  finalTime: number | null;
}

export interface PlayerDetail extends PlayerSummary {
  path: number[];
  recommendation: RecommendationResult;
}

export interface SessionView {
  session: {
    id: number;
    maxTime: number;
    beamWidth: number;
    rewardIntervalSeconds: number;
    status: "active" | "ended";
    startedAt: string;
  };
  places: PlaceView[];
  graphEdges: { from: number; to: number; distanceKm: number }[];
  depotIndex: number;
  currentRewards: number[];
  secondsUntilNextRewardUpdate: number;
  players: PlayerSummary[];
  self?: PlayerDetail;
}

function colorForIndex(i: number): string {
  return PLAYER_COLORS[i % PLAYER_COLORS.length];
}

function secondsSinceStart(session: GameSession): number {
  return Math.max(0, (Date.now() - new Date(session.startedAt).getTime()) / 1000);
}

/** Reconstructs this player's environment from the session's static config
 * plus their own small persisted state (path/currentNode/currentTime),
 * refreshed with whatever reward interval is live right now. All players in
 * a session share identical coords/distances/opening-hours; only the
 * dynamic rewards (a function of wall-clock time) and each player's own
 * position/visited-set differ. */
function buildPlayerEnvironment(session: GameSession, player: Player): OptwEnvironment {
  const env = createGeoEnvironment({
    seed: session.seed,
    startedAt: new Date(session.startedAt),
    maxTime: session.maxTime,
    rewardDecayMin: session.rewardDecayMin,
    rewardIntervalSeconds: session.rewardIntervalSeconds,
  });

  const path = player.path as number[];
  env.visited = new Array(env.visited.length).fill(false);
  for (const node of path) env.visited[node] = true;
  env.currentNode = player.currentNode;
  env.currentTime = player.currentTime;

  refreshDynamicRewards(env, session.seed, secondsSinceStart(session), session.rewardIntervalSeconds);
  return env;
}

function toPlayerSummary(p: Player): PlayerSummary {
  return {
    id: p.id,
    name: p.name,
    color: p.color,
    currentNode: p.currentNode,
    currentTime: p.currentTime,
    totalReward: p.totalReward,
    visitedCount: (p.path as number[]).length,
    status: p.status,
    finalTime: p.finalTime,
  };
}

function toPlayerDetail(p: Player): PlayerDetail {
  return {
    ...toPlayerSummary(p),
    path: p.path as number[],
    recommendation: p.recommendation as RecommendationResult,
  };
}

function toSessionView(session: GameSession, allPlayers: Player[], selfPlayerId?: number): SessionView {
  const places = orderedGeoPlaces();
  const nowSeconds = secondsSinceStart(session);
  const rewards = computeDynamicRewards(
    places.map((p) => p.baseReward),
    session.seed,
    rewardIntervalIndex(nowSeconds, session.rewardIntervalSeconds),
  );
  rewards[0] = 0;
  const { edges } = getDelhiVisualGraph();
  const self = selfPlayerId !== undefined ? allPlayers.find((p) => p.id === selfPlayerId) : undefined;

  return {
    session: {
      id: session.id,
      maxTime: session.maxTime,
      beamWidth: session.beamWidth,
      rewardIntervalSeconds: session.rewardIntervalSeconds,
      status: session.status,
      startedAt: new Date(session.startedAt).toISOString(),
    },
    places: places.map((p, index) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      latitude: p.latitude,
      longitude: p.longitude,
      visitDurationMinutes: p.visitDurationMinutes,
      index,
    })),
    graphEdges: edges,
    depotIndex: 0,
    currentRewards: rewards,
    secondsUntilNextRewardUpdate: secondsUntilNextRewardUpdate(nowSeconds, session.rewardIntervalSeconds),
    players: allPlayers.map(toPlayerSummary),
    self: self ? toPlayerDetail(self) : undefined,
  };
}

async function createPlayerInternal(session: GameSession, name: string, colorIndex: number): Promise<Player> {
  const numNodes = orderedGeoPlaces().length;
  const decoderState = initialDecoderState(numNodes);
  const env = createGeoEnvironment({
    seed: session.seed,
    startedAt: new Date(session.startedAt),
    maxTime: session.maxTime,
    rewardDecayMin: session.rewardDecayMin,
    rewardIntervalSeconds: session.rewardIntervalSeconds,
  });
  refreshDynamicRewards(env, session.seed, secondsSinceStart(session), session.rewardIntervalSeconds);

  const { recommendation, advancedDecoderState } = await optimizerService.recommend(
    env,
    decoderState,
    session.beamWidth,
  );

  return gameRepository.createPlayer({
    sessionId: session.id,
    name,
    color: colorForIndex(colorIndex),
    decoderState: snapshotDecoderState(advancedDecoderState),
    recommendation,
    path: [0],
    currentNode: 0,
    currentTime: 0,
    totalReward: 0,
    status: "active",
    lastSeenAt: new Date(),
  });
}

async function createSession(request: CreateSessionRequest): Promise<SessionView> {
  const seed = request.seed ?? createSeed();
  const startedAt = new Date();

  const session = await gameRepository.createSession({
    seed,
    startedAt,
    maxTime: request.maxTime,
    beamWidth: request.beamWidth,
    rewardDecayMin: request.rewardDecayMin,
    rewardIntervalSeconds: request.rewardIntervalSeconds,
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
  const session = await gameRepository.findSessionById(sessionId);
  const allPlayers = await gameRepository.listPlayers(sessionId);
  return toSessionView(session, allPlayers, playerId);
}

async function stepPlayer(sessionId: number, playerId: number, node: number): Promise<SessionView> {
  const session = await gameRepository.findSessionById(sessionId);
  if (session.status === "ended") throw new SessionEndedError(sessionId);

  const player = await gameRepository.findPlayerById(sessionId, playerId);
  if (player.status === "finished") throw new PlayerAlreadyFinishedError(playerId);

  const env = buildPlayerEnvironment(session, player);
  const mask = env.getAdmissibilityMask();
  if (!mask[node]) throw new InfeasibleActionError(node);

  const decoderStateBefore = restoreDecoderState(
    player.decoderState as Parameters<typeof restoreDecoderState>[0],
  );
  const { reward, done } = env.step(node);
  const decoderStateAfter = applyChosenAction(decoderStateBefore, node);

  const path = [...(player.path as number[]), node];
  const totalReward = player.totalReward + reward;

  let recommendation: RecommendationResult;
  if (done) {
    const returnTravelTime = env.distMatrix[env.currentNode][0];
    recommendation = {
      path: [...path, 0],
      totalReward,
      finalTime: env.currentTime + returnTravelTime,
      feasibleNodes: [],
      effectiveRewards: env.getEffectiveRewards(),
    };
  } else {
    const result = await optimizerService.recommend(env, decoderStateAfter, session.beamWidth);
    recommendation = result.recommendation;
  }

  const updated = await gameRepository.updatePlayer(player.id, {
    decoderState: snapshotDecoderState(decoderStateAfter),
    recommendation,
    path,
    currentNode: env.currentNode,
    currentTime: env.currentTime,
    totalReward,
    status: done ? "finished" : "active",
    finalTime: done ? recommendation.finalTime : null,
    lastSeenAt: new Date(),
  });

  const allPlayers = await gameRepository.listPlayers(sessionId);
  return toSessionView(session, allPlayers.map((p) => (p.id === updated.id ? updated : p)), playerId);
}

async function endPlayer(sessionId: number, playerId: number): Promise<SessionView> {
  const session = await gameRepository.findSessionById(sessionId);
  const player = await gameRepository.findPlayerById(sessionId, playerId);

  if (player.status !== "finished") {
    const env = buildPlayerEnvironment(session, player);
    const returnTravelTime = env.distMatrix[env.currentNode][0];
    const finalTime = env.currentTime + returnTravelTime;
    const path = [...(player.path as number[]), 0];
    const recommendation: RecommendationResult = {
      path,
      totalReward: player.totalReward,
      finalTime,
      feasibleNodes: [],
      effectiveRewards: env.getEffectiveRewards(),
    };

    await gameRepository.updatePlayer(player.id, {
      path,
      recommendation,
      status: "finished",
      finalTime,
      lastSeenAt: new Date(),
    });
  }

  const allPlayers = await gameRepository.listPlayers(sessionId);
  return toSessionView(session, allPlayers, playerId);
}

export const gameService = {
  createSession,
  joinSession,
  getSessionView,
  stepPlayer,
  endPlayer,
};

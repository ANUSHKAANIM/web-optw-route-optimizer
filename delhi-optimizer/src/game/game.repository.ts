import { prisma } from "@/lib/prisma";
import { NotFoundError } from "./game.errors";
import type { GameSession, Player, Prisma } from "@prisma/client";

/** Data-access layer for game_sessions / players. No business logic here --
 * only persistence concerns (Section 32/36: validation and rules live in
 * game.service.ts, not here and not in the API route handler). */
export const gameRepository = {
  async createSession(data: Prisma.GameSessionCreateInput): Promise<GameSession> {
    return prisma.gameSession.create({ data });
  },

  async findSessionById(id: number): Promise<GameSession> {
    const session = await prisma.gameSession.findUnique({ where: { id } });
    if (!session) throw new NotFoundError(`Session ${id} was not found.`);
    return session;
  },

  async updateSession(id: number, data: Prisma.GameSessionUpdateInput): Promise<GameSession> {
    return prisma.gameSession.update({ where: { id }, data });
  },

  async createPlayer(data: Prisma.PlayerCreateInput): Promise<Player> {
    return prisma.player.create({ data });
  },

  async findPlayerById(sessionId: number, playerId: number): Promise<Player> {
    const player = await prisma.player.findUnique({ where: { id: playerId } });
    if (!player || player.sessionId !== sessionId) {
      throw new NotFoundError(`Player ${playerId} was not found in session ${sessionId}.`);
    }
    return player;
  },

  async updatePlayer(id: number, data: Prisma.PlayerUpdateInput): Promise<Player> {
    return prisma.player.update({ where: { id }, data });
  },

  async listPlayers(sessionId: number): Promise<Player[]> {
    return prisma.player.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
  },

  /**
   * Atomically reserves `demandAmount` of the session's shared shelter
   * capacity AND applies the player's update in the same transaction --
   * the concurrency protection Decision 6 required for this contested
   * resource. Two players racing to collect the last remaining capacity
   * cannot both succeed: the conditional UPDATE's WHERE clause is
   * evaluated against Postgres' row-locked, already-committed total, not a
   * stale read, and the player row only ever changes alongside a capacity
   * reservation that actually succeeded. Returns null if this reservation
   * would have exceeded capacity -- the caller should treat that as a lost
   * race, not a bug, and nothing is partially applied in that case.
   */
  async collectOrigin(params: {
    sessionId: number;
    playerId: number;
    demandAmount: number;
    shelterCapacity: number;
    playerUpdate: Prisma.PlayerUpdateInput;
  }): Promise<{ player: Player; demandServed: number } | null> {
    const { sessionId, playerId, demandAmount, shelterCapacity, playerUpdate } = params;
    return prisma.$transaction(async (tx) => {
      let demandServed: number;
      if (demandAmount > 0) {
        const rows = await tx.$queryRaw<{ demandServed: number }[]>`
          UPDATE "game_sessions"
          SET "demandServed" = "demandServed" + ${demandAmount}
          WHERE "id" = ${sessionId} AND "demandServed" + ${demandAmount} <= ${shelterCapacity}
          RETURNING "demandServed"
        `;
        if (rows.length === 0) return null;
        demandServed = rows[0].demandServed;
      } else {
        const session = await tx.gameSession.findUniqueOrThrow({
          where: { id: sessionId },
          select: { demandServed: true },
        });
        demandServed = session.demandServed;
      }
      const player = await tx.player.update({ where: { id: playerId }, data: playerUpdate });
      return { player, demandServed };
    });
  },

  /**
   * Commits a previously computed plan (replan.service.ts's `replanRoute`
   * output) for one player, but ONLY if nothing relevant has changed since
   * that plan was computed -- the optimistic-concurrency protection
   * Section 3 requires. All three checks and the write happen inside one
   * transaction, so there is no check-then-write gap a concurrent
   * collectOrigin/commitPlayerPlanIfFresh call could land in:
   *
   *   1. The session's shared demandServed must still match what planning
   *      saw (shared capacity hasn't moved).
   *   2. None of the route's own stops may already appear in any OTHER
   *      player's path (nobody else claimed one of these villages while
   *      this plan was being computed).
   *   3. The player row's `updatedAt` must still match `expectedPlayerUpdatedAt`
   *      -- an atomic conditional UPDATE, not a prior read: if this
   *      player moved/collected/finished in the meantime, the count is 0
   *      and nothing is written.
   */
  async commitPlayerPlanIfFresh(params: {
    sessionId: number;
    playerId: number;
    expectedPlayerUpdatedAt: Date;
    expectedSessionDemandServed: number;
    routeStopNodeIds: string[];
    planData: Prisma.PlayerUpdateInput;
  }): Promise<
    | { ok: true; player: Player }
    | { ok: false; reason: "stale_capacity" | "route_conflict" | "stale_player_state" }
  > {
    const { sessionId, playerId, expectedPlayerUpdatedAt, expectedSessionDemandServed, routeStopNodeIds, planData } = params;

    return prisma.$transaction(async (tx) => {
      const session = await tx.gameSession.findUniqueOrThrow({
        where: { id: sessionId },
        select: { demandServed: true },
      });
      if (session.demandServed !== expectedSessionDemandServed) {
        return { ok: false, reason: "stale_capacity" } as const;
      }

      if (routeStopNodeIds.length > 0) {
        const otherPlayers = await tx.player.findMany({
          where: { sessionId, id: { not: playerId } },
          select: { path: true },
        });
        const claimed = new Set<string>();
        for (const p of otherPlayers) {
          for (const nodeId of p.path as string[]) claimed.add(nodeId);
        }
        if (routeStopNodeIds.some((id) => claimed.has(id))) {
          return { ok: false, reason: "route_conflict" } as const;
        }
      }

      const result = await tx.player.updateMany({
        where: { id: playerId, updatedAt: expectedPlayerUpdatedAt },
        data: planData,
      });
      if (result.count === 0) {
        return { ok: false, reason: "stale_player_state" } as const;
      }

      const player = await tx.player.findUniqueOrThrow({ where: { id: playerId } });
      return { ok: true, player } as const;
    });
  },
};

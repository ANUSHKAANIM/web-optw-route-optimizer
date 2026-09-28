import { asc, eq } from "drizzle-orm";
import { getDbAsync } from "@/db/client";
import {
  gameSessions,
  players,
  type GameSession,
  type NewGameSession,
  type NewPlayer,
  type Player,
} from "@/db/schema";
import { NotFoundError } from "@/lib/errors/domain-error";

/** Data-access layer for `game_sessions` / `players`. Contains no business
 * logic -- only persistence concerns (mirrors run.repository.ts). */
export const gameRepository = {
  async createSession(data: NewGameSession): Promise<GameSession> {
    const db = await getDbAsync();
    const [row] = await db.insert(gameSessions).values(data).returning();
    return row;
  },

  async findSessionById(id: number): Promise<GameSession> {
    const db = await getDbAsync();
    const [row] = await db.select().from(gameSessions).where(eq(gameSessions.id, id)).limit(1);
    if (!row) throw new NotFoundError(`Session ${id} was not found.`);
    return row;
  },

  async updateSession(id: number, data: Partial<NewGameSession>): Promise<GameSession> {
    const db = await getDbAsync();
    const [row] = await db
      .update(gameSessions)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(gameSessions.id, id))
      .returning();
    if (!row) throw new NotFoundError(`Session ${id} was not found.`);
    return row;
  },

  async createPlayer(data: NewPlayer): Promise<Player> {
    const db = await getDbAsync();
    const [row] = await db.insert(players).values(data).returning();
    return row;
  },

  async findPlayerById(sessionId: number, playerId: number): Promise<Player> {
    const db = await getDbAsync();
    const [row] = await db
      .select()
      .from(players)
      .where(eq(players.id, playerId))
      .limit(1);
    if (!row || row.sessionId !== sessionId) {
      throw new NotFoundError(`Player ${playerId} was not found in session ${sessionId}.`);
    }
    return row;
  },

  async updatePlayer(id: number, data: Partial<NewPlayer>): Promise<Player> {
    const db = await getDbAsync();
    const [row] = await db
      .update(players)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(players.id, id))
      .returning();
    if (!row) throw new NotFoundError(`Player ${id} was not found.`);
    return row;
  },

  async listPlayers(sessionId: number): Promise<Player[]> {
    const db = await getDbAsync();
    return db
      .select()
      .from(players)
      .where(eq(players.sessionId, sessionId))
      .orderBy(asc(players.createdAt));
  },
};

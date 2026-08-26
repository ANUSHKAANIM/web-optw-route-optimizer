import { and, desc, asc, eq, count, type SQL } from "drizzle-orm";
import { getDbAsync } from "@/db/client";
import { runEvents, runs, type NewRun, type NewRunEvent, type Run, type RunStatus } from "@/db/schema";
import { NotFoundError } from "@/lib/errors/domain-error";
import type { ListRunsQuery } from "@/lib/dto/run.dto";

/** Data-access layer for `runs` / `run_events`. Contains no business logic --
 * only persistence concerns. */
export const runRepository = {
  async create(data: NewRun): Promise<Run> {
    const db = await getDbAsync();
    const [row] = await db.insert(runs).values(data).returning();
    return row;
  },

  async findById(id: number): Promise<Run> {
    const db = await getDbAsync();
    const [row] = await db.select().from(runs).where(eq(runs.id, id)).limit(1);
    if (!row) throw new NotFoundError(`Run ${id} was not found.`);
    return row;
  },

  async update(id: number, data: Partial<NewRun>): Promise<Run> {
    const db = await getDbAsync();
    const [row] = await db
      .update(runs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(runs.id, id))
      .returning();
    if (!row) throw new NotFoundError(`Run ${id} was not found.`);
    return row;
  },

  async list(
    query: ListRunsQuery,
  ): Promise<{ items: Run[]; total: number; page: number; pageSize: number }> {
    const db = await getDbAsync();
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(runs.status, query.status as RunStatus));
    const where = conditions.length ? and(...conditions) : undefined;

    const sortColumn = { createdAt: runs.createdAt, totalReward: runs.totalReward, numNodes: runs.numNodes }[
      query.sortBy
    ];
    const orderFn = query.sortDir === "asc" ? asc : desc;

    const [items, totalRow] = await Promise.all([
      db
        .select()
        .from(runs)
        .where(where)
        .orderBy(orderFn(sortColumn))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      db.select({ value: count() }).from(runs).where(where),
    ]);

    return { items, total: totalRow[0]?.value ?? 0, page: query.page, pageSize: query.pageSize };
  },

  async appendEvent(data: NewRunEvent): Promise<void> {
    const db = await getDbAsync();
    await db.insert(runEvents).values(data);
  },

  async listEvents(runId: number) {
    const db = await getDbAsync();
    return db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(asc(runEvents.stepIndex));
  },
};

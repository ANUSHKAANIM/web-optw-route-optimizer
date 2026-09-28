import { boolean, integer, jsonb, pgTable, real, serial, text, timestamp } from "drizzle-orm/pg-core";

export const RUN_STATUS = ["in_progress", "completed"] as const;
export type RunStatus = (typeof RUN_STATUS)[number];

/**
 * One optimization run: its configuration, its current live environment +
 * decoder state (so a stateless serverless invocation can resume it), and a
 * summary of progress so far. `env_state` / `decoder_state` are opaque JSON
 * snapshots -- see lib/env/serialization.ts and
 * lib/services/decoder-state-serialization.ts for their shape.
 */
export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  numNodes: integer("num_nodes").notNull(),
  maxTime: real("max_time").notNull(),
  beamWidth: integer("beam_width").notNull(),
  rewardDecayMin: real("reward_decay_min").notNull(),
  forecastEnabled: boolean("forecast_enabled").notNull(),
  seed: integer("seed").notNull(),
  status: text("status", { enum: RUN_STATUS }).notNull().default("in_progress"),
  /** Snapshot taken at creation, before any steps -- never mutated again.
   * Lets the greedy-vs-beam comparison always run on the original instance,
   * regardless of how far the interactive session has since progressed. */
  initialEnvState: jsonb("initial_env_state").notNull(),
  envState: jsonb("env_state").notNull(),
  decoderState: jsonb("decoder_state").notNull(),
  /** Latest computed beam-search recommendation from the current position;
   * see RecommendationResult in optimizer.service.ts. Recomputed after every step. */
  recommendation: jsonb("recommendation").notNull(),
  path: jsonb("path").notNull().$type<number[]>(),
  currentNode: integer("current_node").notNull().default(0),
  currentTime: real("current_time").notNull().default(0),
  totalReward: real("total_reward").notNull().default(0),
  finalTime: real("final_time"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Append-only log of each move made within a run, for replay/audit on the
 * run detail page. */
export const runEvents = pgTable("run_events", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => runs.id, { onDelete: "cascade" }),
  stepIndex: integer("step_index").notNull(),
  node: integer("node").notNull(),
  reward: real("reward").notNull(),
  cumulativeReward: real("cumulative_reward").notNull(),
  currentTime: real("current_time").notNull(),
  forecastUpdated: boolean("forecast_updated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type RunEvent = typeof runEvents.$inferSelect;
export type NewRunEvent = typeof runEvents.$inferInsert;

export const SESSION_STATUS = ["active", "ended"] as const;
export type SessionStatus = (typeof SESSION_STATUS)[number];

export const PLAYER_STATUS = ["active", "finished"] as const;
export type PlayerStatus = (typeof PLAYER_STATUS)[number];

/**
 * A shared multiplayer Delhi orienteering game. Unlike `runs`, this table
 * stores no environment snapshot: the ~80-place graph and travel-time matrix
 * are static (see lib/env/geo-environment.ts) and each interval's dynamic
 * rewards are a pure function of (seed, intervalIndex), so they're
 * recomputed on read rather than persisted. `startedAt` anchors both the
 * game clock and each place's real opening/closing window for the session.
 */
export const gameSessions = pgTable("game_sessions", {
  id: serial("id").primaryKey(),
  seed: integer("seed").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  maxTime: real("max_time").notNull(),
  beamWidth: integer("beam_width").notNull(),
  rewardDecayMin: real("reward_decay_min").notNull(),
  rewardIntervalSeconds: integer("reward_interval_seconds").notNull(),
  status: text("status", { enum: SESSION_STATUS }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One player's independent progress within a game session: own path,
 * score, current node/time, and decoder memory -- isolated from every other
 * player in the same session, which only shares the session's clock and
 * dynamic reward schedule. Mirrors the `runs` persistence pattern so a
 * stateless serverless request can resume a player's decoder state. */
export const players = pgTable("players", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id")
    .notNull()
    .references(() => gameSessions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  decoderState: jsonb("decoder_state").notNull(),
  recommendation: jsonb("recommendation").notNull(),
  path: jsonb("path").notNull().$type<number[]>(),
  currentNode: integer("current_node").notNull().default(0),
  currentTime: real("current_time").notNull().default(0),
  totalReward: real("total_reward").notNull().default(0),
  status: text("status", { enum: PLAYER_STATUS }).notNull().default("active"),
  finalTime: real("final_time"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type GameSession = typeof gameSessions.$inferSelect;
export type NewGameSession = typeof gameSessions.$inferInsert;
export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;

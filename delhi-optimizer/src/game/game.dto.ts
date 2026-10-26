import { z } from "zod";
import { SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";

const NINE_HOURS_SECONDS = 9 * 3600;

export const createSessionSchema = z.object({
  playerName: z.string().trim().min(1).max(40),
  depotNodeId: z.string().min(1).default(SHELTER_DEPOT_ID),
  totalGameMinutes: z.number().positive().max(1440).default(240),
  forecastIntervalSeconds: z.number().int().min(60).max(86400).default(NINE_HOURS_SECONDS),
  seed: z.number().int().optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionSchema>;

export const joinSessionSchema = z.object({
  playerName: z.string().trim().min(1).max(40),
});
export type JoinSessionRequest = z.infer<typeof joinSessionSchema>;

export const collectNodeSchema = z.object({
  nodeId: z.string().min(1),
});
export type CollectNodeRequest = z.infer<typeof collectNodeSchema>;

export const replanRequestSchema = z.object({
  playerId: z.number().int().positive(),
  /** Omit to plan against whatever forecast cycle is currently live;
   * pass it to require planning against a SPECIFIC cycle (e.g. retrying
   * after a stale_scenario_version result). */
  scenarioVersion: z.number().int().optional(),
  beamWidth: z.number().int().min(1).max(64).optional(),
});
export type ReplanRequest = z.infer<typeof replanRequestSchema>;

const routeStopSchema = z.object({
  nodeId: z.string().min(1),
  arrivalMinutes: z.number(),
  waitMinutes: z.number(),
  departureMinutes: z.number(),
  rewardCollected: z.number(),
  demandServed: z.number(),
});

const routeSchema = z.object({
  stops: z.array(routeStopSchema),
  totalDistanceKm: z.number(),
  totalTravelMinutes: z.number(),
  totalReward: z.number(),
  totalDemandServed: z.number(),
  computeTimeMs: z.number(),
});

export const commitPlanRequestSchema = z.object({
  playerId: z.number().int().positive(),
  scenarioVersion: z.number().int(),
  sessionDemandServed: z.number().int(),
  /** The `playerUpdatedAt` from the ReplanSnapshot a prior /replan call
   * returned, round-tripped as ISO -- the optimistic-lock stamp commitPlan
   * verifies hasn't moved on. */
  playerUpdatedAtIso: z.string(),
  method: z.enum(["baseline", "neural"]),
  route: routeSchema,
});
export type CommitPlanRequest = z.infer<typeof commitPlanRequestSchema>;

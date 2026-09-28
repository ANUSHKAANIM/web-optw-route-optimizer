import { z } from "zod";
import { DEFAULT_REWARD_INTERVAL_SECONDS } from "@/lib/env/dynamic-rewards";

/** Request body for POST /api/sessions. */
export const createSessionSchema = z.object({
  maxTime: z.number().positive().max(16).default(10),
  beamWidth: z.number().int().min(1).max(64).default(16),
  rewardDecayMin: z.number().min(0).max(1).default(0.3),
  rewardIntervalSeconds: z.number().int().min(10).max(600).default(DEFAULT_REWARD_INTERVAL_SECONDS),
  seed: z.number().int().optional(),
  playerName: z.string().trim().min(1).max(40),
});
export type CreateSessionRequest = z.infer<typeof createSessionSchema>;

/** Request body for POST /api/sessions/[id]/join. */
export const joinSessionSchema = z.object({
  playerName: z.string().trim().min(1).max(40),
});
export type JoinSessionRequest = z.infer<typeof joinSessionSchema>;

/** Request body for POST /api/sessions/[id]/players/[playerId]/step. */
export const stepPlayerSchema = z.object({
  node: z.number().int().min(0),
});
export type StepPlayerRequest = z.infer<typeof stepPlayerSchema>;

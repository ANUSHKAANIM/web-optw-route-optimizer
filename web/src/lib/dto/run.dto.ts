import { z } from "zod";

/** Request body for POST /api/runs -- mirrors the CLI prompts in
 * run_pipeline.py's run_optw_pipeline(). */
export const createRunSchema = z.object({
  numNodes: z.number().int().min(5).max(200).default(30),
  maxTime: z.number().positive().max(1000).default(24.0),
  beamWidth: z.number().int().min(1).max(128).default(16),
  rewardDecayMin: z.number().min(0).max(1).default(0.3),
  enableForecastEvents: z.boolean().default(false),
  hazardRadius: z.number().positive().max(10).default(0.4),
  forecastUpdateInterval: z.number().positive().max(100).default(4.0),
  forecastNoise: z.number().min(0).max(5).default(0.12),
  seed: z.number().int().optional(),
});
export type CreateRunRequest = z.infer<typeof createRunSchema>;

/** Request body for POST /api/runs/[id]/step. */
export const stepRunSchema = z.object({
  node: z.number().int().min(0),
});
export type StepRunRequest = z.infer<typeof stepRunSchema>;

export const listRunsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["in_progress", "completed"]).optional(),
  sortBy: z.enum(["createdAt", "totalReward", "numNodes"]).default("createdAt"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});
export type ListRunsQuery = z.infer<typeof listRunsQuerySchema>;

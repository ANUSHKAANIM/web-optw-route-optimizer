import type { Run, RunEvent } from "@/db/schema";
import type { CreateRunRequest, ListRunsQuery } from "@/lib/dto/run.dto";
import type { RecommendationResult, RouteResult } from "@/lib/services/optimizer.service";
import type { runRepository } from "@/lib/repositories/run.repository";

export interface RunView {
  run: Run;
  recommendation: RecommendationResult;
  coords: [number, number][];
  rewards: number[];
  maxTime: number;
  done: boolean;
  forecastJustUpdated: boolean;
}

export interface ComparisonView {
  coords: [number, number][];
  rewards: number[];
  maxTime: number;
  greedy: RouteResult;
  beam: RouteResult;
  beamWidth: number;
}

/** Business-logic contract for the OPTW run lifecycle: creating a run,
 * advancing it one interactive step at a time, and reading it back. */
export interface RunService {
  createRun(request: CreateRunRequest): Promise<RunView>;
  getRun(id: number): Promise<RunView>;
  stepRun(id: number, node: number): Promise<RunView>;
  /** Ends the run early at its current position (mirrors the CLI's 'q' ->
   * head straight back to depot without visiting anything else). */
  endRun(id: number): Promise<RunView>;
  /** Runs greedy search and beam search on the run's ORIGINAL instance (as
   * generated at creation, before any interactive steps), for a side-by-side
   * quality comparison -- independent of how far the live session has progressed. */
  compareRun(id: number): Promise<ComparisonView>;
  listEvents(id: number): Promise<RunEvent[]>;
  listRuns(query: ListRunsQuery): ReturnType<typeof runRepository.list>;
}

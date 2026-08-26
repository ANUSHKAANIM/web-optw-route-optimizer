import type { Run } from "@/db/schema";
import type { CreateRunRequest, ListRunsQuery } from "@/lib/dto/run.dto";
import type { RecommendationResult } from "@/lib/services/optimizer.service";
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

/** Business-logic contract for the OPTW run lifecycle: creating a run,
 * advancing it one interactive step at a time, and reading it back. */
export interface RunService {
  createRun(request: CreateRunRequest): Promise<RunView>;
  getRun(id: number): Promise<RunView>;
  stepRun(id: number, node: number): Promise<RunView>;
  /** Ends the run early at its current position (mirrors the CLI's 'q' ->
   * head straight back to depot without visiting anything else). */
  endRun(id: number): Promise<RunView>;
  listRuns(query: ListRunsQuery): ReturnType<typeof runRepository.list>;
}

import type { OptwEnvironment } from "@/lib/env/optw-environment";
import type { DecoderState } from "@/lib/services/inference.service";

export interface RouteResult {
  path: number[];
  totalReward: number;
  finalTime: number;
}

export interface RecommendationResult extends RouteResult {
  feasibleNodes: number[];
  effectiveRewards: number[];
}

/** Business-logic contract for producing OPTW routes from a trained model. */
export interface OptimizerService {
  /** Deterministic argmax rollout from the depot. */
  greedySearch(env: OptwEnvironment): Promise<RouteResult>;

  /** Beam-search rollout, optionally continuing from an in-progress decoder state
   * (used for live rerouting instead of resetting to the depot). */
  beamSearch(
    env: OptwEnvironment,
    beamWidth: number,
    seed?: { decoderState: DecoderState; startNode: number },
  ): Promise<RouteResult>;

  /** One interactive decision point: advances the decoder for the current
   * position and returns the best recommended continuation plus every
   * feasible next node, without committing to a move. */
  recommend(
    env: OptwEnvironment,
    decoderState: DecoderState,
    beamWidth: number,
  ): Promise<{ recommendation: RecommendationResult; advancedDecoderState: DecoderState }>;
}

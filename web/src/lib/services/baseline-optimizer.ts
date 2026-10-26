import type { OptwEnvironment } from "@/lib/env/optw-environment";
import type { RouteResult } from "@/lib/services/optimizer.service";

/**
 * Traditional (non-learned) baseline: a greedy reward-density heuristic.
 * At every step it visits the feasible node maximizing effective reward per
 * hour of travel, exactly the kind of nearest-neighbor-style heuristic a
 * classical OR solver would use as a quick lower bound. No inference, no
 * model -- this exists purely so the neural policy's route has something
 * genuinely non-ML to be compared against (unlike greedy vs. beam, which
 * are both driven by the same trained model).
 */
export function baselineHeuristicSearch(envInitial: OptwEnvironment): RouteResult {
  const env = envInitial.clone();
  const path = [env.currentNode];
  let totalReward = 0;

  while (true) {
    const mask = env.getAdmissibilityMask();
    if (!mask.some(Boolean)) break;

    const effectiveRewards = env.getEffectiveRewards();
    const travelTimes = env.distMatrix[env.currentNode];

    let bestNode = -1;
    let bestDensity = -Infinity;
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const density = effectiveRewards[i] / Math.max(travelTimes[i], 1e-6);
      if (density > bestDensity) {
        bestDensity = density;
        bestNode = i;
      }
    }
    if (bestNode === -1) break;

    const { reward } = env.step(bestNode);
    path.push(bestNode);
    totalReward += reward;
  }

  const returnTravelTime = env.distMatrix[env.currentNode][0];
  return { path: [...path, 0], totalReward, finalTime: env.currentTime + returnTravelTime };
}

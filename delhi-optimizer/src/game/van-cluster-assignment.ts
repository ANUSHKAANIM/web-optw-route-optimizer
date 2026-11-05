import { planeDistanceKm } from "@/graph/plane-distance";
import { AVG_TRAVEL_SPEED_KMH } from "@/graph/build-graph";
import type { GraphCluster } from "@/graph/spatial-clustering";

export interface VanPosition {
  vanId: number;
  x: number;
  y: number;
}

/**
 * Assigns each van to the cluster whose shelter is nearest to the van's
 * current position -- the same nearest-shelter idea Phase 1 uses for
 * static cells (spatial-clustering.ts's clusterByNearestShelter),
 * applied here to mobile vans instead. Stateless by design: call again
 * whenever van positions change (e.g. each replanning tick) rather than
 * trying to track reassignment history -- a van's nearest shelter simply
 * recomputes fresh each time.
 */
export function assignVansToClusters(vans: VanPosition[], clusters: GraphCluster[]): Map<string, VanPosition[]> {
  const byShelterId = new Map<string, VanPosition[]>();
  for (const cluster of clusters) byShelterId.set(cluster.shelterId, []);

  for (const van of vans) {
    let bestShelterId: string | undefined;
    let bestDist = Infinity;

    for (const cluster of clusters) {
      const shelter = cluster.graph.nodesById.get(cluster.shelterId);
      if (!shelter) continue;
      const d = planeDistanceKm([van.x, van.y], [shelter.x, shelter.y]);
      if (d < bestDist) {
        bestDist = d;
        bestShelterId = cluster.shelterId;
      }
    }

    if (bestShelterId) byShelterId.get(bestShelterId)!.push(van);
  }

  return byShelterId;
}

/**
 * Phase B: a genuinely fleet-wide assignment -- the real gap
 * assignVansToClusters() above has. Nearest-shelter assignment never
 * weighs how much pending work a zone actually has, so a van can sit on
 * a zone with nothing left to do while a neighboring zone with a much
 * higher-value backlog gets no extra help. This considers EVERY van
 * against EVERY shelter it can feasibly reach (not just the nearest),
 * and resolves contention with a global greedy construction: repeatedly
 * assign the single best remaining (van, shelter) pair by marginal
 * value, where a shelter's value is divided by how many vans are
 * already committed to it (so the greedy construction naturally spreads
 * vans across high-value zones instead of stacking them on one).
 *
 * Feasibility here is a coarse round-trip travel-time estimate (plane
 * distance at AVG_TRAVEL_SPEED_KMH) -- a necessary-but-not-sufficient
 * gate, the real per-village feasibility (time windows, capacity) is
 * still enforced downstream by feasibility.ts regardless of which
 * shelter a van ends up assigned to. A van with no feasible shelter at
 * all (budget too small for even its own nearest one) falls back to
 * its nearest shelter anyway, same as assignVansToClusters(), so no van
 * is ever left completely unassigned.
 */
export function assignVansToClustersByReward(
  vans: VanPosition[],
  clusters: GraphCluster[],
  clusterPendingReward: ReadonlyMap<string, number>,
  vanRemainingMinutes: ReadonlyMap<number, number>,
): Map<string, VanPosition[]> {
  const byShelterId = new Map<string, VanPosition[]>();
  for (const cluster of clusters) byShelterId.set(cluster.shelterId, []);
  if (vans.length === 0) return byShelterId;

  interface Candidate {
    vanId: number;
    shelterId: string;
    travelMinutes: number;
  }
  const candidates: Candidate[] = [];
  const nearestFallback = new Map<number, string>();

  for (const van of vans) {
    let bestShelterId: string | undefined;
    let bestTravelMinutes = Infinity;

    for (const cluster of clusters) {
      const shelter = cluster.graph.nodesById.get(cluster.shelterId);
      if (!shelter) continue;
      const distKm = planeDistanceKm([van.x, van.y], [shelter.x, shelter.y]);
      const travelMinutes = (distKm / AVG_TRAVEL_SPEED_KMH) * 60;
      if (travelMinutes < bestTravelMinutes) {
        bestTravelMinutes = travelMinutes;
        bestShelterId = cluster.shelterId;
      }

      const remaining = vanRemainingMinutes.get(van.vanId) ?? Infinity;
      if (travelMinutes * 2 <= remaining) {
        candidates.push({ vanId: van.vanId, shelterId: cluster.shelterId, travelMinutes });
      }
    }

    if (bestShelterId) nearestFallback.set(van.vanId, bestShelterId);
  }

  const shelterLoad = new Map<string, number>();
  const assignedVanIds = new Set<number>();
  let remaining = candidates;

  while (assignedVanIds.size < vans.length && remaining.length > 0) {
    let best: Candidate | null = null;
    let bestScore = -Infinity;

    for (const c of remaining) {
      if (assignedVanIds.has(c.vanId)) continue;
      const reward = clusterPendingReward.get(c.shelterId) ?? 0;
      const load = shelterLoad.get(c.shelterId) ?? 0;
      // Marginal value: this zone's pending reward, diluted by vans
      // already committed to it, discounted by how long it takes THIS
      // van to get there -- a van minutes away from a rich zone can
      // still lose to one already sitting on it.
      const score = reward / (1 + load) / (1 + c.travelMinutes / 30);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    if (!best) break;
    byShelterId.get(best.shelterId)!.push(vans.find((v) => v.vanId === best!.vanId)!);
    shelterLoad.set(best.shelterId, (shelterLoad.get(best.shelterId) ?? 0) + 1);
    assignedVanIds.add(best.vanId);
    remaining = remaining.filter((c) => c.vanId !== best!.vanId);
  }

  // Fallback for any van with no feasible candidate at all.
  for (const van of vans) {
    if (assignedVanIds.has(van.vanId)) continue;
    const fallbackShelterId = nearestFallback.get(van.vanId);
    if (fallbackShelterId) byShelterId.get(fallbackShelterId)!.push(van);
  }

  return byShelterId;
}

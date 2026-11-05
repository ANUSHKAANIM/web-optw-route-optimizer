import type { GraphCluster } from "@/graph/spatial-clustering";
import type { ClusterTeam } from "./cluster-router";

/**
 * Determines the order routeCluster's non-joint tiers (neural/greedy)
 * should process a cluster's teams in, so a van actually CLOSEST to the
 * cluster's highest-priority cell gets first claim on it -- rather than
 * whichever team happens to appear first in the input array, which is
 * what the existing sequential `alreadyVisited` exclusion in
 * cluster-router.ts would otherwise silently favor. This is the "first
 * van to the same cell wins, not first-come-first-claimed" fix the
 * project's own rl/README.md flagged as a real gap in the decomposition
 * approach.
 *
 * Technique: a greedy bipartite assignment -- repeatedly take the
 * highest-priority still-unclaimed origin, give it to whichever
 * not-yet-ordered team has the shortest travel time to it (bounded by
 * that team's remaining budget), and put that team next in the
 * processing order. Loosely inspired by the bounded-quality greedy
 * allocation idea in Jorgensen et al.'s Team Surviving Orienteers --
 * much simplified: no survival probabilities, no submodularity
 * approximation proof, just "closest feasible van to the most valuable
 * remaining cell wins first pick."
 *
 * Only relevant for the neural/greedy tiers -- the exact MILP tier
 * already coordinates every team jointly in one model and doesn't use
 * this ordering at all.
 */
export function resolveTeamProcessingOrder(
  cluster: GraphCluster,
  teams: ClusterTeam[],
  priorities: ReadonlyMap<string, number>,
): ClusterTeam[] {
  const origins = cluster.graph.nodes
    .filter((n) => n.role === "origin")
    .map((n) => ({ id: n.id, priority: priorities.get(n.id) ?? 0 }))
    .filter((o) => o.priority > 0)
    .sort((a, b) => b.priority - a.priority);

  const teamById = new Map(teams.map((t) => [t.teamId, t]));
  const unordered = new Set(teamById.keys());
  const ordered: ClusterTeam[] = [];

  for (const origin of origins) {
    if (unordered.size === 0) break;

    let bestTeamId: number | null = null;
    let bestTravel = Infinity;
    for (const teamId of unordered) {
      const team = teamById.get(teamId)!;
      const travel = cluster.graph.travelTimeMinutes.get(team.currentNodeId)?.get(origin.id) ?? Infinity;
      if (travel <= team.remainingMinutes && travel < bestTravel) {
        bestTravel = travel;
        bestTeamId = teamId;
      }
    }

    if (bestTeamId !== null) {
      ordered.push(teamById.get(bestTeamId)!);
      unordered.delete(bestTeamId);
    }
  }

  // Any team never matched to a "first claim" cell (more teams than
  // contested high-value cells, or none reachable) keeps the input's
  // original relative order, appended last.
  for (const team of teams) {
    if (unordered.has(team.teamId)) {
      ordered.push(team);
      unordered.delete(team.teamId);
    }
  }

  return ordered;
}

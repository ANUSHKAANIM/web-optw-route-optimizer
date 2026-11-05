import type { Graph, GraphNode } from "@/types/graph";
import { planeDistanceKm } from "./plane-distance";
import { buildGraph } from "./build-graph";

/**
 * Scale substrate for Phase 1: bounds the O(N^2) dense distance matrix and
 * O(N*k) visual k-NN graph in build-graph.ts, both of which are only
 * viable at the ~13-node prototype scale, not at 20,000 nodes.
 *
 * Rather than building a literal global k-nearest-neighbor candidate graph
 * (which needs a spatial index like a k-d tree to stay sub-O(N^2) itself),
 * this partitions the map by nearest-shelter catchment: every origin joins
 * the cluster of the shelter it's physically closest to. Each cluster then
 * gets its own small, fully-dense Graph via the existing buildGraph() --
 * unmodified -- so a van only ever reasons about the handful of nodes in
 * its own region, not all 20,000.
 *
 * This is a simplification of "k-NN sparsify, then cluster" into one step,
 * chosen because shelters are already natural cluster anchors in a
 * disaster-evacuation scenario -- not drawn from any of the reviewed
 * papers. Total work is O(N*S) for the assignment (S = shelter count,
 * small) plus O(sum of clusterSize^2) for the per-cluster dense matrices,
 * which collapses to roughly O(N * avgClusterSize) when shelters are
 * reasonably evenly spread -- the same complexity class the roadmap's
 * O(N*k) target describes, achieved by a different mechanism.
 */
export interface GraphCluster {
  shelterId: string;
  graph: Graph;
}

/** Groups every origin into the cluster of its nearest shelter. Shelters
 * with no nearby origins still get their own single-node cluster. */
export function clusterByNearestShelter(nodes: GraphNode[]): Map<string, GraphNode[]> {
  const shelters = nodes.filter((n) => n.role === "shelter");
  if (shelters.length === 0) {
    throw new Error("clusterByNearestShelter requires at least one shelter node.");
  }

  const clusters = new Map<string, GraphNode[]>();
  for (const shelter of shelters) clusters.set(shelter.id, [shelter]);

  for (const node of nodes) {
    if (node.role !== "origin") continue;

    let bestShelterId = shelters[0].id;
    let bestDist = Infinity;
    for (const shelter of shelters) {
      const d = planeDistanceKm([node.x, node.y], [shelter.x, shelter.y]);
      if (d < bestDist) {
        bestDist = d;
        bestShelterId = shelter.id;
      }
    }
    clusters.get(bestShelterId)!.push(node);
  }

  return clusters;
}

/** Builds a fully independent, dense Graph (nodes + visual k-NN edges +
 * point-to-point travel matrix) for every nearest-shelter cluster. Each
 * resulting Graph is sized to its cluster, not the full node set -- this
 * is what makes per-cluster MILP/beam-search solving tractable at 20,000
 * total nodes. */
export function buildClusteredGraph(nodes: GraphNode[]): GraphCluster[] {
  const clusters = clusterByNearestShelter(nodes);
  return Array.from(clusters.entries()).map(([shelterId, clusterNodes]) => ({
    shelterId,
    graph: buildGraph(clusterNodes),
  }));
}

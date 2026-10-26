import type { Edge, Graph, GraphNode } from "@/types/graph";
import { planeDistanceKm } from "./plane-distance";

/** Assumed average point-to-point travel speed for the road network. Turns
 * plane distance into a travel-time estimate. Congested/urban evacuation
 * routes are typically slower than highway speed, hence the conservative
 * default; override per-scenario once real road data exists. */
export const AVG_TRAVEL_SPEED_KMH = 22;

/** Nearest neighbors considered per node when building the sparse "visual"
 * graph used for map rendering. The optimizer always reasons about the
 * dense point-to-point travel time matrix below -- this sparser structure
 * is not a routing constraint, only a legible "which places are nearby"
 * rendering of the graph. */
const VISUAL_GRAPH_K = 3;

class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/** Builds a sparse, connected "visual" graph: each node links to its k
 * nearest neighbors by real distance, then any disconnected components are
 * stitched together by the single cheapest bridging edge (Kruskal-style
 * repair), so the graph is guaranteed connected without becoming a dense
 * mesh. */
export function buildVisualEdges(nodes: GraphNode[]): Edge[] {
  const n = nodes.length;
  const coords: [number, number][] = nodes.map((node) => [node.x, node.y]);
  const edgeMap = new Map<string, Edge>();

  const addEdge = (i: number, j: number, distanceKm: number) => {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (!edgeMap.has(key)) {
      edgeMap.set(key, {
        from: nodes[Math.min(i, j)].id,
        to: nodes[Math.max(i, j)].id,
        distanceKm,
        travelTimeMinutes: (distanceKm / AVG_TRAVEL_SPEED_KMH) * 60,
      });
    }
  };

  for (let i = 0; i < n; i++) {
    const distances = coords
      .map((c, j) => (j === i ? null : { j, km: planeDistanceKm(coords[i], c) }))
      .filter((d): d is { j: number; km: number } => d !== null)
      .sort((a, b) => a.km - b.km)
      .slice(0, VISUAL_GRAPH_K);
    for (const d of distances) addEdge(i, d.j, d.km);
  }

  const uf = new UnionFind(n);
  for (const edge of edgeMap.values()) {
    uf.union(nodes.findIndex((x) => x.id === edge.from), nodes.findIndex((x) => x.id === edge.to));
  }

  const componentCount = () => new Set(Array.from({ length: n }, (_, i) => uf.find(i))).size;

  while (componentCount() > 1) {
    const roots = Array.from(new Set(Array.from({ length: n }, (_, i) => uf.find(i))));
    let best: { i: number; j: number; km: number } | null = null;

    for (let a = 0; a < roots.length; a++) {
      for (let b = a + 1; b < roots.length; b++) {
        for (let i = 0; i < n; i++) {
          if (uf.find(i) !== roots[a]) continue;
          for (let j = 0; j < n; j++) {
            if (uf.find(j) !== roots[b]) continue;
            const km = planeDistanceKm(coords[i], coords[j]);
            if (!best || km < best.km) best = { i, j, km };
          }
        }
      }
    }

    if (!best) break;
    addEdge(best.i, best.j, best.km);
    uf.union(best.i, best.j);
  }

  return Array.from(edgeMap.values());
}

export function assertConnected(nodes: GraphNode[], edges: Edge[]): void {
  const index = new Map(nodes.map((n, i) => [n.id, i]));
  const uf = new UnionFind(nodes.length);
  for (const e of edges) {
    const i = index.get(e.from);
    const j = index.get(e.to);
    if (i !== undefined && j !== undefined) uf.union(i, j);
  }
  const roots = new Set(Array.from({ length: nodes.length }, (_, i) => uf.find(i)));
  if (roots.size > 1) {
    throw new Error(`Graph is not connected: ${roots.size} components for ${nodes.length} nodes.`);
  }
}

/** Assembles the full Graph: nodes, the sparse visual edge set (guaranteed
 * connected), and the dense point-to-point travel-time matrix the
 * optimizer actually uses. */
export function buildGraph(nodes: GraphNode[]): Graph {
  const edges = buildVisualEdges(nodes);
  assertConnected(nodes, edges);

  const travelTimeMinutes = new Map<string, Map<string, number>>();
  const distanceKm = new Map<string, Map<string, number>>();
  for (const from of nodes) {
    const timeRow = new Map<string, number>();
    const distRow = new Map<string, number>();
    for (const to of nodes) {
      const km =
        from.id === to.id ? 0 : planeDistanceKm([from.x, from.y], [to.x, to.y]);
      distRow.set(to.id, km);
      timeRow.set(to.id, (km / AVG_TRAVEL_SPEED_KMH) * 60);
    }
    travelTimeMinutes.set(from.id, timeRow);
    distanceKm.set(from.id, distRow);
  }

  return {
    nodes,
    nodesById: new Map(nodes.map((n) => [n.id, n])),
    edges,
    travelTimeMinutes,
    distanceKm,
  };
}

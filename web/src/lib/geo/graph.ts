import { haversineKm } from "@/lib/geo/haversine";

/** Assumed average point-to-point travel speed in Delhi traffic (road distance
 * and congestion both push effective speed well below highway speed). Used to
 * turn great-circle distance into a travel-time estimate. */
export const AVG_TRAVEL_SPEED_KMH = 22;

/** Nearest neighbors considered per node when building the *visual* road-like
 * graph shown on the map. The optimizer itself always uses the full
 * point-to-point distance matrix below -- this sparse graph is purely a
 * legible rendering of "nearby / connected" places, not a routing constraint. */
const VISUAL_GRAPH_K = 4;

export interface GeoEdge {
  from: number;
  to: number;
  distanceKm: number;
}

/** Dense pairwise travel-time matrix (hours) from Haversine distance. */
export function buildTravelTimeMatrix(coords: [number, number][]): number[][] {
  const n = coords.length;
  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const km = haversineKm(coords[i], coords[j]);
      const hours = km / AVG_TRAVEL_SPEED_KMH;
      matrix[i][j] = hours;
      matrix[j][i] = hours;
    }
  }
  return matrix;
}

/**
 * Builds a sparse, connected "visual" graph for map rendering: each node
 * links to its k nearest neighbors by real distance, then any disconnected
 * components are stitched together by adding the single cheapest edge
 * bridging them (Kruskal-style repair) so the graph is guaranteed connected
 * without becoming a dense mesh.
 */
export function buildVisualGraph(coords: [number, number][]): GeoEdge[] {
  const n = coords.length;
  const edgeSet = new Map<string, GeoEdge>();

  const addEdge = (i: number, j: number, distanceKm: number) => {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (!edgeSet.has(key)) {
      edgeSet.set(key, { from: Math.min(i, j), to: Math.max(i, j), distanceKm });
    }
  };

  for (let i = 0; i < n; i++) {
    const distances = coords
      .map((c, j) => (j === i ? null : { j, km: haversineKm(coords[i], c) }))
      .filter((d): d is { j: number; km: number } => d !== null)
      .sort((a, b) => a.km - b.km)
      .slice(0, VISUAL_GRAPH_K);
    for (const d of distances) addEdge(i, d.j, d.km);
  }

  const uf = new UnionFind(n);
  for (const edge of edgeSet.values()) uf.union(edge.from, edge.to);

  const componentsRemaining = () => new Set(Array.from({ length: n }, (_, i) => uf.find(i))).size;

  while (componentsRemaining() > 1) {
    let bestEdge: GeoEdge | null = null;
    const roots = new Set(Array.from({ length: n }, (_, i) => uf.find(i)));
    const rootList = Array.from(roots);

    for (let a = 0; a < rootList.length; a++) {
      for (let b = a + 1; b < rootList.length; b++) {
        for (let i = 0; i < n; i++) {
          if (uf.find(i) !== rootList[a]) continue;
          for (let j = 0; j < n; j++) {
            if (uf.find(j) !== rootList[b]) continue;
            const km = haversineKm(coords[i], coords[j]);
            if (!bestEdge || km < bestEdge.distanceKm) {
              bestEdge = { from: Math.min(i, j), to: Math.max(i, j), distanceKm: km };
            }
          }
        }
      }
    }

    if (!bestEdge) break;
    addEdge(bestEdge.from, bestEdge.to, bestEdge.distanceKm);
    uf.union(bestEdge.from, bestEdge.to);
  }

  return Array.from(edgeSet.values());
}

/** Throws if the visual graph does not connect every node -- a correctness
 * guard for the connectivity-repair loop above, cheap to check once at
 * dataset-load time. */
export function assertConnected(n: number, edges: GeoEdge[]): void {
  const uf = new UnionFind(n);
  for (const e of edges) uf.union(e.from, e.to);
  const roots = new Set(Array.from({ length: n }, (_, i) => uf.find(i)));
  if (roots.size > 1) {
    throw new Error(`Delhi places graph is not connected: ${roots.size} components for ${n} nodes.`);
  }
}

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

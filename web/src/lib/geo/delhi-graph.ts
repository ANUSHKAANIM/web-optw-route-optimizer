import { orderedGeoPlaces } from "@/lib/env/geo-environment";
import { assertConnected, buildVisualGraph, type GeoEdge } from "@/lib/geo/graph";
import type { DelhiPlace } from "@/data/delhi-places";

interface DelhiVisualGraph {
  places: DelhiPlace[];
  edges: GeoEdge[];
}

let cached: DelhiVisualGraph | null = null;

/** The depot-first place ordering plus a connectivity-guaranteed sparse
 * "visual" graph for map rendering. Computed once and memoized -- the
 * dataset is static, so there's no reason to rebuild the k-NN graph on
 * every request. */
export function getDelhiVisualGraph(): DelhiVisualGraph {
  if (cached) return cached;
  const places = orderedGeoPlaces();
  const coords: [number, number][] = places.map((p) => [p.latitude, p.longitude]);
  const edges = buildVisualGraph(coords);
  assertConnected(places.length, edges);
  cached = { places, edges };
  return cached;
}

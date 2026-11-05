import type { GraphNode } from "@/types/graph";

/**
 * The cell-data seam: every downstream module (graph construction, solver,
 * UI) consumes `GraphNode[]` and never cares how it was produced. Today
 * there are two implementations -- the small hand-authored scenario
 * (evacuation-nodes.ts) and the synthetic ~20,000-cell generator
 * (synthetic-cell-provider.ts). A future real geographic data source (e.g.
 * actual coastal village/district boundaries) implements this same
 * interface -- no other layer changes. Same seam pattern as
 * RiskPriorityProvider in rewards/reward-provider.ts.
 */
export interface CellProvider {
  getNodes(): GraphNode[];
}

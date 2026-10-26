import type { GraphNode } from "@/types/graph";

/** Short "N1", "N2", ... labels for every non-depot node, in dataset
 * order -- a shared, purely-display numbering so the map and any text
 * list (route stops, priorities, etc.) use the identical label for the
 * same node. Never used as an id anywhere else. */
export function buildNodeLabels(nodes: GraphNode[], depotNodeId: string): Map<string, string> {
  const labels = new Map<string, string>();
  let n = 0;
  for (const node of nodes) {
    if (node.id === depotNodeId) continue;
    n += 1;
    labels.set(node.id, `N${n}`);
  }
  return labels;
}

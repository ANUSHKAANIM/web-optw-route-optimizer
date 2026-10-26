import { EVACUATION_NODES } from "@/data/evacuation-nodes";
import { buildGraph } from "@/graph/build-graph";

export class UnknownNodeError extends Error {
  constructor(nodeId: string) {
    super(`Unknown node: ${nodeId}`);
  }
}

/** Built once per server process -- the graph is a pure function of the
 * static dataset, no reason to rebuild it per request. */
export const evacuationGraph = buildGraph(EVACUATION_NODES);

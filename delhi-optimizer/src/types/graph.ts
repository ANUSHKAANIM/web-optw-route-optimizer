/** Domain types for the evacuation graph. Deliberately free of any
 * region-specific assumptions beyond the shape itself -- a future
 * 2,000-node real evacuation graph is the same shape, just bigger and fed
 * by a different data source.
 *
 * Node positions are a synthetic (x, y) plane, NOT real-world latitude/
 * longitude -- this is an abstract disaster-area simulation, not a map of
 * any real place. See src/data/evacuation-nodes.ts. */

export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface DayHours {
  open: string; // "HH:MM", 24h, local time
  close: string; // "HH:MM"
  closed?: boolean;
}

/** An "accessibility window" -- when this node can actually be reached and
 * serviced (e.g. a shelter's staffed hours, or the window before a road is
 * expected to flood). Mechanically identical to an opening-hours table;
 * the feasibility engine doesn't care which real-world constraint it
 * represents. */
export type OpeningHours = Record<Weekday, DayHours>;

export type NodeRole = "origin" | "shelter";

export interface GraphNode {
  id: string;
  name: string;
  /** Position in the abstract disaster-area plane (kilometers), not a
   * real-world coordinate. */
  x: number;
  y: number;
  role: NodeRole;
  /** Estimated population needing evacuation from this node. 0 for shelters. */
  demand: number;
  /** Maximum evacuees this node can receive. 0 for origins. */
  capacity: number;
  openingHours: OpeningHours;
  /** Time to load/unload evacuees at this stop. */
  serviceDurationMinutes: number;
}

export interface Edge {
  from: string;
  to: string;
  distanceKm: number;
  travelTimeMinutes: number;
}

/** A node's connections, precomputed for fast lookup by the graph engine. */
export interface Graph {
  nodes: GraphNode[];
  nodesById: Map<string, GraphNode>;
  edges: Edge[];
  /** Dense point-to-point travel time (minutes) -- the optimizer always
   * reasons about direct travel between any two nodes (an orienteering-
   * style problem, not a fixed-road-network routing problem); `edges`
   * above is a separate, sparser structure used only for map rendering. */
  travelTimeMinutes: Map<string, Map<string, number>>;
  /** Dense point-to-point great-circle distance (km), same indexing as
   * travelTimeMinutes -- kept alongside it so route statistics can report
   * real total distance, not just time. */
  distanceKm: Map<string, Map<string, number>>;
}

import { planeDistanceKm } from "@/graph/plane-distance";

/**
 * A van's route as a timeline in STORM minutes since the route was
 * planned: start position (t = 0), each stop (arrive -> depart), then the
 * drop-off shelter (arrive). Shared by the server (where is each van when
 * the next forecast lands, 6 h later?) and the client animation (where is
 * it right now?), so the two can never disagree.
 */
export interface Waypoint {
  x: number;
  y: number;
  arriveMinutes: number;
  departMinutes: number;
}

/** Distance (km along the path) covered by storm minute t. Waits at a
 * stop hold the van in place; travel between waypoints is linear. */
export function distanceAtMinute(waypoints: Waypoint[], t: number): number {
  let cum = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    const legKm = planeDistanceKm([a.x, a.y], [b.x, b.y]);
    if (t <= a.departMinutes) return cum;
    if (t < b.arriveMinutes) {
      const span = b.arriveMinutes - a.departMinutes;
      const f = span > 0 ? (t - a.departMinutes) / span : 1;
      return cum + legKm * Math.max(0, Math.min(1, f));
    }
    cum += legKm;
  }
  return cum;
}

/** (x, y) of the van at storm minute t. */
export function positionAtMinute(waypoints: Waypoint[], t: number): { x: number; y: number } {
  if (waypoints.length === 0) return { x: 0, y: 0 };
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i];
    const b = waypoints[i + 1];
    if (t <= a.departMinutes) return { x: a.x, y: a.y };
    if (t < b.arriveMinutes) {
      const span = b.arriveMinutes - a.departMinutes;
      const f = span > 0 ? (t - a.departMinutes) / span : 1;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
  }
  const last = waypoints[waypoints.length - 1];
  return { x: last.x, y: last.y };
}

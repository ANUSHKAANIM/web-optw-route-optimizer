/** Euclidean distance (kilometers) between two points in the abstract
 * disaster-area plane. This project has no real-world geography -- every
 * node position is a synthetic (x, y) coordinate in a flat simulation
 * plane, not a latitude/longitude pair, so a plain distance formula is the
 * correct one (no great-circle correction needed). */
export function planeDistanceKm([x1, y1]: [number, number], [x2, y2]: [number, number]): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function isValidCoordinate([x, y]: [number, number]): boolean {
  return Number.isFinite(x) && Number.isFinite(y);
}

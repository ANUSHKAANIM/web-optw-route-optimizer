import { OptwEnvironment, type OptwConfig } from "@/lib/env/optw-environment";
import { DELHI_PLACES, type DayHours, type DelhiPlace } from "@/data/delhi-places";
import { buildTravelTimeMatrix } from "@/lib/geo/graph";
import { computeDynamicRewards, rewardIntervalIndex } from "@/lib/env/dynamic-rewards";
import { istHourOfDay, istWeekday } from "@/lib/time/ist-clock";

/**
 * Builds a real-geography OPTW environment over the ~80 Delhi tourist places,
 * reusing OptwEnvironment's algorithm untouched (admissibility, adjacency,
 * decay, step). Only the *inputs* differ from the synthetic single-player
 * mode: real Haversine-derived travel times, real per-weekday opening hours,
 * and rewards recomputed on the fly from the session's shared dynamic-reward
 * schedule instead of being fixed at reset().
 */

export const DEPOT_PLACE_ID = "india_gate";

export interface GeoSessionParams {
  seed: number;
  startedAt: Date;
  maxTime: number; // hours available for the whole session
  rewardDecayMin: number;
  rewardIntervalSeconds: number;
}

/** Depot-first ordering of the dataset: OptwEnvironment always starts/ends
 * its route at node 0, so the chosen depot place is moved there once and
 * every session/player state (paths, node indices) is expressed against
 * this same ordering. */
export function orderedGeoPlaces(): DelhiPlace[] {
  const depotIndex = DELHI_PLACES.findIndex((p) => p.id === DEPOT_PLACE_ID);
  if (depotIndex === -1) {
    throw new Error(`Depot place "${DEPOT_PLACE_ID}" was not found in the Delhi places dataset.`);
  }
  return [DELHI_PLACES[depotIndex], ...DELHI_PLACES.filter((_, i) => i !== depotIndex)];
}

function timeToHours(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h + m / 60;
}

/** Opening/closing time as hours-relative-to-session-start, for the actual
 * IST calendar day the session started on. A place that's closed all day, or
 * already closed before the session even starts, gets a degenerate window
 * (-1, -1): since `startVisit >= 0` can never be `<= -1`, the existing
 * admissibility check permanently excludes it -- no special-casing needed. */
function computeRelativeWindow(
  hours: DayHours | undefined,
  startedAt: Date,
): { openingTime: number; closingTime: number } {
  if (!hours || hours.closed) return { openingTime: -1, closingTime: -1 };

  const startHourOfDay = istHourOfDay(startedAt);
  const openingTime = timeToHours(hours.open) - startHourOfDay;
  const closingTime = timeToHours(hours.close) - startHourOfDay;
  if (closingTime <= 0) return { openingTime: -1, closingTime: -1 };
  return { openingTime: Math.max(openingTime, 0), closingTime };
}

export function createGeoEnvironment(params: GeoSessionParams): OptwEnvironment {
  const places = orderedGeoPlaces();
  const coords: [number, number][] = places.map((p) => [p.latitude, p.longitude]);
  const distMatrix = buildTravelTimeMatrix(coords);

  const weekday = istWeekday(params.startedAt);
  const windows = places.map((p) => computeRelativeWindow(p.openingHours[weekday], params.startedAt));

  const openingTimes = windows.map((w) => w.openingTime);
  const closingTimes = windows.map((w) => w.closingTime);
  const durations = places.map((p) => p.visitDurationMinutes / 60);

  const baseRewards = places.map((p) => p.baseReward);
  const rewards = computeDynamicRewards(baseRewards, params.seed, rewardIntervalIndex(0, params.rewardIntervalSeconds));
  rewards[0] = 0;

  const config: OptwConfig = {
    numNodes: places.length,
    maxTime: params.maxTime,
    rewardDecayMin: params.rewardDecayMin,
    enableForecastEvents: false,
    hazardRadius: 0,
    forecastUpdateInterval: 0,
    forecastNoise: 0,
    forecastTrackWaypoints: 0,
    seed: params.seed,
  };

  const env = Object.create(OptwEnvironment.prototype) as OptwEnvironment;
  env.config = config;
  env.coords = coords;
  env.distMatrix = distMatrix;
  env.openingTimes = openingTimes;
  env.durations = durations;
  env.closingTimes = closingTimes;
  env.rewards = rewards;
  env.sMax = Math.max(Math.max(...rewards), 1) * 1.1;
  env.currentNode = 0;
  env.currentTime = 0;
  env.visited = new Array(places.length).fill(false);
  env.visited[0] = true;
  env.lastStepForecastUpdated = false;
  env.trackTimes = [];
  env.trackPositions = [];
  env.lastForecastUpdateTime = 0;

  return env;
}

/** Recomputes `env.rewards` / `env.sMax` in place for whichever reward
 * interval contains `nowSecondsSinceStart`, mutating the environment the
 * same way the existing hazard-forecast mode already mutates rewards
 * mid-session. Call this before every read (recommend/step/state query) so
 * each request reflects the current session-wide shared reward snapshot. */
export function refreshDynamicRewards(
  env: OptwEnvironment,
  seed: number,
  nowSecondsSinceStart: number,
  intervalSeconds: number,
): void {
  const places = orderedGeoPlaces();
  const baseRewards = places.map((p) => p.baseReward);
  const intervalIndex = rewardIntervalIndex(nowSecondsSinceStart, intervalSeconds);
  const rewards = computeDynamicRewards(baseRewards, seed, intervalIndex);
  rewards[0] = 0;
  env.rewards = rewards;
  env.sMax = Math.max(Math.max(...rewards), 1) * 1.1;
}

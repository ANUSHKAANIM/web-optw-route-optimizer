import { OptwEnvironment, type OptwConfig } from "@/lib/env/optw-environment";

/** Plain-JSON snapshot of an OptwEnvironment, for persistence between
 * stateless serverless invocations (stored on the `runs` row). */
export interface OptwEnvironmentSnapshot {
  config: OptwConfig;
  coords: [number, number][];
  distMatrix: number[][];
  openingTimes: number[];
  durations: number[];
  closingTimes: number[];
  rewards: number[];
  sMax: number;
  currentNode: number;
  currentTime: number;
  visited: boolean[];
  trackTimes: number[];
  trackPositions: [number, number][];
  lastForecastUpdateTime: number;
}

export function snapshotEnvironment(env: OptwEnvironment): OptwEnvironmentSnapshot {
  return {
    config: env.config,
    coords: env.coords,
    distMatrix: env.distMatrix,
    openingTimes: env.openingTimes,
    durations: env.durations,
    closingTimes: env.closingTimes,
    rewards: env.rewards,
    sMax: env.sMax,
    currentNode: env.currentNode,
    currentTime: env.currentTime,
    visited: env.visited,
    trackTimes: env.trackTimes,
    trackPositions: env.trackPositions,
    lastForecastUpdateTime: env.lastForecastUpdateTime,
  };
}

export function restoreEnvironment(snapshot: OptwEnvironmentSnapshot): OptwEnvironment {
  const env = Object.create(OptwEnvironment.prototype) as OptwEnvironment;
  env.config = snapshot.config;
  env.coords = snapshot.coords;
  env.distMatrix = snapshot.distMatrix;
  env.openingTimes = snapshot.openingTimes;
  env.durations = snapshot.durations;
  env.closingTimes = snapshot.closingTimes;
  env.rewards = snapshot.rewards;
  env.sMax = snapshot.sMax;
  env.currentNode = snapshot.currentNode;
  env.currentTime = snapshot.currentTime;
  env.visited = snapshot.visited;
  env.trackTimes = snapshot.trackTimes;
  env.trackPositions = snapshot.trackPositions;
  env.lastForecastUpdateTime = snapshot.lastForecastUpdateTime;
  env.lastStepForecastUpdated = false;
  return env;
}

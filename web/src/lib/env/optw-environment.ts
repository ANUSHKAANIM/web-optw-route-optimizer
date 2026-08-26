import { SeededRandom } from "./rng";

/**
 * TypeScript port of the Python `OPTWEnvironment` (env.py). Faithful,
 * single-instance (batch_size=1) re-implementation of the reward/time-window
 * simulation so the web app can run inference without a Python runtime.
 *
 * Kept numerically equivalent to env.py: same feature layout, same
 * time-decay formula, same admissibility/adjacency feasibility rules, same
 * optional hazard/forecast dynamics.
 */

export interface OptwConfig {
  numNodes: number;
  maxTime: number;
  /** Fraction of a node's base reward still paid out if visited at t=maxTime. */
  rewardDecayMin: number;
  enableForecastEvents: boolean;
  hazardRadius: number;
  forecastUpdateInterval: number;
  forecastNoise: number;
  forecastTrackWaypoints: number;
  seed: number;
}

export interface OptwState {
  /** (numNodes, 7) */
  staticFeats: number[][];
  /** (numNodes, 9) */
  dynamicFeats: number[][];
}

export const DEFAULT_OPTW_CONFIG: Omit<OptwConfig, "seed"> = {
  numNodes: 30,
  maxTime: 24.0,
  rewardDecayMin: 0.3,
  enableForecastEvents: false,
  hazardRadius: 0.4,
  forecastUpdateInterval: 4.0,
  forecastNoise: 0.12,
  forecastTrackWaypoints: 5,
};

export class OptwEnvironment {
  config: OptwConfig;

  coords: [number, number][] = [];
  distMatrix: number[][] = [];
  openingTimes: number[] = [];
  durations: number[] = [];
  closingTimes: number[] = [];
  rewards: number[] = [];
  sMax = 1;

  currentNode = 0;
  currentTime = 0;
  visited: boolean[] = [];
  lastStepForecastUpdated = false;

  trackTimes: number[] = [];
  trackPositions: [number, number][] = [];
  lastForecastUpdateTime = 0;
  private rng: SeededRandom;

  constructor(config: OptwConfig) {
    this.config = config;
    this.rng = new SeededRandom(config.seed);
    this.reset();
  }

  private get n() {
    return this.config.numNodes;
  }

  reset() {
    const n = this.n;
    this.coords = Array.from({ length: n }, () => [
      this.rng.uniform(-1, 1),
      this.rng.uniform(-1, 1),
    ] as [number, number]);

    this.distMatrix = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => euclidean(this.coords[i], this.coords[j])),
    );

    this.openingTimes = new Array(n).fill(0);
    this.durations = new Array(n).fill(0.5);

    if (this.config.enableForecastEvents) {
      const { forecastTrackWaypoints, maxTime } = this.config;
      this.trackTimes = Array.from({ length: forecastTrackWaypoints }, (_, i) =>
        (i / (forecastTrackWaypoints - 1)) * maxTime,
      );
      const start: [number, number] = [this.rng.uniform(-1, 1), this.rng.uniform(-1, 1)];
      const end: [number, number] = [this.rng.uniform(-1, 1), this.rng.uniform(-1, 1)];
      this.trackPositions = this.trackTimes.map((t) => [
        start[0] + (end[0] - start[0]) * (t / maxTime),
        start[1] + (end[1] - start[1]) * (t / maxTime),
      ]);
      this.lastForecastUpdateTime = 0;
      this.closingTimes = new Array(n).fill(maxTime);
      this.rewards = new Array(n).fill(0);
      this.sMax = 1;
      this.recomputeHazardFields(true);
    } else {
      this.closingTimes = new Array(n).fill(this.config.maxTime);
      this.rewards = Array.from({ length: n }, () => this.rng.intInclusive(1, 9));
      this.rewards[0] = 0;
      this.sMax = Math.max(...this.rewards) * 1.1;
    }

    this.currentNode = 0;
    this.currentTime = 0;
    this.visited = new Array(n).fill(false);
    this.visited[0] = true;
    this.lastStepForecastUpdated = false;
  }

  /** Deep copy for beam-search branching (mirrors Python's copy.deepcopy(env)). */
  clone(): OptwEnvironment {
    const copy = Object.create(OptwEnvironment.prototype) as OptwEnvironment;
    copy.config = this.config;
    copy.coords = this.coords.map((c) => [...c] as [number, number]);
    copy.distMatrix = this.distMatrix.map((row) => [...row]);
    copy.openingTimes = [...this.openingTimes];
    copy.durations = [...this.durations];
    copy.closingTimes = [...this.closingTimes];
    copy.rewards = [...this.rewards];
    copy.sMax = this.sMax;
    copy.currentNode = this.currentNode;
    copy.currentTime = this.currentTime;
    copy.visited = [...this.visited];
    copy.lastStepForecastUpdated = this.lastStepForecastUpdated;
    copy.trackTimes = [...this.trackTimes];
    copy.trackPositions = this.trackPositions.map((p) => [...p] as [number, number]);
    copy.lastForecastUpdateTime = this.lastForecastUpdateTime;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- private field, deep-copy only
    (copy as any).rng = this.rng;
    return copy;
  }

  private hazardPositionAt(t: number): [number, number] {
    const clamped = Math.min(Math.max(t, 0), this.config.maxTime);
    let idx = this.trackTimes.findIndex((tt) => tt > clamped);
    if (idx === -1) idx = this.trackTimes.length - 1;
    idx = Math.min(Math.max(idx, 1), this.trackTimes.length - 1);
    const [t0, t1] = [this.trackTimes[idx - 1], this.trackTimes[idx]];
    const [p0, p1] = [this.trackPositions[idx - 1], this.trackPositions[idx]];
    const frac = (clamped - t0) / (t1 - t0 + 1e-8);
    return [p0[0] + (p1[0] - p0[0]) * frac, p0[1] + (p1[1] - p0[1]) * frac];
  }

  private recomputeHazardFields(isInitial = false) {
    const { hazardRadius, maxTime } = this.config;
    const n = this.n;
    const sampleCount = 200;

    const impactTime = new Array(n).fill(maxTime);
    const minDist = new Array(n).fill(Infinity);

    for (let s = 0; s < sampleCount; s++) {
      const t = (s / (sampleCount - 1)) * maxTime;
      const pos = this.hazardPositionAt(t);
      for (let node = 0; node < n; node++) {
        const d = euclidean(pos, this.coords[node]);
        if (d < minDist[node]) {
          minDist[node] = d;
          impactTime[node] = t;
        }
      }
    }

    const newRewards = new Array(n);
    const newClosing = new Array(n);
    for (let node = 0; node < n; node++) {
      const inDanger = minDist[node] < hazardRadius;
      const urgency = Math.max(0, 1 - minDist[node] / hazardRadius);
      newRewards[node] = inDanger ? 2.0 + 8.0 * urgency : 0.5;
      newClosing[node] = inDanger ? Math.max(impactTime[node] - 1.0, 0) : maxTime;
    }
    newRewards[0] = 0;

    if (isInitial) {
      this.rewards = newRewards;
      this.closingTimes = newClosing;
    } else {
      for (let node = 0; node < n; node++) {
        if (!this.visited[node]) {
          this.rewards[node] = newRewards[node];
          this.closingTimes[node] = newClosing[node];
        }
      }
    }
    this.sMax = Math.max(Math.max(...this.rewards), 1.0) * 1.1;
  }

  private maybeUpdateForecast(): boolean {
    if (!this.config.enableForecastEvents) return false;
    const now = this.currentTime;
    if (now - this.lastForecastUpdateTime < this.config.forecastUpdateInterval) return false;

    this.trackPositions = this.trackPositions.map((pos, i) => {
      if (this.trackTimes[i] <= now) return pos;
      return [
        pos[0] + this.rng.uniform(-1, 1) * this.config.forecastNoise,
        pos[1] + this.rng.uniform(-1, 1) * this.config.forecastNoise,
      ];
    });
    this.recomputeHazardFields(false);
    this.lastForecastUpdateTime = now;
    return true;
  }

  private decayFraction(t: number): number {
    const { rewardDecayMin, maxTime } = this.config;
    const frac = 1 - (1 - rewardDecayMin) * (t / maxTime);
    return Math.min(Math.max(frac, rewardDecayMin), 1.0);
  }

  /** Reward each node would actually pay out if visited next, right now. */
  getEffectiveRewards(): number[] {
    const travelTime = this.distMatrix[this.currentNode];
    return this.rewards.map((reward, node) => {
      const arrival = this.currentTime + travelTime[node];
      const wait = Math.max(this.openingTimes[node] - arrival, 0);
      const startVisit = arrival + wait;
      return reward * this.decayFraction(startVisit);
    });
  }

  getState(): OptwState {
    const n = this.n;
    const { maxTime } = this.config;
    const currT = this.currentTime;
    const travelTimes = this.distMatrix[this.currentNode];

    const staticFeats = Array.from({ length: n }, (_, i) => [
      this.coords[i][0],
      this.coords[i][1],
      this.durations[i] / maxTime,
      this.openingTimes[i] / maxTime,
      this.closingTimes[i] / maxTime,
      this.rewards[i] / this.sMax,
      1,
    ]);

    const dynamicFeats = Array.from({ length: n }, (_, i) => {
      const tAfterTravel = currT + travelTimes[i];
      return [
        (this.openingTimes[i] - currT) / maxTime,
        (this.closingTimes[i] - currT) / maxTime,
        currT / maxTime,
        (maxTime - currT) / maxTime,
        (this.openingTimes[i] - tAfterTravel) / maxTime,
        (this.closingTimes[i] - tAfterTravel) / maxTime,
        tAfterTravel / maxTime,
        (maxTime - tAfterTravel) / maxTime,
        (this.rewards[i] * this.decayFraction(tAfterTravel)) / this.sMax,
      ];
    });

    return { staticFeats, dynamicFeats };
  }

  getAdmissibilityMask(): boolean[] {
    const n = this.n;
    const travelTime = this.distMatrix[this.currentNode];
    const mask = new Array(n);
    for (let i = 0; i < n; i++) {
      const arrival = this.currentTime + travelTime[i];
      const wait = Math.max(this.openingTimes[i] - arrival, 0);
      const startVisit = arrival + wait;
      const timeBackHome = startVisit + this.durations[i] + this.distMatrix[i][0];
      const feasible =
        startVisit <= this.closingTimes[i] && timeBackHome <= this.config.maxTime;
      mask[i] = feasible && !this.visited[i];
    }
    return mask;
  }

  /** 1-step lookahead adjacency matrix (N, N). */
  getAdjacencyMatrix(): boolean[][] {
    const n = this.n;
    const currT = this.currentTime;
    const currNode = this.currentNode;
    const adj: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));

    for (let i = 0; i < n; i++) {
      if (this.visited[i] || i === currNode) continue;
      const distCurrI = this.distMatrix[currNode][i];
      const t1 = currT + distCurrI;
      const t1Wait = Math.max(this.openingTimes[i] - t1, 0);
      const t1Start = t1 + t1Wait;
      const t1End = t1Start + this.durations[i];
      const validI = t1Start <= this.closingTimes[i];
      if (!validI) continue;

      for (let j = 0; j < n; j++) {
        if (this.visited[j] || j === i) continue;
        const t2 = t1End + this.distMatrix[i][j];
        const t2Wait = Math.max(this.openingTimes[j] - t2, 0);
        const t2Start = t2 + t2Wait;
        const t2End = t2Start + this.durations[j];
        const validJ = t2Start <= this.closingTimes[j];
        const tHome = t2End + this.distMatrix[j][0];
        const validHome = tHome <= this.config.maxTime;
        adj[i][j] = validJ && validHome;
      }
    }
    return adj;
  }

  /** Applies a chosen next node; returns the reward earned by this move. */
  step(action: number): { reward: number; done: boolean } {
    const travelTime = this.distMatrix[this.currentNode][action];
    const arrivalTime = this.currentTime + travelTime;
    const wait = Math.max(this.openingTimes[action] - arrivalTime, 0);
    const startVisitTime = arrivalTime + wait;

    this.currentTime = startVisitTime + this.durations[action];
    this.currentNode = action;
    this.visited[action] = true;

    const decay = this.decayFraction(startVisitTime);
    const reward = this.rewards[action] * decay;

    this.lastStepForecastUpdated = this.maybeUpdateForecast();

    const mask = this.getAdmissibilityMask();
    const done = !mask.some(Boolean);

    return { reward, done };
  }
}

function euclidean(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

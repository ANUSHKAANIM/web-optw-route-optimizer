import type { ComparisonMethod, MethodComparisonResult } from "@/solver/method-comparison";

export type ScenarioSource = "demo" | "idalia";

export interface BenchmarkState {
  source: ScenarioSource;
  includeCplex: boolean;
  results: MethodComparisonResult[] | null;
  scenarioLabel: string | null;
  candidateCount: number | null;
  error: string | null;
  running: boolean;
  allZones: AllZonesState;
}

export interface ZoneResult {
  shelterId: string;
  originCount: number;
  candidateCount: number;
  results: MethodComparisonResult[];
}

export interface AggregateMethodStats {
  method: ComparisonMethod;
  label: string;
  zonesRun: number;
  totalReward: number;
  meanReward: number;
  meanComputeTimeMs: number;
  /** Exact tiers only: how many zones that tier actually closed to optimal
   * within its time limit (vs. reporting a time-limit incumbent). */
  optimalCount?: number;
  /** Greedy/neural only: mean % reward left on the table vs exact-HiGHS,
   * averaged only over zones where exact-HiGHS itself reached optimal
   * (otherwise exact isn't a trustworthy upper bound to compare against). */
  meanGapVsExactPct?: number;
}

export interface AllZonesState {
  running: boolean;
  includeCplex: boolean;
  zoneCount: number | null;
  totalRuntimeMs: number | null;
  zones: ZoneResult[] | null;
  aggregate: AggregateMethodStats[] | null;
  error: string | null;
}

function createAllZonesState(): AllZonesState {
  return {
    running: false,
    includeCplex: false,
    zoneCount: null,
    totalRuntimeMs: null,
    zones: null,
    aggregate: null,
    error: null,
  };
}

function createState(): BenchmarkState {
  return {
    source: "demo",
    includeCplex: false,
    results: null,
    scenarioLabel: null,
    candidateCount: null,
    error: null,
    running: false,
    allZones: createAllZonesState(),
  };
}

const globalForBenchmark = globalThis as unknown as { benchmarkState?: BenchmarkState };

/** Same globalThis-singleton pattern /rolling-horizon and /idalia-preview use
 * to survive Next.js dev-mode hot reloads -- this is a single shared
 * benchmark result, not per-visitor state. */
export function getBenchmarkState(): BenchmarkState {
  if (!globalForBenchmark.benchmarkState) globalForBenchmark.benchmarkState = createState();
  return globalForBenchmark.benchmarkState;
}

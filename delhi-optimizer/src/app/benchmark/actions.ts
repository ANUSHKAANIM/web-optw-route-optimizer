"use server";

import { revalidatePath } from "next/cache";
import { EVACUATION_NODES, SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { buildGraph } from "@/graph/build-graph";
import type { GraphNode } from "@/types/graph";
import { compareMethods, type ComparisonMethod, type MethodComparisonResult } from "@/solver/method-comparison";
import type { GraphCluster } from "@/graph/spatial-clustering";
import { loadIdaliaScenario } from "../idalia-preview/scene-data";
import { getBenchmarkState, type AggregateMethodStats, type ScenarioSource, type ZoneResult } from "./state";

function safeRevalidate(): void {
  try {
    revalidatePath("/benchmark");
  } catch {
    // no-op outside a real Next.js request context
  }
}

/** Candidate-origin cap for a live, page-load-friendly run of the exact
 * tiers -- same order of magnitude milp.ts's own header documents as
 * actually validated (HiGHS/CPLEX both solve a ~13-24 node problem in
 * well under the 20s time limit below; routeCluster's own default
 * maxCandidatesForExact is 40). */
const CANDIDATE_CAP = 24;

interface BuiltScenario {
  label: string;
  graph: ReturnType<typeof buildGraph>;
  depotId: string;
  shelterCapacity: number;
  originIds: string[];
  priorities: Map<string, number>;
}

/** Builds a trimmed graph containing ONLY the depot + the chosen origins,
 * so greedy/neural/exact all solve the literal same problem -- not a
 * capped exact tier racing against an uncapped greedy/neural tier that
 * can see every tract in the zone. Same trimmed-subgraph technique
 * rolling-horizon-controller.ts already uses for "foreign van" routing. */
function trimmedGraph(allNodes: GraphNode[], depotId: string, originIds: string[]) {
  const keep = new Set([depotId, ...originIds]);
  return buildGraph(allNodes.filter((n) => keep.has(n.id)));
}

function buildDemoScenario(): BuiltScenario {
  const depotId = SHELTER_DEPOT_ID;
  const shelter = EVACUATION_NODES.find((n) => n.id === depotId)!;
  const originIds = EVACUATION_NODES.filter((n) => n.role === "origin")
    .slice(0, CANDIDATE_CAP)
    .map((n) => n.id);
  const graph = trimmedGraph(EVACUATION_NODES, depotId, originIds);
  const priorities = new Map(EVACUATION_NODES.map((n) => [n.id, n.demand]));
  return {
    label: `Demo scenario -- ${shelter.name}, ${originIds.length} villages`,
    graph,
    depotId,
    shelterCapacity: shelter.capacity,
    originIds,
    priorities,
  };
}

function buildIdaliaScenario(): BuiltScenario | null {
  const scenario = loadIdaliaScenario();
  if (!scenario) return null;

  const cluster = scenario.clusters.reduce((best, c) => (c.graph.nodes.length > best.graph.nodes.length ? c : best));
  const originNodes = cluster.graph.nodes.filter((n) => n.role === "origin");
  const topOrigins = [...originNodes]
    .sort((a, b) => (scenario.priorities.get(b.id) ?? 0) - (scenario.priorities.get(a.id) ?? 0))
    .slice(0, CANDIDATE_CAP);
  const originIds = topOrigins.map((n) => n.id);
  const shelterNode = cluster.graph.nodesById.get(cluster.shelterId)!;
  const graph = trimmedGraph(cluster.graph.nodes, cluster.shelterId, originIds);

  return {
    label: `Hurricane Idalia -- largest shelter zone (${originNodes.length} real tracts; top ${originIds.length} by reward used here so the exact tiers stay solvable live)`,
    graph,
    depotId: cluster.shelterId,
    shelterCapacity: shelterNode.capacity,
    originIds,
    priorities: scenario.priorities,
  };
}

export async function runComparison(formData: FormData): Promise<void> {
  const state = getBenchmarkState();
  const source = (formData.get("source") as ScenarioSource) ?? "demo";
  const includeCplex = formData.get("includeCplex") === "on";

  state.source = source;
  state.includeCplex = includeCplex;
  state.error = null;
  state.running = true;

  const built = source === "idalia" ? buildIdaliaScenario() : buildDemoScenario();
  if (!built) {
    state.error = "Real Idalia data isn't on disk yet -- see /idalia-preview for the expected file path.";
    state.results = null;
    state.scenarioLabel = null;
    state.candidateCount = null;
    state.running = false;
    safeRevalidate();
    return;
  }

  try {
    const results = await compareMethods({
      graph: built.graph,
      currentNodeId: built.depotId,
      depotNodeId: built.depotId,
      remainingMinutes: 600,
      shiftedGameStartMinutesOfDay: 9 * 60,
      weekday: "monday",
      priorities: built.priorities,
      riskScores: new Map(built.originIds.map((id) => [id, 0])),
      demandServedSoFar: 0,
      shelterCapacity: built.shelterCapacity,
      candidateOriginIds: built.originIds,
      includeCplex,
      exactTimeLimitSeconds: 20,
    });
    state.results = results;
    state.scenarioLabel = built.label;
    state.candidateCount = built.originIds.length;
  } catch (err) {
    state.error = err instanceof Error ? err.message : "Comparison failed.";
    state.results = null;
  }
  state.running = false;
  safeRevalidate();
}

/** Smaller than the single-zone CANDIDATE_CAP -- this runs the full
 * comparison up to ~75 times in one request, so each zone's exact tiers
 * need to stay well under a second to keep total runtime reasonable. */
const BATCH_CANDIDATE_CAP = 16;
const BATCH_EXACT_TIME_LIMIT_SECONDS = 8;

function buildZoneScenario(cluster: GraphCluster, priorities: Map<string, number>) {
  const originNodes = cluster.graph.nodes.filter((n) => n.role === "origin");
  if (originNodes.length === 0) return null;
  const topOrigins = [...originNodes]
    .sort((a, b) => (priorities.get(b.id) ?? 0) - (priorities.get(a.id) ?? 0))
    .slice(0, BATCH_CANDIDATE_CAP);
  const originIds = topOrigins.map((n) => n.id);
  const shelterNode = cluster.graph.nodesById.get(cluster.shelterId)!;
  const graph = trimmedGraph(cluster.graph.nodes, cluster.shelterId, originIds);
  return { graph, depotId: cluster.shelterId, shelterCapacity: shelterNode.capacity, originIds, originCount: originNodes.length };
}

function computeAggregate(zones: ZoneResult[]): AggregateMethodStats[] {
  const methods: ComparisonMethod[] = ["greedy", "neural", "exact-highs"];
  if (zones.some((z) => z.results.some((r) => r.method === "exact-cplex"))) methods.push("exact-cplex");

  const exactHighsByZone = new Map<string, MethodComparisonResult | undefined>(
    zones.map((z) => [z.shelterId, z.results.find((r) => r.method === "exact-highs")]),
  );

  return methods.map((method) => {
    const perZone = zones
      .map((z) => z.results.find((r) => r.method === method))
      .filter((r): r is MethodComparisonResult => r !== undefined);

    const totalReward = perZone.reduce((sum, r) => sum + r.totalReward, 0);
    const meanReward = perZone.length > 0 ? totalReward / perZone.length : 0;
    const meanComputeTimeMs = perZone.length > 0 ? perZone.reduce((sum, r) => sum + r.computeTimeMs, 0) / perZone.length : 0;
    const label = perZone[0]?.label ?? method;

    const isExact = method.startsWith("exact-");
    const optimalCount = isExact ? perZone.filter((r) => r.status.toLowerCase().includes("optimal")).length : undefined;

    let meanGapVsExactPct: number | undefined;
    if (!isExact) {
      const gaps: number[] = [];
      for (const z of zones) {
        const exact = exactHighsByZone.get(z.shelterId);
        const mine = z.results.find((r) => r.method === method);
        if (!exact || !mine || !exact.status.toLowerCase().includes("optimal") || exact.totalReward <= 0) continue;
        gaps.push(((exact.totalReward - mine.totalReward) / exact.totalReward) * 100);
      }
      if (gaps.length > 0) meanGapVsExactPct = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    }

    return { method, label, zonesRun: perZone.length, totalReward, meanReward, meanComputeTimeMs, optimalCount, meanGapVsExactPct };
  });
}

export async function runAllZonesComparison(formData: FormData): Promise<void> {
  const state = getBenchmarkState();
  const includeCplex = formData.get("includeCplex") === "on";

  state.allZones.running = true;
  state.allZones.includeCplex = includeCplex;
  state.allZones.error = null;
  safeRevalidate();

  const scenario = loadIdaliaScenario();
  if (!scenario) {
    state.allZones.error = "Real Idalia data isn't on disk yet -- see /idalia-preview for the expected file path.";
    state.allZones.running = false;
    safeRevalidate();
    return;
  }

  const start = Date.now();
  const zones: ZoneResult[] = [];

  try {
    for (const cluster of scenario.clusters) {
      const built = buildZoneScenario(cluster, scenario.priorities);
      if (!built) continue;

      const results = await compareMethods({
        graph: built.graph,
        currentNodeId: built.depotId,
        depotNodeId: built.depotId,
        remainingMinutes: 600,
        shiftedGameStartMinutesOfDay: 9 * 60,
        weekday: "monday",
        priorities: scenario.priorities,
        riskScores: new Map(built.originIds.map((id) => [id, 0])),
        demandServedSoFar: 0,
        shelterCapacity: built.shelterCapacity,
        candidateOriginIds: built.originIds,
        includeCplex,
        exactTimeLimitSeconds: BATCH_EXACT_TIME_LIMIT_SECONDS,
      });

      zones.push({
        shelterId: cluster.shelterId,
        originCount: built.originCount,
        candidateCount: built.originIds.length,
        results,
      });
    }

    state.allZones.zones = zones;
    state.allZones.aggregate = computeAggregate(zones);
    state.allZones.zoneCount = zones.length;
    state.allZones.totalRuntimeMs = Date.now() - start;
  } catch (err) {
    state.allZones.error = err instanceof Error ? err.message : "Batch comparison failed.";
    state.allZones.zones = zones.length > 0 ? zones : null;
    state.allZones.aggregate = zones.length > 0 ? computeAggregate(zones) : null;
  }

  state.allZones.running = false;
  safeRevalidate();
}

import { SyntheticCellProvider } from "@/data/synthetic-cell-provider";
import { CycloneForecastEngine, type ForecastTickResult } from "@/forecast/cyclone-forecast-engine";
import { priorityFromForecastTick } from "@/forecast/priority-from-forecast";
import { buildHeatmapGrid, type BinCellInput, type HeatmapGrid } from "@/components/map/risk-heatmap-binning";
import type { MapVanMarker, Bounds } from "@/components/map/optimizer-map";
import { buildGraph } from "@/graph/build-graph";
import { computeBaselineRoute } from "@/optimization/baseline-policy";
import { routeTeamWithPin } from "@/solver/pinned-route";
import type { GraphNode } from "@/types/graph";
import type { RiskTier } from "@/forecast/risk-tiers";

/**
 * Shared scene builder for both /scale-preview (storm-zoomed) and
 * /dashboard (full-map overview) -- same underlying data, computed once
 * here so the two views can never silently drift apart. Only the map's
 * `bounds` differ between the two pages; everything else (forecast tick,
 * villages, vans, routes, pin handling) is identical.
 */

export const SEED = 7;
export const SESSION_STARTED_AT = new Date();
export const FORECAST_INTERVAL_SECONDS = 8 * 3600;
export const VAN_COLORS = ["#38bdf8", "#f472b6", "#a3e635", "#fb923c", "#c084fc", "#2dd4bf"];
export const MAX_TICK = 50;

export function nearestShelters(shelters: GraphNode[], x: number, y: number, count: number): GraphNode[] {
  return [...shelters].sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)).slice(0, count);
}

/** Zoomed to the storm's actual extent -- at full-extent zoom, a few dozen
 * at-risk villages out of 20,000 render as an invisible speck. */
export function boundsAroundStorm(centerX: number, centerY: number, outerRadiusKm: number): Bounds {
  const half = outerRadiusKm * 2.2;
  return { minX: centerX - half, minY: centerY - half, width: half * 2, height: half * 2 };
}

/** The whole synthetic plane -- for the combined overview dashboard,
 * where seeing the storm positioned within the full region matters more
 * than reading individual village detail (that's what /scale-preview and
 * the village list are for). */
export function fullMapBounds(cells: GraphNode[], paddingKm = 10): Bounds {
  const xs = cells.map((c) => c.x);
  const ys = cells.map((c) => c.y);
  const minX = Math.min(...xs) - paddingKm;
  const minY = Math.min(...ys) - paddingKm;
  const width = Math.max(...xs) - Math.min(...xs) + paddingKm * 2;
  const height = Math.max(...ys) - Math.min(...ys) + paddingKm * 2;
  return { minX, minY, width, height };
}

/** Zoomed to one specific van's own shelter + its route's extent -- for
 * "select a van, see its ideal path up close" on the combined dashboard.
 * Falls back to a small fixed radius around the shelter when the van has
 * no current route (idle), so selecting it still shows something sane
 * instead of an empty/undefined viewport. */
export function boundsAroundVan(shelter: GraphNode, routePoints: [number, number][], paddingKm = 4): Bounds {
  if (routePoints.length === 0) {
    const half = 8;
    return { minX: shelter.x - half, minY: shelter.y - half, width: half * 2, height: half * 2 };
  }
  const xs = routePoints.map((p) => p[0]);
  const ys = routePoints.map((p) => p[1]);
  const minX = Math.min(...xs) - paddingKm;
  const minY = Math.min(...ys) - paddingKm;
  const width = Math.max(...xs) - Math.min(...xs) + paddingKm * 2;
  const height = Math.max(...ys) - Math.min(...ys) + paddingKm * 2;
  return { minX, minY, width: Math.max(width, 8), height: Math.max(height, 8) };
}

/** Computes a real route (via the actual greedy solver, not a mock) for
 * one shelter's nearby at-risk villages. Builds buildGraph() on just this
 * shelter + its own local villages (a handful of nodes) -- NOT the full
 * 20,000-cell dataset. */
export interface VanRouteStop {
  nodeId: string;
  name: string;
  demand: number;
}

function computeShelterResponseRoute(
  shelter: GraphNode,
  localVillages: GraphNode[],
  tick: ForecastTickResult,
): { points: [number, number][]; stops: VanRouteStop[] } {
  if (localVillages.length === 0) return { points: [], stops: [] };

  const localNodes = [shelter, ...localVillages];
  const graph = buildGraph(localNodes);
  const { priorities, riskScores } = priorityFromForecastTick(localNodes, tick);
  const deadlineWindows = new Map(localNodes.map((n) => [n.id, tick.cellStates.get(n.id)?.window ?? null] as const));

  const route = computeBaselineRoute({
    graph,
    currentNodeId: shelter.id,
    depotNodeId: shelter.id,
    totalGameMinutes: 300,
    gameStartMinutesOfDay: 9 * 60,
    weekday: "monday",
    priorities,
    riskScores,
    demandServedSoFar: 0,
    shelterCapacity: shelter.capacity,
    deadlineWindows,
  });

  const points: [number, number][] = [[shelter.x, shelter.y]];
  const stops: VanRouteStop[] = [];
  for (const stop of route.stops) {
    const node = graph.nodesById.get(stop.nodeId);
    if (node) {
      points.push([node.x, node.y]);
      stops.push({ nodeId: node.id, name: node.name, demand: node.demand });
    }
  }
  points.push([shelter.x, shelter.y]);
  return { points, stops };
}

export interface ElevatedVillage {
  node: GraphNode;
  state: { tier: RiskTier; riskScore: number; rewardMultiplier: number; hoursSinceElevated: number };
  nearestShelter: GraphNode | undefined;
}

export interface SceneData {
  cells: GraphNode[];
  tick: ForecastTickResult;
  heatmapGrid: HeatmapGrid;
  shelters: GraphNode[];
  depotNodeId: string;
  outerRadiusKm: number;
  respondingShelters: GraphNode[];
  vanMarkers: MapVanMarker[];
  vanRoutes: { vanId: number; points: [number, number][]; stops: VanRouteStop[]; color: string }[];
  elevatedVillages: ElevatedVillage[];
  totalPopulationAtRisk: number;
  tierCounts: Record<RiskTier, number>;
  elevatedCount: number;
  riskRings: { centerX: number; centerY: number; radiusKm: number; level: "high" | "medium" | "low" }[];
  pinHonored: boolean;
}

export async function buildSceneData(
  requestedTick: number,
  evacuatedIds: Set<string>,
  pinnedVanId: number | undefined,
  pinnedVillageId: string | undefined,
  respondingShelterCount = 6,
): Promise<SceneData> {
  const cells = new SyntheticCellProvider({ seed: SEED }).getNodes(); // default: 20,000 cells

  // CycloneForecastEngine is STATEFUL -- a cell's elevation deadline and
  // reward-accumulation clock depend on *when it first became at-risk*,
  // which only exists by actually replaying every tick from 0. Cheap
  // regardless (each tick is sub-millisecond).
  const forecastEngine = new CycloneForecastEngine(cells, SEED, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS);
  for (const id of evacuatedIds) forecastEngine.markEvacuated(id);

  let tick = forecastEngine.advanceTick(0);
  for (let t = 1; t <= requestedTick; t++) tick = forecastEngine.advanceTick(t);

  const binInputs: BinCellInput[] = cells
    .filter((n) => n.role === "origin")
    .map((node) => {
      const state = tick.cellStates.get(node.id)!;
      return { node, tier: state.tier, riskScore: state.riskScore };
    });
  const heatmapGrid = buildHeatmapGrid(binInputs, 15);

  const shelters = cells.filter((n) => n.role === "shelter");
  const depotNodeId = shelters[0]?.id ?? cells[0].id;
  const outerRadiusKm = tick.zone.rings[tick.zone.rings.length - 1].radiusKm;

  const respondingShelters = nearestShelters(shelters, tick.zone.centerX, tick.zone.centerY, respondingShelterCount);
  const vanMarkers: MapVanMarker[] = respondingShelters.flatMap((shelter, s) =>
    [0, 1].map((i) => ({
      vanId: s * 2 + i,
      x: shelter.x + (i === 0 ? -1.5 : 1.5),
      y: shelter.y + (i === 0 ? -1 : 1),
      color: VAN_COLORS[(s * 2 + i) % VAN_COLORS.length],
      label: `Van ${s * 2 + i + 1}`,
    })),
  );

  const tierCounts: Record<RiskTier, number> = { normal: 0, watch: 0, warning: 0, severe: 0, critical: 0 };
  for (const state of tick.cellStates.values()) tierCounts[state.tier]++;
  const elevatedCount = tierCounts.watch + tierCounts.warning + tierCounts.severe + tierCounts.critical;

  const tierSeverity: Record<RiskTier, number> = { critical: 4, severe: 3, warning: 2, watch: 1, normal: 0 };
  const elevatedVillages: ElevatedVillage[] = cells
    .filter((n) => n.role === "origin")
    .map((node) => ({ node, state: tick.cellStates.get(node.id)! }))
    .filter(({ state }) => state.tier !== "normal")
    .map(({ node, state }) => ({ node, state, nearestShelter: nearestShelters(shelters, node.x, node.y, 1)[0] }))
    .sort((a, b) => tierSeverity[b.state.tier] - tierSeverity[a.state.tier] || b.node.demand - a.node.demand);
  const totalPopulationAtRisk = elevatedVillages.reduce((sum, v) => sum + v.node.demand, 0);

  // Human override (Phase 4/5): a pinned van's route is computed via the
  // real routeTeamWithPin() instead of the default nearest-cluster
  // response route. Local graph includes EVERY elevated village (not
  // just this shelter's own cluster) since an override can target any
  // at-risk village.
  let pinnedRoute: { points: [number, number][]; stops: VanRouteStop[] } | null = null;
  let pinHonored = false;
  if (pinnedVanId !== undefined && pinnedVillageId) {
    const pinnedVanShelter = respondingShelters[Math.floor(pinnedVanId / 2)];
    const pinnedNode = cells.find((c) => c.id === pinnedVillageId);
    if (pinnedVanShelter && pinnedNode) {
      const localNodes = [
        pinnedVanShelter,
        pinnedNode,
        ...elevatedVillages.filter((v) => v.node.id !== pinnedVillageId).map((v) => v.node),
      ];
      const graph = buildGraph(localNodes);
      const { priorities, riskScores } = priorityFromForecastTick(localNodes, tick);
      const deadlineWindows = new Map(localNodes.map((n) => [n.id, tick.cellStates.get(n.id)?.window ?? null] as const));
      const result = await routeTeamWithPin({
        graph,
        currentNodeId: pinnedVanShelter.id,
        depotNodeId: pinnedVanShelter.id,
        pinnedCellId: pinnedVillageId,
        remainingMinutes: 300,
        shiftedGameStartMinutesOfDay: 9 * 60,
        weekday: "monday",
        priorities,
        riskScores,
        demandServedSoFar: 0,
        shelterCapacity: pinnedVanShelter.capacity,
        method: "greedy",
        deadlineWindows,
      });
      pinHonored = result.pinHonored;
      const points: [number, number][] = [[pinnedVanShelter.x, pinnedVanShelter.y]];
      const stops: VanRouteStop[] = [];
      for (const stop of result.route.stops) {
        const node = graph.nodesById.get(stop.nodeId);
        if (node) {
          points.push([node.x, node.y]);
          stops.push({ nodeId: node.id, name: node.name, demand: node.demand });
        }
      }
      points.push([pinnedVanShelter.x, pinnedVanShelter.y]);
      pinnedRoute = { points, stops };
    }
  }

  const vanRoutes = respondingShelters
    .flatMap((shelter, s) => {
      const localVillages = elevatedVillages.filter((v) => v.nearestShelter?.id === shelter.id).map((v) => v.node);
      // Split this shelter's villages across its two vans (alternating,
      // so both carry a mix of severity rather than one getting everything
      // and the other always sitting parked) -- this is what lets both
      // vans actually be "on ground" together when there's enough demand,
      // instead of the second van being permanently decorative.
      const vanVillages = [localVillages.filter((_, i) => i % 2 === 0), localVillages.filter((_, i) => i % 2 === 1)];

      return [0, 1].map((i) => {
        const vanId = s * 2 + i;
        if (pinnedVanId === vanId && pinnedRoute) {
          return { vanId, points: pinnedRoute.points, stops: pinnedRoute.stops, color: VAN_COLORS[vanId % VAN_COLORS.length] };
        }
        const { points, stops } = computeShelterResponseRoute(shelter, vanVillages[i], tick);
        return points.length > 1 ? { vanId, points, stops, color: VAN_COLORS[vanId % VAN_COLORS.length] } : null;
      });
    })
    .filter((r): r is { vanId: number; points: [number, number][]; stops: VanRouteStop[]; color: string } => r !== null);

  const riskRings = tick.zone.rings.map((ring) => ({
    centerX: tick.zone.centerX,
    centerY: tick.zone.centerY,
    radiusKm: ring.radiusKm,
    level: ring.level,
  }));

  return {
    cells,
    tick,
    heatmapGrid,
    shelters,
    depotNodeId,
    outerRadiusKm,
    respondingShelters,
    vanMarkers,
    vanRoutes,
    elevatedVillages,
    totalPopulationAtRisk,
    tierCounts,
    elevatedCount,
    riskRings,
    pinHonored,
  };
}

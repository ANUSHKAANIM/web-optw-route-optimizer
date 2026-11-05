import type { GraphCluster } from "@/graph/spatial-clustering";
import { routeCluster, type ClusterTeam, type ClusterRoutingThresholds } from "@/solver/cluster-router";
import { resolveTeamProcessingOrder } from "@/solver/contested-cell-arbitration";
import { routeTeamWithPin } from "@/solver/pinned-route";
import type { GraphNode } from "@/types/graph";
import type { Route } from "@/types/game";
import {
  loadIdaliaScenario,
  VANS_PER_SHELTER,
  VAN_SHIFT_MINUTES,
  COMMIT_WINDOW_MINUTES,
  SOLVER_TIER_THRESHOLDS,
  type SolverTier,
  type IdaliaStaticScenario,
} from "./scene-data";

/**
 * The stateful, interactive layer on top of the static scenario
 * (scene-data.ts) -- genuinely mirrors /rolling-horizon's session.ts, but
 * for real Idalia tract data instead of the synthetic forecast. The big
 * structural difference: there's no CycloneForecastEngine here, because
 * this forecast cone already happened -- priority per tract is a FIXED
 * real reward, not something that evolves tick to tick. "Advance Tick"
 * therefore doesn't move a storm; it just lets committed vans become free
 * again and triggers a fresh replan, same mechanical effect the commit
 * window (tau) has in the synthetic version.
 *
 * Fleet-wide (cross-shelter) reassignment is deliberately NOT implemented
 * here, per the explicit instruction that excluded it -- every van stays
 * within its own shelter's cluster, same as the original static preview.
 */

export interface VanState {
  vanId: number;
  /** Always its home shelter's node id -- vans don't visually move after
   * an arrival, same documented limitation /rolling-horizon has. */
  currentNodeId: string;
  remainingMinutes: number;
  shiftedGameStartMinutesOfDay: number;
  committedUntilMinutes: number;
  pinnedCellId?: string;
}

export interface IdaliaSession {
  scenario: IdaliaStaticScenario;
  nodesById: Map<string, GraphNode>;
  cellIdToShelterId: Map<string, string>;
  demandServedByShelter: Map<string, number>;
  evacuatedCellIds: Set<string>;
  vans: Map<number, VanState>;
  vanRoutes: Map<number, Route>;
  currentTick: number;
  solverTier: SolverTier;
  log: string[];
}

function buildVans(clusters: GraphCluster[]): Map<number, VanState> {
  const vans = new Map<number, VanState>();
  let vanId = 0;
  for (const cluster of clusters) {
    for (let i = 0; i < VANS_PER_SHELTER; i++) {
      vans.set(vanId, {
        vanId,
        currentNodeId: cluster.shelterId,
        remainingMinutes: VAN_SHIFT_MINUTES,
        shiftedGameStartMinutesOfDay: 9 * 60,
        committedUntilMinutes: 0,
      });
      vanId++;
    }
  }
  return vans;
}

function createSession(): IdaliaSession | null {
  const scenario = loadIdaliaScenario();
  if (!scenario) return null;

  const cellIdToShelterId = new Map<string, string>();
  for (const cluster of scenario.clusters) {
    for (const node of cluster.graph.nodes) cellIdToShelterId.set(node.id, cluster.shelterId);
  }

  return {
    scenario,
    nodesById: new Map(scenario.cells.map((n) => [n.id, n])),
    cellIdToShelterId,
    demandServedByShelter: new Map(scenario.clusters.map((c) => [c.shelterId, 0])),
    evacuatedCellIds: new Set(),
    vans: buildVans(scenario.clusters),
    vanRoutes: new Map(),
    currentTick: -1,
    solverTier: "fast",
    log: [],
  };
}

const globalForIdalia = globalThis as unknown as { idaliaSession?: IdaliaSession | null; idaliaSessionBuilt?: boolean };

/** null means "the CSV genuinely isn't there" -- cached too, so a missing
 * file doesn't re-stat/re-throw on every request. undefined (not yet
 * built) is distinguished via idaliaSessionBuilt so a later successful
 * drop of the real file is picked up without a server restart. */
export function getSession(): IdaliaSession | null {
  if (!globalForIdalia.idaliaSessionBuilt) {
    globalForIdalia.idaliaSession = createSession();
    globalForIdalia.idaliaSessionBuilt = true;
  }
  return globalForIdalia.idaliaSession ?? null;
}

export function logEvent(session: IdaliaSession, message: string): void {
  session.log.unshift(message);
  session.log = session.log.slice(0, 10);
}

function planningBudgetFor(van: VanState): number {
  return van.remainingMinutes;
}

async function replan(session: IdaliaSession, nowMinutes: number, vanIds: number[]): Promise<Map<number, Route>> {
  const routes = new Map<number, Route>();
  if (vanIds.length === 0) return routes;

  const byShelter = new Map<string, VanState[]>();
  for (const id of vanIds) {
    const van = session.vans.get(id);
    if (!van) continue;
    const list = byShelter.get(van.currentNodeId) ?? [];
    list.push(van);
    byShelter.set(van.currentNodeId, list);
  }

  const { priorities } = session.scenario;
  const thresholds: ClusterRoutingThresholds = SOLVER_TIER_THRESHOLDS[session.solverTier];

  for (const cluster of session.scenario.clusters) {
    const clusterVans = byShelter.get(cluster.shelterId);
    if (!clusterVans || clusterVans.length === 0) continue;

    const shelter = cluster.graph.nodesById.get(cluster.shelterId)!;
    const pinned = clusterVans.filter((v) => v.pinnedCellId !== undefined);
    const unpinned = clusterVans.filter((v) => v.pinnedCellId === undefined);
    const visited = new Set<string>(session.evacuatedCellIds);
    let demandServedSoFar = session.demandServedByShelter.get(cluster.shelterId) ?? 0;

    for (const van of pinned) {
      const result = await routeTeamWithPin({
        graph: cluster.graph,
        currentNodeId: van.currentNodeId,
        depotNodeId: cluster.shelterId,
        pinnedCellId: van.pinnedCellId!,
        remainingMinutes: planningBudgetFor(van),
        shiftedGameStartMinutesOfDay: van.shiftedGameStartMinutesOfDay,
        weekday: "monday",
        priorities,
        riskScores: priorities,
        demandServedSoFar,
        shelterCapacity: shelter.capacity,
        alreadyVisited: visited,
        method: "greedy",
      });
      routes.set(van.vanId, result.route);
      for (const stop of result.route.stops) visited.add(stop.nodeId);
      demandServedSoFar += result.route.totalDemandServed;
      van.pinnedCellId = undefined;
      van.committedUntilMinutes = nowMinutes + (result.route.stops[0]?.departureMinutes ?? COMMIT_WINDOW_MINUTES);
    }

    if (unpinned.length > 0) {
      const teams: ClusterTeam[] = unpinned.map((v) => ({
        teamId: v.vanId,
        currentNodeId: v.currentNodeId,
        remainingMinutes: planningBudgetFor(v),
        shiftedGameStartMinutesOfDay: v.shiftedGameStartMinutesOfDay,
      }));
      const ordered = resolveTeamProcessingOrder(cluster, teams, priorities);
      const result = await routeCluster({
        cluster,
        teams: ordered,
        weekday: "monday",
        priorities,
        riskScores: priorities,
        demandServedSoFar,
        shelterCapacity: shelter.capacity,
        alreadyVisited: visited,
        thresholds,
      });
      for (const [teamId, route] of result.routesByTeam) {
        routes.set(teamId, route);
        const van = session.vans.get(teamId)!;
        van.committedUntilMinutes = nowMinutes + (route.stops[0]?.departureMinutes ?? COMMIT_WINDOW_MINUTES);
      }
    }
  }

  return routes;
}

export async function advanceTick(session: IdaliaSession, tickStepMinutes: number): Promise<Map<number, Route>> {
  const nextTick = session.currentTick + 1;
  const nowMinutes = nextTick * tickStepMinutes;
  const freeVanIds = Array.from(session.vans.values())
    .filter((v) => nowMinutes >= v.committedUntilMinutes)
    .map((v) => v.vanId);
  const routes = await replan(session, nowMinutes, freeVanIds);
  session.currentTick = nextTick;
  return routes;
}

export async function onVanArrival(session: IdaliaSession, vanId: number, cellId: string, nowMinutes: number): Promise<Map<number, Route>> {
  session.evacuatedCellIds.add(cellId);
  const shelterId = session.cellIdToShelterId.get(cellId);
  const demand = session.nodesById.get(cellId)?.demand ?? 0;
  if (shelterId) {
    session.demandServedByShelter.set(shelterId, (session.demandServedByShelter.get(shelterId) ?? 0) + demand);
  }
  const van = session.vans.get(vanId);
  if (van) van.committedUntilMinutes = nowMinutes;
  return replan(session, nowMinutes, [vanId]);
}

export async function onHumanOverride(session: IdaliaSession, vanId: number, cellId: string, nowMinutes: number): Promise<Map<number, Route>> {
  const van = session.vans.get(vanId);
  if (!van) return new Map();
  van.pinnedCellId = cellId;
  van.committedUntilMinutes = nowMinutes;
  return replan(session, nowMinutes, [vanId]);
}

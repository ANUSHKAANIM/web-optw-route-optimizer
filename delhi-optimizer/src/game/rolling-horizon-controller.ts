import type { GraphNode, Weekday } from "@/types/graph";
import type { Route } from "@/types/game";
import type { GraphCluster } from "@/graph/spatial-clustering";
import type { ClusterRoutingThresholds } from "@/solver/cluster-router";
import { routeCluster, type ClusterTeam } from "@/solver/cluster-router";
import { resolveTeamProcessingOrder } from "@/solver/contested-cell-arbitration";
import { routeTeamWithPin } from "@/solver/pinned-route";
import { assignVansToClusters, assignVansToClustersByReward, type VanPosition } from "./van-cluster-assignment";
import { CycloneForecastEngine, type ForecastTickResult } from "@/forecast/cyclone-forecast-engine";
import { priorityFromForecastTick } from "@/forecast/priority-from-forecast";
import { buildGraph } from "@/graph/build-graph";
import { computeBaselineRoute } from "@/optimization/baseline-policy";

/**
 * Phase 5: wires Phases 1-4 into the actual rolling-horizon loop the
 * project's roadmap describes -- periodic forecast ticks (p = the 8-hour
 * cadence) combined with immediate event-driven replanning (a van
 * arriving somewhere), both respecting a commit window (tau) so a van
 * isn't yanked off a leg it's already partway through, AND an optional
 * bounded lookahead (H) so a replan reasons about only the next H
 * minutes of a van's budget, not its entire remaining time -- the full
 * (H, tau, p) structure from Haque, Hamid & Chaudhuri's rolling-horizon
 * railway rescheduling paper. H is applied purely as a planning-horizon
 * cap passed to the solvers (remainingMinutes is capped at H when H is
 * configured); the van's REAL remaining budget is unaffected -- it will
 * simply be re-planned again on the next tick/event with a fresh H-sized
 * window, which is the actual point of a rolling horizon: never commit
 * further ahead than you can trust the forecast to stay accurate for.
 *
 * This is intentionally a NEW, separate controller, not a change to the
 * existing replan.service.ts -- that service runs the already-deployed
 * single-cluster 13-node game and needs to keep working exactly as it
 * does today. This controller is for the multi-cluster, multi-van,
 * 20,000-cell system built in Phases 0-4.
 */

export interface VanState {
  vanId: number;
  currentNodeId: string;
  /** Minutes remaining before this van must be back at ITS shelter. */
  remainingMinutes: number;
  shiftedGameStartMinutesOfDay: number;
  /** Minutes-from-session-start up to which this van's current committed
   * leg must not be torn up by an automatic (non-override) replan --
   * i.e. the commit window tau. 0 means "free to replan immediately." */
  committedUntilMinutes: number;
  /** Set by onHumanOverride; cleared once that pin has been consumed by a
   * replan (honored or rejected). */
  pinnedCellId?: string;
}

export interface RollingHorizonConfig {
  /** tau: minimum minutes a van's freshly (re)planned first leg is
   * protected from being replanned again by the next automatic tick or
   * event, even if one fires sooner. */
  commitWindowMinutes: number;
  /** H: caps how far ahead a replan is allowed to plan, in minutes --
   * undefined means unbounded (plan the van's full remaining budget, the
   * pre-Phase-7.5 behavior). A van's actual remaining time is never
   * reduced by this; only what one replan call reasons about is capped,
   * so the van gets re-planned again with a fresh H-sized window on the
   * next tick once it's consumed what this one committed it to. */
  lookaheadMinutes?: number;
  thresholds?: ClusterRoutingThresholds;
  weekday: Weekday;
  exactTimeLimitSeconds?: number;
  exactSolver?: "highs" | "cplex";
}

export class RollingHorizonController {
  private readonly forecastEngine: CycloneForecastEngine;
  private readonly nodesById: Map<string, GraphNode>;
  private readonly cellIdToShelterId = new Map<string, string>();
  private readonly demandServedByShelter = new Map<string, number>();
  /** Cells evacuated so far, persisted across replans -- markEvacuated()
   * on the forecast engine only takes effect on its NEXT advanceTick(),
   * so this is what actually keeps an evacuated cell excluded from every
   * OTHER van's candidate set in the meantime (same role as
   * globallyVisitedOrigins() in the existing single-cluster game.service.ts). */
  private readonly evacuatedCellIds = new Set<string>();
  private readonly vans = new Map<number, VanState>();
  private lastTick: ForecastTickResult | null = null;

  constructor(
    private readonly cells: GraphNode[],
    private readonly clusters: GraphCluster[],
    seed: number,
    sessionStartedAt: Date,
    forecastIntervalSeconds: number,
    private readonly config: RollingHorizonConfig,
  ) {
    this.forecastEngine = new CycloneForecastEngine(cells, seed, sessionStartedAt, forecastIntervalSeconds);
    this.nodesById = new Map(cells.map((n) => [n.id, n]));
    for (const cluster of clusters) {
      this.demandServedByShelter.set(cluster.shelterId, 0);
      for (const node of cluster.graph.nodes) this.cellIdToShelterId.set(node.id, cluster.shelterId);
    }
  }

  registerVan(van: VanState): void {
    this.vans.set(van.vanId, van);
  }

  getVan(vanId: number): VanState | undefined {
    return this.vans.get(vanId);
  }

  getAllVans(): VanState[] {
    return Array.from(this.vans.values());
  }

  /** The most recent forecast tick's result -- null before the first
   * onForecastTick() call. For UI/display use; routing logic inside this
   * class always uses the private copy directly. */
  getLastTick(): ForecastTickResult | null {
    return this.lastTick;
  }

  /** Periodic forecast cadence (every p). Advances the forecast engine one
   * tick, then replans every van NOT currently inside its commit window.
   * `thresholdsOverride`, when given, replaces this.config.thresholds for
   * JUST this call -- lets a caller (e.g. a live page's fast/real solver
   * toggle) pick the tier per-call without rebuilding the whole
   * controller, which already exists mid-session with real state. */
  async onForecastTick(tick: number, nowMinutes: number, thresholdsOverride?: ClusterRoutingThresholds): Promise<Map<number, Route>> {
    this.lastTick = this.forecastEngine.advanceTick(tick);
    const freeVanIds = Array.from(this.vans.values())
      .filter((v) => nowMinutes >= v.committedUntilMinutes)
      .map((v) => v.vanId);
    return this.replan(nowMinutes, freeVanIds, thresholdsOverride);
  }

  /** Event-driven: a van actually evacuated a cell. Masks it immediately
   * for every other van (not just at the next tick) and replans this
   * van's own remaining route right away. */
  async onVanArrival(
    vanId: number,
    cellId: string,
    nowMinutes: number,
    thresholdsOverride?: ClusterRoutingThresholds,
  ): Promise<Map<number, Route>> {
    this.forecastEngine.markEvacuated(cellId);
    this.evacuatedCellIds.add(cellId);
    const shelterId = this.cellIdToShelterId.get(cellId);
    const demand = this.nodesById.get(cellId)?.demand ?? 0;
    if (shelterId) {
      this.demandServedByShelter.set(shelterId, (this.demandServedByShelter.get(shelterId) ?? 0) + demand);
    }

    const van = this.vans.get(vanId);
    if (van) van.committedUntilMinutes = nowMinutes;
    return this.replan(nowMinutes, [vanId], thresholdsOverride);
  }

  /** Human override: pin a van to a specific cell, bypassing its commit
   * window (an explicit human decision overrides the automatic freeze),
   * and replan just that van. */
  async onHumanOverride(
    vanId: number,
    cellId: string,
    nowMinutes: number,
    thresholdsOverride?: ClusterRoutingThresholds,
  ): Promise<Map<number, Route>> {
    const van = this.vans.get(vanId);
    if (!van) return new Map();
    van.pinnedCellId = cellId;
    van.committedUntilMinutes = nowMinutes;
    return this.replan(nowMinutes, [vanId], thresholdsOverride);
  }

  /** H applied: how far ahead THIS replan may plan for a van, never more
   * than its actual remaining budget. */
  private planningBudgetFor(van: VanState): number {
    return this.config.lookaheadMinutes !== undefined
      ? Math.min(van.remainingMinutes, this.config.lookaheadMinutes)
      : van.remainingMinutes;
  }

  private async replan(
    nowMinutes: number,
    vanIds: number[],
    thresholdsOverride?: ClusterRoutingThresholds,
  ): Promise<Map<number, Route>> {
    if (vanIds.length === 0 || !this.lastTick) return new Map();

    const { priorities, riskScores } = priorityFromForecastTick(this.cells, this.lastTick);
    // Per-cell forecast-driven evacuation deadline (Phase 7.5): narrows a
    // node's static openingHours window to whatever the forecast itself
    // says, instead of that deadline being computed and then discarded.
    const deadlineWindows = new Map(
      Array.from(this.lastTick.cellStates.entries(), ([cellId, state]) => [cellId, state.window] as const),
    );
    const positions: VanPosition[] = vanIds
      .map((id) => this.vans.get(id))
      .filter((v): v is VanState => v !== undefined)
      .map((v) => {
        const node = this.nodesById.get(v.currentNodeId)!;
        return { vanId: v.vanId, x: node.x, y: node.y };
      });

    // Phase B: pinned (human-overridden) vans keep the simple
    // nearest-shelter assignment -- a pin targets a specific cell, which
    // must belong to the SAME cluster the van ends up routed into for
    // routeTeamWithPin to find it; the reward-aware assignment below has
    // no notion of a pin and could send the van somewhere else entirely.
    const pinnedVanIds = new Set(vanIds.filter((id) => this.vans.get(id)?.pinnedCellId !== undefined));
    const pinnedPositions = positions.filter((p) => pinnedVanIds.has(p.vanId));
    const unpinnedPositions = positions.filter((p) => !pinnedVanIds.has(p.vanId));
    const pinnedByShelter = assignVansToClusters(pinnedPositions, this.clusters);

    // Every other (free) van: genuine fleet-wide assignment -- weighs
    // each zone's actual pending work, not just distance, and lets a van
    // travel to a DIFFERENT shelter's zone when that's a better use of
    // the fleet's time and it's still reachable within budget.
    const clusterPendingReward = new Map<string, number>();
    for (const cluster of this.clusters) {
      let reward = 0;
      for (const node of cluster.graph.nodes) {
        if (node.role !== "origin" || this.evacuatedCellIds.has(node.id)) continue;
        const state = this.lastTick.cellStates.get(node.id);
        if (!state || state.tier === "normal") continue;
        reward += priorities.get(node.id) ?? 0;
      }
      clusterPendingReward.set(cluster.shelterId, reward);
    }
    const vanRemainingMinutesMap = new Map<number, number>(
      unpinnedPositions.map((p) => [p.vanId, this.vans.get(p.vanId)!.remainingMinutes]),
    );
    const unpinnedByShelter = assignVansToClustersByReward(
      unpinnedPositions,
      this.clusters,
      clusterPendingReward,
      vanRemainingMinutesMap,
    );

    const byShelter = new Map<string, VanPosition[]>();
    for (const cluster of this.clusters) {
      byShelter.set(cluster.shelterId, [
        ...(pinnedByShelter.get(cluster.shelterId) ?? []),
        ...(unpinnedByShelter.get(cluster.shelterId) ?? []),
      ]);
    }
    const routes = new Map<number, Route>();

    for (const cluster of this.clusters) {
      const clusterVanPositions = byShelter.get(cluster.shelterId) ?? [];
      if (clusterVanPositions.length === 0) continue;

      const clusterVans = clusterVanPositions.map((p) => this.vans.get(p.vanId)!);
      const pinned = clusterVans.filter((v) => v.pinnedCellId !== undefined);
      const unpinned = clusterVans.filter((v) => v.pinnedCellId === undefined);
      const shelterCapacity = cluster.graph.nodesById.get(cluster.shelterId)?.capacity ?? 0;
      let demandServedSoFar = this.demandServedByShelter.get(cluster.shelterId) ?? 0;
      const visited = new Set<string>(this.evacuatedCellIds);

      // Pinned (human-overridden) vans are routed first, individually,
      // via routeTeamWithPin -- their claimed cell is then excluded for
      // everyone else in this cluster.
      for (const van of pinned) {
        const result = await routeTeamWithPin({
          graph: cluster.graph,
          currentNodeId: van.currentNodeId,
          depotNodeId: cluster.shelterId,
          pinnedCellId: van.pinnedCellId!,
          remainingMinutes: this.planningBudgetFor(van),
          shiftedGameStartMinutesOfDay: van.shiftedGameStartMinutesOfDay,
          weekday: this.config.weekday,
          priorities,
          riskScores,
          demandServedSoFar,
          shelterCapacity,
          alreadyVisited: visited,
          method: "greedy",
          deadlineWindows,
        });
        routes.set(van.vanId, result.route);
        for (const stop of result.route.stops) visited.add(stop.nodeId);
        demandServedSoFar += result.route.totalDemandServed;
        van.pinnedCellId = undefined;
        van.committedUntilMinutes = nowMinutes + (result.route.stops[0]?.departureMinutes ?? this.config.commitWindowMinutes);
      }

      // Phase B may have sent a van here from a DIFFERENT shelter's zone
      // -- its currentNodeId then won't exist in this cluster's own
      // precomputed graph (clusters are shelter-local by construction).
      // Those "foreign" vans can't go through the normal shared-graph
      // routeCluster pipeline below (exact/neural both assume every team
      // shares one precomputed graph); they're routed separately, just
      // after, sharing the same visited/demandServedSoFar bookkeeping so
      // neither group can double-claim a cell or over-fill the shelter.
      const homeVans = unpinned.filter((v) => cluster.graph.nodesById.has(v.currentNodeId));
      const foreignVans = unpinned.filter((v) => !cluster.graph.nodesById.has(v.currentNodeId));

      if (homeVans.length > 0) {
        const teams: ClusterTeam[] = homeVans.map((v) => ({
          teamId: v.vanId,
          currentNodeId: v.currentNodeId,
          remainingMinutes: this.planningBudgetFor(v),
          shiftedGameStartMinutesOfDay: v.shiftedGameStartMinutesOfDay,
        }));
        const ordered = resolveTeamProcessingOrder(cluster, teams, priorities);

        const result = await routeCluster({
          cluster,
          teams: ordered,
          weekday: this.config.weekday,
          priorities,
          riskScores,
          demandServedSoFar,
          shelterCapacity,
          alreadyVisited: visited,
          thresholds: thresholdsOverride ?? this.config.thresholds,
          exactTimeLimitSeconds: this.config.exactTimeLimitSeconds,
          exactSolver: this.config.exactSolver,
          deadlineWindows,
        });

        for (const [teamId, route] of result.routesByTeam) {
          routes.set(teamId, route);
          const van = this.vans.get(teamId)!;
          van.committedUntilMinutes = nowMinutes + (route.stops[0]?.departureMinutes ?? this.config.commitWindowMinutes);
          for (const stop of route.stops) visited.add(stop.nodeId);
          demandServedSoFar += route.totalDemandServed;
        }
      }

      for (const van of foreignVans) {
        const vanNode = this.nodesById.get(van.currentNodeId)!;
        const localGraph = buildGraph([vanNode, ...cluster.graph.nodes.filter((n) => n.id !== vanNode.id)]);
        const route = computeBaselineRoute({
          graph: localGraph,
          currentNodeId: van.currentNodeId,
          depotNodeId: cluster.shelterId,
          totalGameMinutes: this.planningBudgetFor(van),
          gameStartMinutesOfDay: van.shiftedGameStartMinutesOfDay,
          weekday: this.config.weekday,
          priorities,
          riskScores,
          demandServedSoFar,
          shelterCapacity,
          alreadyVisited: visited,
          deadlineWindows,
        });
        routes.set(van.vanId, route);
        for (const stop of route.stops) visited.add(stop.nodeId);
        demandServedSoFar += route.totalDemandServed;
        van.committedUntilMinutes = nowMinutes + (route.stops[0]?.departureMinutes ?? this.config.commitWindowMinutes);
      }
    }

    return routes;
  }
}

import Link from "next/link";
import { OptimizerMap } from "@/components/map/optimizer-map";
import { buildHeatmapGrid, type BinCellInput } from "@/components/map/risk-heatmap-binning";
import { tierForRiskScore } from "@/forecast/risk-tiers";
import { boundsAroundVan } from "../scale-preview/scene-data";
import { fullMapBounds, REAL_CSV_PATH, TICK_STEP_MINUTES, VAN_COLORS } from "./scene-data";
import { getSession, type VanState } from "./session";
import { advanceTick, simulateArrival, overrideVan, setSolverTier } from "./actions";

/**
 * Real-data preview: the actual Hurricane Idalia (Aug 2023) census-tract
 * forecast-cone dataset, run through the real solver stack (exact MILP /
 * neural Pointer Network + beam search / greedy -- session.ts's replan()
 * uses the same routeCluster/routeTeamWithPin dispatcher /rolling-horizon
 * does) with genuine event-driven state: masked (evacuated) tracts, human
 * override, and a tick loop -- the real counterpart to /rolling-horizon,
 * on real tract data instead of a synthetic forecast. No commit window:
 * every van is replanned on every tick, so a rerouted path is followed
 * immediately.
 *
 * What's intentionally different from /rolling-horizon: there's no
 * forecast engine here (the real cone already happened, so priority per
 * tract is a fixed real reward, not something that evolves), and fleet-
 * wide reassignment across shelters is NOT implemented -- every van stays
 * within its own shelter's cluster, per the explicit instruction that
 * excluded it. Population, shelter capacity, and time windows are still
 * placeholders (see real-cell-provider.ts) pending the real figures.
 */
export default async function IdaliaPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ focusVan?: string; selectVan?: string }>;
}) {
  const params = await searchParams;
  const focusVanId = params.focusVan !== undefined ? Number.parseInt(params.focusVan, 10) : undefined;
  const selectedVanId = params.selectVan !== undefined ? Number.parseInt(params.selectVan, 10) : undefined;

  const session = getSession();

  if (!session) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Hurricane Idalia -- real census-tract preview</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Waiting on the real dataset. Save <code className="rounded bg-muted px-1">Census_Tracts_Rewards.csv</code> to:
        </p>
        <pre className="mt-3 overflow-x-auto rounded border bg-muted/30 p-3 text-left text-xs">{REAL_CSV_PATH}</pre>
        <p className="mt-3 text-sm text-muted-foreground">then refresh this page.</p>
        <Link href="/rolling-horizon" className="mt-6 inline-block rounded border px-3 py-1.5 text-sm hover:bg-accent">
          Back to the synthetic rolling-horizon demo →
        </Link>
      </div>
    );
  }

  const { scenario, nodesById, cellIdToShelterId, vanRoutes, currentTick, solverTier, log } = session;
  const { cells, clusters, priorities, rewardByNodeId } = scenario;
  const vans = Array.from(session.vans.values());

  if (currentTick < 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Hurricane Idalia -- real census-tract live session</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {cells.filter((c) => c.role === "origin").length.toLocaleString()} real tracts, {clusters.length} shelters,{" "}
          {vans.length} vans. Starting runs the real solver stack for the first time -- tick 0, every van replanned
          every tick, no fleet-wide reassignment.
        </p>
        <form action={advanceTick} className="mt-5">
          <button type="submit" className="rounded border px-4 py-2 hover:bg-accent">
            Start simulation →
          </button>
        </form>
      </div>
    );
  }

  const binInputs: BinCellInput[] = cells
    .filter((n) => n.role === "origin" && !session.evacuatedCellIds.has(n.id))
    .map((node) => {
      const reward = rewardByNodeId.get(node.id) ?? 0;
      return { node, tier: tierForRiskScore(reward), riskScore: reward };
    });
  const heatmapGrid = buildHeatmapGrid(binInputs, 15);

  const vanMarkers = vans.map((v) => {
    const node = nodesById.get(v.currentNodeId)!;
    return { vanId: v.vanId, x: node.x, y: node.y, color: VAN_COLORS[v.vanId % VAN_COLORS.length], label: `Van ${v.vanId + 1}` };
  });

  const allVanRoutesForMap = Array.from(vanRoutes.entries()).map(([vanId, route]) => {
    const van = vans.find((v) => v.vanId === vanId);
    const startNode = van ? nodesById.get(van.currentNodeId) : undefined;
    const points: [number, number][] = startNode ? [[startNode.x, startNode.y]] : [];
    for (const stop of route.stops) {
      const node = nodesById.get(stop.nodeId);
      if (node) points.push([node.x, node.y]);
    }
    if (startNode) points.push([startNode.x, startNode.y]);
    return { vanId, points, color: VAN_COLORS[vanId % VAN_COLORS.length] };
  });
  const displayedVanRoutes = focusVanId !== undefined ? allVanRoutesForMap.filter((r) => r.vanId === focusVanId) : allVanRoutesForMap;

  const focusVan = focusVanId !== undefined ? vans.find((v) => v.vanId === focusVanId) : undefined;
  const focusVanShelterNode = focusVan ? nodesById.get(focusVan.currentNodeId) : undefined;
  const focusVanRoutePoints = allVanRoutesForMap.find((r) => r.vanId === focusVanId)?.points ?? [];

  const selectQS = (vanId?: number) => (vanId !== undefined ? `&selectVan=${vanId}` : "");
  const focusUrl = (vanId?: number) =>
    `/idalia-preview?${vanId !== undefined ? `focusVan=${vanId}` : ""}${selectQS(selectedVanId)}`.replace(/\?&/, "?");
  const selectUrl = (vanId?: number) =>
    `/idalia-preview?${focusVanId !== undefined ? `focusVan=${focusVanId}` : ""}${vanId !== undefined ? `&selectVan=${vanId}` : ""}`.replace(
      /\?&/,
      "?",
    );

  const routeStopNames = (vanId: number): string[] =>
    (vanRoutes.get(vanId)?.stops ?? []).map((s) => nodesById.get(s.nodeId)?.name ?? s.nodeId);

  // Why an idle van has no route: either its own shelter's catchment has
  // no un-evacuated tracts at all left, or it does, but none are
  // currently reachable within this van's time budget / the shelter's
  // capacity.
  const idleReason = (van: VanState): string => {
    const cluster = clusters.find((c) => c.shelterId === van.currentNodeId);
    if (!cluster) return "No route planned (shelter not found in any cluster).";
    const remaining = cluster.graph.nodes.filter((n) => n.role === "origin" && !session.evacuatedCellIds.has(n.id)).length;
    return remaining === 0
      ? "No un-evacuated tracts left in this shelter's catchment."
      : `${remaining} tract${remaining === 1 ? "" : "s"} still need evacuation nearby, but none reachable within this van's remaining time or the shelter's capacity right now.`;
  };

  const regionStatus = (cellId: string): string => {
    const vanId = Array.from(vanRoutes.entries()).find(([, route]) => route.stops.some((s) => s.nodeId === cellId))?.[0];
    if (vanId !== undefined) return `On Van ${vanId + 1}'s route`;
    const shelterId = cellIdToShelterId.get(cellId);
    const shelterVans = vans.filter((v) => v.currentNodeId === shelterId);
    if (shelterVans.length === 0) return "No van assigned to its nearest shelter";
    return "Not currently reachable (time budget or capacity)";
  };

  const remainingTracts = cells
    .filter((n) => n.role === "origin" && !session.evacuatedCellIds.has(n.id))
    .map((node) => ({ node, priority: priorities.get(node.id) ?? 0, reward: rewardByNodeId.get(node.id) ?? 0 }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 50);

  return (
    <div className="mx-auto flex h-screen max-w-7xl flex-col gap-4 px-4 py-6">
      <header>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            Hurricane Idalia -- tick {currentTick}, {session.evacuatedCellIds.size.toLocaleString()} / {cells.filter((c) => c.role === "origin").length.toLocaleString()} tracts evacuated
          </h1>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <form action={advanceTick}>
              <button type="submit" className="rounded border px-3 py-1 hover:bg-accent">
                Advance Tick (+{TICK_STEP_MINUTES}min) →
              </button>
            </form>
            <Link href="/rolling-horizon" className="rounded border px-2 py-1 text-xs hover:bg-accent">
              Synthetic demo →
            </Link>
            <Link href="/benchmark" className="rounded border px-2 py-1 text-xs hover:bg-accent">
              Reward benchmark →
            </Link>
          </div>
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Solver:</span>
          <form action={setSolverTier.bind(null, "fast")}>
            <button type="submit" className={`rounded px-2 py-1 ${solverTier === "fast" ? "bg-accent font-semibold" : "border hover:bg-accent/50"}`}>
              Fast (greedy)
            </button>
          </form>
          <form action={setSolverTier.bind(null, "real")}>
            <button type="submit" className={`rounded px-2 py-1 ${solverTier === "real" ? "bg-accent font-semibold" : "border hover:bg-accent/50"}`}>
              Real (exact + neural, by cluster size)
            </button>
          </form>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {vans.length} vans across {clusters.length} real shelters. No fleet-wide reassignment across shelters -- each van
          stays in its own shelter&apos;s cluster. Each tick = {TICK_STEP_MINUTES} simulated minutes, and every van is
          replanned on every tick -- no commit window, so a rerouted path is followed immediately.
        </p>
        <div className="mt-2 max-h-16 overflow-y-auto rounded border bg-muted/30 p-2 text-xs text-muted-foreground">
          {log.length === 0 ? "No events yet." : log.map((entry, i) => <p key={i}>{entry}</p>)}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-0 flex-1">
          <div className="mb-2 flex max-h-16 flex-wrap gap-1.5 overflow-y-auto">
            <Link
              href={focusUrl(undefined)}
              className={`rounded px-2 py-1 text-xs ${focusVanId === undefined ? "bg-accent font-semibold" : "border hover:bg-accent/50"}`}
            >
              Full map
            </Link>
            {vans.map((v) => (
              <Link
                key={v.vanId}
                href={focusUrl(v.vanId)}
                className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                  focusVanId === v.vanId ? "bg-accent font-semibold" : "border hover:bg-accent/50"
                }`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: VAN_COLORS[v.vanId % VAN_COLORS.length] }} />
                Van {v.vanId + 1}
              </Link>
            ))}
          </div>
          <OptimizerMap
            nodes={[]}
            edges={[]}
            priorities={{}}
            depotNodeId={vans[0] ? vans[0].currentNodeId : cells[0].id}
            heatmapGrid={heatmapGrid}
            vanMarkers={vanMarkers}
            vanRoutes={displayedVanRoutes}
            bounds={focusVanId !== undefined && focusVanShelterNode ? boundsAroundVan(focusVanShelterNode, focusVanRoutePoints) : fullMapBounds(cells)}
            interactive={false}
          />
        </div>

        <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
          <div className="shrink-0 rounded-lg border bg-card p-3">
            <h2 className="mb-2 text-sm font-semibold">Vans ({vans.length})</h2>
            {selectedVanId !== undefined && (
              <p className="mb-2 text-[11px] text-sky-400">Van {selectedVanId + 1} selected -- use the buttons on a tract below.</p>
            )}
            <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {vans.map((v) => {
                const stops = routeStopNames(v.vanId);
                return (
                  <li key={v.vanId} className="rounded border border-border/40 p-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: VAN_COLORS[v.vanId % VAN_COLORS.length] }} />
                        Van {v.vanId + 1}
                      </span>
                      <Link href={selectUrl(selectedVanId === v.vanId ? undefined : v.vanId)} className="text-sky-400 underline">
                        {selectedVanId === v.vanId ? "cancel" : "select"}
                      </Link>
                    </div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {stops.length === 0 ? idleReason(v) : <>Path: shelter → {stops.join(" → ")} → shelter</>}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>

          {focusVan && (
            <div className="shrink-0 rounded-lg border bg-card p-3">
              <h2 className="mb-2 text-sm font-semibold">Route -- Van {focusVan.vanId + 1}</h2>
              {routeStopNames(focusVan.vanId).length === 0 ? (
                <p className="text-xs text-muted-foreground">No route currently planned for this van.</p>
              ) : (
                <ol className="list-decimal space-y-1 pl-4 text-xs">
                  <li className="text-muted-foreground">Start: shelter (home base, van does not move on the map)</li>
                  {(vanRoutes.get(focusVan.vanId)?.stops ?? []).map((stop, i) => {
                    const node = nodesById.get(stop.nodeId);
                    return (
                      <li key={`${stop.nodeId}-${i}`}>
                        {node?.name ?? stop.nodeId}
                        {node ? ` (pop. ${node.demand.toLocaleString()})` : ""}
                      </li>
                    );
                  })}
                  <li className="text-muted-foreground">Return: shelter</li>
                </ol>
              )}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card p-3">
            <h2 className="mb-2 text-sm font-semibold">Top 50 tracts still needing evacuation (of {binInputs.length.toLocaleString()})</h2>
            <ul className="space-y-1.5">
              {remainingTracts.map(({ node, priority, reward }) => (
                <li key={node.id} className="rounded border border-border/50 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{node.name}</span>
                    <span className="shrink-0 rounded bg-rose-900 px-1.5 py-0.5 text-[10px] font-semibold text-white">priority {priority}</span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    Population: {node.demand.toLocaleString()} -- reward: {reward.toFixed(3)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{regionStatus(node.id)}</p>
                  {selectedVanId !== undefined && (
                    <div className="mt-1 flex gap-1.5">
                      <form action={simulateArrival.bind(null, selectedVanId, node.id, node.name)}>
                        <button type="submit" className="rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] text-emerald-400 hover:bg-emerald-950">
                          Simulate arrival
                        </button>
                      </form>
                      <form action={overrideVan.bind(null, selectedVanId, node.id, node.name)}>
                        <button type="submit" className="rounded border border-sky-700 px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-sky-950">
                          Override here
                        </button>
                      </form>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

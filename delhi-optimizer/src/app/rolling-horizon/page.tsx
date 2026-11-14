import Link from "next/link";
import { getAppSolverTier } from "@/lib/solver-preference";
import { OptimizerMap } from "@/components/map/optimizer-map";
import { ForecastCountdown } from "@/components/forecast-countdown";
import { buildHeatmapGrid, type BinCellInput } from "@/components/map/risk-heatmap-binning";
import { fullMapBounds, boundsAroundVan, VAN_COLORS } from "../scale-preview/scene-data";
import type { RiskTier } from "@/forecast/risk-tiers";
import { session, TICK_STEP_MINUTES, FORECAST_INTERVAL_SECONDS } from "./session";
import { advanceTick, simulateArrival, overrideVan, setSolverTier } from "./actions";

/**
 * The real, live RollingHorizonController (Phase 5) wired end-to-end --
 * not the simplified direct-tick-replay pattern /scale-preview and
 * /dashboard use. This page actually exercises the bounded lookahead (H)
 * those pages never touch. No commit window: every van is replanned on
 * every forecast tick, so a rerouted path is followed immediately rather
 * than waiting out a timer.
 *
 * Genuinely stateful: "Advance Tick" / "Simulate Arrival" / "Override"
 * mutate ONE global server-side session (session.ts) via Server Actions,
 * not URL params -- there is no "go back to a previous tick" here, since
 * the controller's state (evacuated cells, van positions) only ever
 * moves forward, same as a real live system would.
 *
 * Known simplification, stated plainly rather than hidden: a van's
 * currentNodeId never actually changes after simulateArrival() -- the
 * controller only marks the cell evacuated and replans from the van's
 * existing position (its home shelter). So vans are always shown at
 * their shelter, not "moving" to villages visually. This mirrors exactly
 * what the controller itself does today; fixing it would mean giving
 * RollingHorizonController a real concept of van position updates, which
 * is out of scope for this pass.
 */

export default async function RollingHorizonPage({
  searchParams,
}: {
  searchParams: Promise<{ focusVan?: string; selectVan?: string }>;
}) {
  const params = await searchParams;
  const focusVanId = params.focusVan !== undefined ? Number.parseInt(params.focusVan, 10) : undefined;
  const selectedVanId = params.selectVan !== undefined ? Number.parseInt(params.selectVan, 10) : undefined;

  const { cells, clusters, controller, currentTick, vanRoutes, log } = session;
  const solverTier = getAppSolverTier();
  const nodesById = new Map(cells.map((n) => [n.id, n]));
  const lastTick = controller.getLastTick();
  const vans = controller.getAllVans();

  if (currentTick < 0 || !lastTick) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold tracking-tight">Rolling Horizon -- live session</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Nothing has run yet. Starting registers {vans.length} vans across the region and runs the real
          RollingHorizonController for the first time -- forecast tick 0, bounded 3-hour lookahead (H). Every tick
          replans every van immediately, no commit window.
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
    .filter((n) => n.role === "origin")
    .map((node) => {
      const state = lastTick.cellStates.get(node.id)!;
      return { node, tier: state.tier, riskScore: state.riskScore };
    });
  const heatmapGrid = buildHeatmapGrid(binInputs, 15);

  const tierSeverity: Record<RiskTier, number> = { critical: 4, severe: 3, warning: 2, watch: 1, normal: 0 };
  const elevatedVillages = cells
    .filter((n) => n.role === "origin")
    .map((node) => ({ node, state: lastTick.cellStates.get(node.id)! }))
    .filter(({ state }) => state.tier !== "normal")
    .sort((a, b) => tierSeverity[b.state.tier] - tierSeverity[a.state.tier] || b.node.demand - a.node.demand);

  // Why an unserved region isn't being served: either no van is assigned
  // to its nearest shelter at all, or it's simply not reachable within
  // that van's remaining budget/capacity right now (no commit window to
  // blame -- every van is replanned fresh on every tick).
  const cellIdToShelterId = new Map<string, string>();
  for (const cluster of clusters) for (const n of cluster.graph.nodes) cellIdToShelterId.set(n.id, cluster.shelterId);
  const cellIdToVanId = new Map<string, number>();
  for (const [vanId, route] of vanRoutes) for (const stop of route.stops) cellIdToVanId.set(stop.nodeId, vanId);
  const regionStatus = (cellId: string): string => {
    const vanId = cellIdToVanId.get(cellId);
    if (vanId !== undefined) return `On Van ${vanId + 1}'s route`;
    const shelterId = cellIdToShelterId.get(cellId);
    const shelterVans = vans.filter((v) => v.currentNodeId === shelterId);
    if (shelterVans.length === 0) return "No van assigned to its nearest shelter";
    return "Not currently reachable (time budget or capacity)";
  };

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
  const displayedVanRoutes =
    focusVanId !== undefined ? allVanRoutesForMap.filter((r) => r.vanId === focusVanId) : allVanRoutesForMap;

  const focusVan = focusVanId !== undefined ? vans.find((v) => v.vanId === focusVanId) : undefined;
  const focusVanShelterNode = focusVan ? nodesById.get(focusVan.currentNodeId) : undefined;
  const focusVanRoutePoints = allVanRoutesForMap.find((r) => r.vanId === focusVanId)?.points ?? [];

  // Explicit, textual route order per van -- the map draws dashed lines,
  // but with 12 vans overlapping on the full map those are hard to read.
  // This spells out, in words, exactly which villages each van visits
  // and in what order, straight from the same route data the lines use.
  const routeStopNames = (vanId: number): string[] =>
    (vanRoutes.get(vanId)?.stops ?? []).map((s) => nodesById.get(s.nodeId)?.name ?? s.nodeId);

  // Why an idle van has no route: not just "no route planned" -- either
  // its own shelter's catchment genuinely has no at-risk village right
  // now, or it does, but none of them are currently reachable within this
  // van's own time budget / that shelter's remaining capacity. Tier
  // resets to "normal" on evacuation (CycloneForecastEngine.markEvacuated),
  // so an elevated tier here already means "still needs evacuating".
  const idleReason = (van: (typeof vans)[number]): string => {
    const cluster = clusters.find((c) => c.shelterId === van.currentNodeId);
    if (!cluster) return "No route planned (shelter not found in any cluster).";
    const atRiskNearby = cluster.graph.nodes.filter(
      (n) => n.role === "origin" && lastTick!.cellStates.get(n.id)?.tier !== "normal",
    ).length;
    return atRiskNearby === 0
      ? "No at-risk villages in this shelter's catchment area right now."
      : `${atRiskNearby} at-risk village${atRiskNearby === 1 ? "" : "s"} nearby, but none reachable within this van's remaining time or the shelter's capacity right now.`;
  };

  const selectQS = (vanId?: number) => (vanId !== undefined ? `&selectVan=${vanId}` : "");
  const focusUrl = (vanId?: number) =>
    `/rolling-horizon?${vanId !== undefined ? `focusVan=${vanId}` : ""}${selectQS(selectedVanId)}`.replace(/\?&/, "?");
  const selectUrl = (vanId?: number) =>
    `/rolling-horizon?${focusVanId !== undefined ? `focusVan=${focusVanId}` : ""}${vanId !== undefined ? `&selectVan=${vanId}` : ""}`.replace(
      /\?&/,
      "?",
    );

  return (
    <div className="mx-auto flex h-screen max-w-7xl flex-col gap-4 px-4 py-6">
      <header>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            Live rolling horizon -- tick {currentTick}, storm near the {lastTick.zone.concentration}
          </h1>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <ForecastCountdown nextUpdateIso={lastTick.zone.nextUpdateIso} />
            <form action={advanceTick}>
              <button type="submit" className="rounded border px-3 py-1 hover:bg-accent">
                Advance Tick (+{TICK_STEP_MINUTES}min) →
              </button>
            </form>
            <Link href="/dashboard" className="rounded border px-2 py-1 text-xs hover:bg-accent">
              URL-driven view →
            </Link>
            <Link href="/benchmark" className="rounded border px-2 py-1 text-xs hover:bg-accent">
              Reward benchmark →
            </Link>
            <Link href="/idalia-preview" className="rounded border px-2 py-1 text-xs hover:bg-accent">
              Same planner on real Idalia data →
            </Link>
          </div>
        </div>
        {/* Solver tier: "fast" (greedy, the long-standing default) vs
            "real" (the actual trained Pointer Network + beam search).
            Measured on this exact session shape: fast ~150ms/tick, real
            ~5s/tick -- real exists and works, it's just slower, so it's
            opt-in rather than forced on everyone. Exact MILP is never an
            option here at all (measured ~125s/tick at this scale --
            genuinely unusable, not just slow). */}
        <div className="mt-2 flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Solver:</span>
          <form action={setSolverTier.bind(null, "fast")}>
            <button
              type="submit"
              className={`rounded px-2 py-1 ${solverTier === "fast" ? "bg-accent font-semibold" : "border hover:bg-accent/50"}`}
            >
              Fast (greedy, ~150ms/tick)
            </button>
          </form>
          <form action={setSolverTier.bind(null, "real")}>
            <button
              type="submit"
              className={`rounded px-2 py-1 ${solverTier === "real" ? "bg-accent font-semibold" : "border hover:bg-accent/50"}`}
            >
              Real (trained Pointer Network + beam search, ~5s/tick)
            </button>
          </form>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {vans.length} vans registered region-wide (not just near the storm -- Phase 4&apos;s assignVansToClusters
          picks whoever&apos;s actually closest each replan). Each tick = {TICK_STEP_MINUTES} simulated minutes, and
          every van is replanned on every tick -- no commit window, so a rerouted path is followed immediately.
          Real-world forecast cadence (p) stays {FORECAST_INTERVAL_SECONDS / 3600}h, shown by the countdown above --
          the tick step is this page&apos;s own simulated clock, not the same thing.
        </p>
        <div className="mt-2 max-h-16 overflow-y-auto rounded border bg-muted/30 p-2 text-xs text-muted-foreground">
          {log.length === 0 ? "No events yet." : log.map((entry, i) => <p key={i}>{entry}</p>)}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-0 flex-1">
          <div className="mb-2 flex flex-wrap gap-1.5">
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
            nodes={vans.map((v) => nodesById.get(v.currentNodeId)!).filter(Boolean)}
            edges={[]}
            priorities={{}}
            depotNodeId={vans[0] ? vans[0].currentNodeId : cells[0].id}
            heatmapGrid={heatmapGrid}
            vanMarkers={vanMarkers}
            vanRoutes={displayedVanRoutes}
            bounds={
              focusVanId !== undefined && focusVanShelterNode
                ? boundsAroundVan(focusVanShelterNode, focusVanRoutePoints)
                : fullMapBounds(cells)
            }
            interactive={false}
          />
        </div>

        <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
          <div className="shrink-0 rounded-lg border bg-card p-3">
            <h2 className="mb-2 text-sm font-semibold">Vans ({vans.length})</h2>
            {selectedVanId !== undefined && (
              <p className="mb-2 text-[11px] text-sky-400">
                Van {selectedVanId + 1} selected -- use the buttons on a village below.
              </p>
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
                      {stops.length === 0 ? (
                        idleReason(v)
                      ) : (
                        <>
                          Path: shelter → {stops.join(" → ")} → shelter
                        </>
                      )}
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
            <h2 className="mb-2 text-sm font-semibold">Villages needing evacuation ({elevatedVillages.length})</h2>
            <ul className="space-y-1.5">
              {elevatedVillages.map(({ node, state }) => (
                <li key={node.id} className="rounded border border-border/50 p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{node.name}</span>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white"
                      style={{
                        backgroundColor: {
                          watch: "#a16207",
                          warning: "#c2410c",
                          severe: "#dc2626",
                          critical: "#7f1d1d",
                        }[state.tier as "watch" | "warning" | "severe" | "critical"],
                      }}
                    >
                      {state.tier}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">Population: {node.demand.toLocaleString()}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{regionStatus(node.id)}</p>
                  {selectedVanId !== undefined && (
                    <div className="mt-1 flex gap-1.5">
                      <form action={simulateArrival.bind(null, selectedVanId, node.id, node.name)}>
                        <button
                          type="submit"
                          className="rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] text-emerald-400 hover:bg-emerald-950"
                        >
                          Simulate arrival
                        </button>
                      </form>
                      <form action={overrideVan.bind(null, selectedVanId, node.id, node.name)}>
                        <button
                          type="submit"
                          className="rounded border border-sky-700 px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-sky-950"
                        >
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

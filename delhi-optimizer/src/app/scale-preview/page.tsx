import { OptimizerMap } from "@/components/map/optimizer-map";
import Link from "next/link";
import {
  buildSceneData,
  boundsAroundStorm,
  MAX_TICK,
  VAN_COLORS,
  FORECAST_INTERVAL_SECONDS,
} from "./scene-data";

/**
 * Phase 6 demo/reachability page: proves the Phase 0-2 + Phase 6 pipeline
 * (synthetic 20,000-cell generation -> forecast tick -> heatmap binning ->
 * rendered map) actually runs end-to-end and is reachable in a browser --
 * NOT a page the live multiplayer game links to or uses. The real game
 * still runs on the small, hand-authored EVACUATION_NODES scenario; wiring
 * the 20,000-cell system into real sessions (DB schema, API routes, a real
 * fleet of player-controlled vans) is separate, not-yet-done work.
 *
 * Zoomed to the storm's extent -- see /dashboard for the full-map
 * overview of the same underlying scene (shared via scene-data.ts so the
 * two views can't drift apart).
 *
 * All interactive state (tick, evacuated villages, van override/pin) is
 * carried entirely in the URL, not component state or a database -- see
 * scene-data.ts's buildSceneData() doc comment for why.
 */

export default async function ScalePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ tick?: string; evacuated?: string; selectVan?: string; pin?: string; viewVan?: string }>;
}) {
  const params = await searchParams;
  const requestedTick = Math.min(MAX_TICK, Math.max(0, Number.parseInt(params.tick ?? "0", 10) || 0));
  const evacuatedIds = new Set((params.evacuated ?? "").split(",").filter(Boolean));
  const selectedVanId = params.selectVan !== undefined ? Number.parseInt(params.selectVan, 10) : undefined;
  const [pinnedVanIdRaw, pinnedVillageId] = (params.pin ?? "").split(":");
  const pinnedVanId = pinnedVanIdRaw !== undefined && pinnedVanIdRaw !== "" ? Number.parseInt(pinnedVanIdRaw, 10) : undefined;
  const viewVanId = params.viewVan !== undefined ? Number.parseInt(params.viewVan, 10) : undefined;

  const scene = await buildSceneData(requestedTick, evacuatedIds, pinnedVanId, pinnedVillageId);
  const {
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
  } = scene;

  const evacQS = evacuatedIds.size > 0 ? `&evacuated=${[...evacuatedIds].join(",")}` : "";
  const pinQS = pinnedVanId !== undefined && pinnedVillageId ? `&pin=${pinnedVanId}:${pinnedVillageId}` : "";
  const viewVanQS = viewVanId !== undefined ? `&viewVan=${viewVanId}` : "";

  const urlFor = (t: number, extraEvacuatedId?: string) => {
    const ids = extraEvacuatedId ? [...evacuatedIds, extraEvacuatedId] : [...evacuatedIds];
    const ev = ids.length > 0 ? `&evacuated=${ids.join(",")}` : "";
    return `/scale-preview?tick=${t}${ev}${pinQS}${viewVanQS}`;
  };
  const selectVanUrl = (vanId: number) => `/scale-preview?tick=${requestedTick}${evacQS}${viewVanQS}&selectVan=${vanId}`;
  const cancelSelectUrl = () => `/scale-preview?tick=${requestedTick}${evacQS}${pinQS}${viewVanQS}`;
  const pinUrl = (vanId: number, villageId: string) =>
    `/scale-preview?tick=${requestedTick}${evacQS}${viewVanQS}&pin=${vanId}:${villageId}`;
  const clearPinUrl = () => `/scale-preview?tick=${requestedTick}${evacQS}${viewVanQS}`;
  // Tabs: pick one van's route to show in isolation, or "All" to see
  // every responding van's route at once (the previous default).
  const viewVanUrl = (vanId?: number) =>
    `/scale-preview?tick=${requestedTick}${evacQS}${pinQS}${vanId !== undefined ? `&viewVan=${vanId}` : ""}`;
  const displayedVanRoutes = viewVanId !== undefined ? vanRoutes.filter((r) => r.vanId === viewVanId) : vanRoutes;

  return (
    <div className="mx-auto flex h-screen max-w-7xl flex-col gap-4 px-4 py-6">
      <header>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            Cyclone risk near the {tick.zone.concentration} -- {elevatedCount} villages (
            {totalPopulationAtRisk.toLocaleString()} people) need evacuation
          </h1>
          <div className="flex shrink-0 items-center gap-2 text-sm">
            <Link
              href={urlFor(Math.max(0, requestedTick - 1))}
              aria-disabled={requestedTick === 0}
              className={`rounded border px-2 py-1 ${requestedTick === 0 ? "pointer-events-none opacity-40" : "hover:bg-accent"}`}
            >
              ← Prev
            </Link>
            <span className="rounded bg-muted px-2 py-1 font-mono text-xs">
              Tick {requestedTick} / {MAX_TICK}
            </span>
            <Link
              href={urlFor(Math.min(MAX_TICK, requestedTick + 1))}
              aria-disabled={requestedTick === MAX_TICK}
              className={`rounded border px-2 py-1 ${requestedTick === MAX_TICK ? "pointer-events-none opacity-40" : "hover:bg-accent"}`}
            >
              Next Tick →
            </Link>
            <Link
              href={`/dashboard?tick=${requestedTick}${evacQS}${pinQS}`}
              className="rounded border px-2 py-1 hover:bg-accent"
            >
              Full-map view →
            </Link>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {respondingShelters.length} shelters and {vanMarkers.length} vans shown near the danger zone, with{" "}
          {vanRoutes.length} real computed response route{vanRoutes.length === 1 ? "" : "s"} (via the actual greedy
          solver). Forecast
          generated {new Date(tick.zone.generatedAtIso).toLocaleString()}, next update{" "}
          {new Date(tick.zone.nextUpdateIso).toLocaleString()} (every {FORECAST_INTERVAL_SECONDS / 3600}h). Each
          tick replays the forecast engine from 0, so risk tiers escalate and deadlines tighten the longer a village
          goes un-evacuated -- this is the TOCPUR-style reward accumulation actually running, not a mockup.
        </p>
        {evacuatedIds.size > 0 && (
          <p className="mt-1 text-xs text-emerald-400">
            {evacuatedIds.size} village{evacuatedIds.size === 1 ? "" : "s"} marked evacuated this session -- masked
            from every van&apos;s candidates and excluded from the heatmap/list below.{" "}
            <Link href={`/scale-preview?tick=${requestedTick}`} className="underline hover:text-emerald-300">
              Reset evacuations
            </Link>
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Full synthetic scenario: {cells.length.toLocaleString()} cells, {shelters.length} shelter catchments,{" "}
          {heatmapGrid.bins.length.toLocaleString()} heatmap bins ({heatmapGrid.binSizeKm}km each) -- this view is
          zoomed to the storm, not the full extent. ({tierCounts.critical} critical, {tierCounts.severe} severe,{" "}
          {tierCounts.warning} warning, {tierCounts.watch} watch, {tierCounts.normal.toLocaleString()} normal.)
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(
            [
              ["normal", "#334155"],
              ["watch", "#facc15"],
              ["warning", "#f97316"],
              ["severe", "#ef4444"],
              ["critical", "#991b1b"],
            ] as const
          ).map(([tier, color]) => (
            <span key={tier} className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
              {tier}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
            shelter
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-sky-400" />
            van
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full border border-amber-400" />
            forecast storm rings (dashed on map)
          </span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-0 flex-1">
          {/* Only the ~250 shelters are shipped to the client, not all
              20,000 cells -- heatmap mode never renders per-node markers,
              and `bounds` is computed server-side instead of being derived
              from the full node list. Measured: this dropped the page's
              RSC payload from ~16.5MB to a small fraction of that. */}
          {/* Van tabs -- pick one van's route to view in isolation, or
              "All" to see every responding van's route at once. Pure
              display filtering of the already-computed vanRoutes, no
              recomputation. Every tab is always clickable: a van with no
              current route (no elevated village assigned to it right
              now) still selects fine -- the map just shows its marker
              alone, explained below, instead of a disabled-looking tab. */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Link
              href={viewVanUrl(undefined)}
              className={`rounded px-2 py-1 text-xs ${viewVanId === undefined ? "bg-accent font-semibold" : "border hover:bg-accent/50"}`}
            >
              All vans
            </Link>
            {respondingShelters.flatMap((_, s) =>
              // Two vans per shelter (matches vanMarkers below) -- only the
              // first (vanId = s*2) ever gets a computed route today, the
              // second is a parked reserve van. Both still need a tab:
              // showing a marker on the map for a van with no tab at all
              // looked like a bug (it was indistinguishable from one).
              [0, 1].map((i) => {
                const vanId = s * 2 + i;
                const hasRoute = vanRoutes.some((r) => r.vanId === vanId);
                return (
                  <Link
                    key={vanId}
                    href={viewVanUrl(vanId)}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                      viewVanId === vanId ? "bg-accent font-semibold" : "border hover:bg-accent/50"
                    } ${hasRoute ? "" : "text-muted-foreground"}`}
                  >
                    <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: VAN_COLORS[vanId % VAN_COLORS.length] }} />
                    Van {vanId + 1}
                    {!hasRoute && <span className="opacity-60">(idle)</span>}
                  </Link>
                );
              }),
            )}
          </div>
          {viewVanId !== undefined && !vanRoutes.some((r) => r.vanId === viewVanId) && (
            <p className="mb-2 text-xs text-muted-foreground">
              Van {viewVanId + 1} has no village currently assigned to it (none of the at-risk villages are nearest
              to its shelter right now) -- showing its marker only.
            </p>
          )}
          <OptimizerMap
            nodes={shelters}
            edges={[]}
            priorities={{}}
            depotNodeId={depotNodeId}
            heatmapGrid={heatmapGrid}
            vanMarkers={vanMarkers}
            vanRoutes={displayedVanRoutes}
            riskRings={riskRings}
            bounds={boundsAroundStorm(tick.zone.centerX, tick.zone.centerY, outerRadiusKm)}
            interactive={false}
          />
        </div>

        <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
          {/* Human override (Phase 4/5): select a van here, then click
              "Pin here" on a village below. Wires routeTeamWithPin()
              directly, since this page has no live RollingHorizonController
              session to call onHumanOverride() against. */}
          <div className="shrink-0 rounded-lg border bg-card p-3">
            <h2 className="mb-2 text-sm font-semibold">Vans ({respondingShelters.length * 2})</h2>
            {selectedVanId !== undefined && (
              <p className="mb-2 text-[11px] text-sky-400">
                Selecting Van {selectedVanId + 1} -- click &quot;Pin here&quot; on a village below.
              </p>
            )}
            <ul className="space-y-1">
              {respondingShelters.flatMap((shelter, s) =>
                [0, 1].map((i) => {
                  const vanId = s * 2 + i;
                  const isPinned = pinnedVanId === vanId;
                  const isSelecting = selectedVanId === vanId;
                  return (
                    <li key={vanId} className="flex items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: VAN_COLORS[vanId % VAN_COLORS.length] }}
                        />
                        Van {vanId + 1} ({shelter.name})
                      </span>
                      {isPinned ? (
                        <Link href={clearPinUrl()} className="text-amber-400 underline">
                          {pinHonored ? "pinned -- clear" : "pin unreachable -- clear"}
                        </Link>
                      ) : isSelecting ? (
                        <Link href={cancelSelectUrl()} className="text-muted-foreground underline">
                          cancel
                        </Link>
                      ) : (
                        <Link href={selectVanUrl(vanId)} className="text-sky-400 underline">
                          override →
                        </Link>
                      )}
                    </li>
                  );
                }),
              )}
            </ul>
          </div>

          {viewVanId !== undefined && (
            <div className="shrink-0 rounded-lg border bg-card p-3">
              <h2 className="mb-2 text-sm font-semibold">Route -- Van {viewVanId + 1}</h2>
              {(() => {
                const stops = vanRoutes.find((r) => r.vanId === viewVanId)?.stops ?? [];
                if (stops.length === 0) {
                  return <p className="text-xs text-muted-foreground">No route currently planned for this van.</p>;
                }
                const totalPop = stops.reduce((sum, s) => sum + s.demand, 0);
                return (
                  <>
                    <p className="mb-1 text-[11px] text-muted-foreground">
                      {stops.length} village{stops.length === 1 ? "" : "s"} on this route --{" "}
                      {totalPop.toLocaleString()} people total
                    </p>
                    <ol className="list-decimal space-y-1 pl-4 text-xs">
                      {stops.map((stop, i) => (
                        <li key={`${stop.nodeId}-${i}`}>
                          {stop.name} (pop. {stop.demand.toLocaleString()})
                        </li>
                      ))}
                    </ol>
                  </>
                );
              })()}
            </div>
          )}

          {/* The actual "where and how many" list the heatmap aggregates
              away. Only lists the elevated villages (~67 here), not all
              20,000 -- that's a normal list length, unlike the full dataset. */}
          <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border bg-card p-3">
            <h2 className="mb-2 text-sm font-semibold">Villages needing evacuation ({elevatedVillages.length})</h2>
            <ul className="space-y-1.5">
              {elevatedVillages.map(({ node, state, nearestShelter }) => (
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
                  <p className="mt-0.5 text-muted-foreground">
                    Population: {node.demand.toLocaleString()} -- nearest shelter: {nearestShelter?.name ?? "?"}
                  </p>
                  <div className="mt-1 flex gap-1.5">
                    <Link
                      href={urlFor(requestedTick, node.id)}
                      className="inline-block rounded border border-emerald-700 px-1.5 py-0.5 text-[10px] text-emerald-400 hover:bg-emerald-950"
                    >
                      Mark evacuated
                    </Link>
                    {selectedVanId !== undefined && (
                      <Link
                        href={pinUrl(selectedVanId, node.id)}
                        className="inline-block rounded border border-sky-700 px-1.5 py-0.5 text-[10px] text-sky-400 hover:bg-sky-950"
                      >
                        Pin Van {selectedVanId + 1} here
                      </Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

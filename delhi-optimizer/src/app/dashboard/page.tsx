import { OptimizerMap } from "@/components/map/optimizer-map";
import { ForecastCountdown } from "@/components/forecast-countdown";
import Link from "next/link";
import {
  buildSceneData,
  fullMapBounds,
  boundsAroundVan,
  MAX_TICK,
  VAN_COLORS,
} from "../scale-preview/scene-data";

/**
 * THE central home page: full-map overview by default (every shelter,
 * every risk region, every van), and selecting a van zooms the SAME page
 * to that van's shelter + its computed route -- one page, one flow, not
 * two separate pages linked together. /scale-preview (storm-zoomed, no
 * van-zoom) still exists unchanged as an alternate view, but this is the
 * primary one.
 *
 * All interactive state -- tick, evacuated villages, van zoom/selection,
 * human override pin -- lives entirely in the URL (see scene-data.ts's
 * buildSceneData() doc comment for why), except the forecast countdown,
 * which is the one thing that genuinely needs to tick in the browser
 * between page loads (see ForecastCountdown).
 */

export default async function DashboardPage({
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
    return `/dashboard?tick=${t}${ev}${pinQS}${viewVanQS}`;
  };
  const selectVanUrl = (vanId: number) => `/dashboard?tick=${requestedTick}${evacQS}${viewVanQS}&selectVan=${vanId}`;
  const cancelSelectUrl = () => `/dashboard?tick=${requestedTick}${evacQS}${pinQS}${viewVanQS}`;
  const pinUrl = (vanId: number, villageId: string) =>
    `/dashboard?tick=${requestedTick}${evacQS}${viewVanQS}&pin=${vanId}:${villageId}`;
  const clearPinUrl = () => `/dashboard?tick=${requestedTick}${evacQS}${viewVanQS}`;
  const viewVanUrl = (vanId?: number) =>
    `/dashboard?tick=${requestedTick}${evacQS}${pinQS}${vanId !== undefined ? `&viewVan=${vanId}` : ""}`;
  const displayedVanRoutes = viewVanId !== undefined ? vanRoutes.filter((r) => r.vanId === viewVanId) : vanRoutes;

  return (
    <div className="mx-auto flex h-screen max-w-7xl flex-col gap-4 px-4 py-6">
      <header>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">
            Full region overview -- {shelters.length} shelters, {cells.length.toLocaleString()} cells,{" "}
            {elevatedCount} villages at risk
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
            <ForecastCountdown nextUpdateIso={tick.zone.nextUpdateIso} />
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Storm near the {tick.zone.concentration} -- {totalPopulationAtRisk.toLocaleString()} people at risk,{" "}
          {vanRoutes.length} real computed response route{vanRoutes.length === 1 ? "" : "s"}. Forecast generated{" "}
          {new Date(tick.zone.generatedAtIso).toLocaleString()}, next update {new Date(tick.zone.nextUpdateIso).toLocaleString()}.
          Select a van below to zoom in on its route, or{" "}
          <Link href={`/scale-preview?tick=${requestedTick}${evacQS}${pinQS}`} className="underline hover:text-foreground">
            open the storm-zoomed alternate view
          </Link>
          .
        </p>
        {evacuatedIds.size > 0 && (
          <p className="mt-1 text-xs text-emerald-400">
            {evacuatedIds.size} village{evacuatedIds.size === 1 ? "" : "s"} marked evacuated this session.{" "}
            <Link href={`/dashboard?tick=${requestedTick}`} className="underline hover:text-emerald-300">
              Reset evacuations
            </Link>
          </p>
        )}
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
              {tier}: {tierCounts[tier].toLocaleString()}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-red-500" />
            shelter ({shelters.length} total)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-full bg-sky-400" />
            van
          </span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 gap-4">
        <div className="min-h-0 flex-1">
          {/* Van selector -- pick one van to zoom the map in on its own
              shelter + computed route, or "Full map" to see every
              shelter, every risk region, and every van at once. Every
              tab is always clickable: a van with no current route still
              zooms in fine -- the map just shows its marker alone,
              explained below, instead of looking broken. */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            <Link
              href={viewVanUrl(undefined)}
              className={`rounded px-2 py-1 text-xs ${viewVanId === undefined ? "bg-accent font-semibold" : "border hover:bg-accent/50"}`}
            >
              Full map
            </Link>
            {respondingShelters.flatMap((_, s) =>
              // Two vans per shelter -- both can be dispatched now
              // (villages are split between them when there's enough
              // demand), so both need a tab, not just the first.
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
              to its shelter right now) -- zoomed to its shelter, showing its marker only.
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
            bounds={
              viewVanId !== undefined
                ? boundsAroundVan(
                    respondingShelters[Math.floor(viewVanId / 2)] ?? shelters[0],
                    vanRoutes.find((r) => r.vanId === viewVanId)?.points ?? [],
                  )
                : fullMapBounds(cells)
            }
            interactive={false}
          />
        </div>

        <div className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto">
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

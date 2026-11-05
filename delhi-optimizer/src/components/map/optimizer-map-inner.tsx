"use client";

import { useMemo, useState } from "react";
import type { GraphNode, Edge } from "@/types/graph";
import type { Route, InfeasibilityReason } from "@/types/game";
import { buildNodeLabels } from "@/lib/node-labels";
import type { HeatmapGrid, HeatmapBin } from "./risk-heatmap-binning";
import type { RiskTier } from "@/forecast/risk-tiers";

/**
 * Abstract disaster-area network visualization -- a plain SVG canvas with a
 * coordinate grid, NOT a real-world map. There is no basemap tile layer and
 * no dependency on any mapping library: every node is plotted from its
 * synthetic (x, y) plane position (see src/types/graph.ts), and the whole
 * thing scales via the SVG viewBox, so it stays legible at any container
 * size without a tile provider. Static view -- no pan/zoom -- kept simple
 * and consistently framed on purpose.
 */

export interface MapRiskRing {
  centerX: number;
  centerY: number;
  radiusKm: number;
  level: "high" | "medium" | "low";
}

export interface MapPlayer {
  id: number;
  name: string;
  color: string;
  currentNodeId: string;
}

export interface OptimizerMapProps {
  nodes: GraphNode[];
  edges: Edge[];
  priorities: Record<string, number>;
  depotNodeId: string;
  /** The recommended/baseline route PREVIEW from the current position --
   * not yet traveled, drawn as a dashed line. */
  route?: Route;
  /** An additional route to overlay for comparison (e.g. the exact HiGHS
   * benchmark's plan for this player) -- drawn as a distinct dotted purple
   * line, independent of `route`. */
  secondaryRoute?: Route;
  /** The player's ACTUAL traveled path so far, in visit order (starting at
   * the depot) -- drawn as a solid line, distinct from the preview above. */
  visitedPath?: string[];
  selectedNodeId?: string;
  onSelectNode?: (nodeId: string) => void;
  /** This player's actual current position, if different from depotNodeId. */
  currentNodeId?: string;
  feasibleNodeIds?: string[];
  /** Why each currently-infeasible node is blocked, keyed by nodeId --
   * shown in the hover detail panel instead of a generic "not reachable". */
  infeasibleReasons?: Record<string, InfeasibilityReason>;
  otherPlayers?: MapPlayer[];
  /** MOCK forecast risk rings -- always geometry only, rendered with a
   * clear simulation label. */
  riskRings?: MapRiskRing[];
  interactive?: boolean;
  /** Phase 6 (dashboard at scale): when provided, renders this aggregated
   * heatmap grid (see risk-heatmap-binning.ts) as a colored background
   * and SKIPS per-node circles/labels/hover entirely -- the only way
   * 20,000 cells stay renderable in a browser (one DOM element per bin,
   * not per node). Omitted (the default): renders exactly as before,
   * one marker per node -- existing callers and the small-scenario game
   * are completely unaffected by this prop's existence. Heatmap bins are
   * display-only in this pass (no hover/click yet); per-cell detail at
   * scale is a known follow-up, not built here. */
  heatmapGrid?: HeatmapGrid;
  /** Live van positions, rendered as the interactive layer when
   * heatmapGrid is active (replacing per-village markers at scale). */
  vanMarkers?: MapVanMarker[];
  /** Planned routes for multiple vans at once -- distinct from the single
   * `route`/`secondaryRoute` props above (which are for one player's own
   * preview). Points are plain (x, y) pairs, already resolved by the
   * caller, so this component never needs a nodeById lookup across
   * several different vans' potentially-different local graphs. */
  vanRoutes?: { vanId: number; points: [number, number][]; color: string }[];
  /** Explicit viewBox bounds, bypassing the usual "derive min/max from
   * `nodes`" computation. For large-scale (heatmap-mode) callers: shipping
   * every node's full object to the client just to compute a bounding box
   * is wasteful once there are thousands of them -- pass `bounds` and a
   * much smaller (or empty) `nodes` array instead. Measured: a 20,000-node
   * scale-preview page dropped from ~16.5MB to a small fraction of that
   * once bounds no longer required the full node list. */
  bounds?: Bounds;
}

export interface MapVanMarker {
  vanId: number;
  x: number;
  y: number;
  color: string;
  label?: string;
}

const RISK_COLORS: Record<MapRiskRing["level"], string> = { high: "#dc2626", medium: "#f97316", low: "#facc15" };
const TIER_COLORS: Record<RiskTier, string> = {
  normal: "#1e293b",
  watch: "#facc15",
  warning: "#f97316",
  severe: "#ef4444",
  critical: "#991b1b",
};
const VIEWBOX_PADDING_KM = 6;
const GRID_STEP_KM = 5;

function markerRadius(demand: number, maxDemand: number): number {
  if (maxDemand <= 0) return 0.42;
  return 0.42 + Math.max(0, Math.min(1, demand / maxDemand)) * 0.5;
}

const LINE_OFFSET = 0.22;

/** Shifts a segment sideways, perpendicular to its own direction, by
 * `offset` -- used to keep two route lines that happen to follow a similar
 * path from visually fusing into one tangled mess when both are shown at
 * once. */
function offsetSegment(x1: number, y1: number, x2: number, y2: number, offset: number): [number, number, number, number] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = (-dy / len) * offset;
  const ny = (dx / len) * offset;
  return [x1 + nx, y1 + ny, x2 + nx, y2 + ny];
}

/** SVG path `d` for a 5-point star centered at (cx, cy), used for the
 * depot/shelter marker so it reads as a distinct landmark rather than
 * just another circle. */
function starPath(cx: number, cy: number, outerR: number, innerR: number): string {
  const points = 5;
  const step = Math.PI / points;
  const coords: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = i * step - Math.PI / 2;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    coords.push(`${i === 0 ? "M" : "L"}${x.toFixed(4)},${y.toFixed(4)}`);
  }
  return `${coords.join(" ")} Z`;
}

const INFEASIBLE_REASON_LABELS: Record<InfeasibilityReason, string> = {
  already_done: "You're already here, or it's already been evacuated.",
  closed_today: "Not accessible at all today.",
  time_window: "Can't arrive and finish within its access window from here.",
  time_budget: "Reachable in time, but you couldn't get back to the shelter before your session time runs out.",
  shelter_capacity: "The shelter doesn't have enough remaining capacity for this village's population.",
  vehicle_capacity: "This van doesn't have enough remaining onboard capacity for this village's population.",
};

export interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export default function OptimizerMapInner({
  nodes,
  edges,
  priorities,
  depotNodeId,
  route,
  secondaryRoute,
  visitedPath,
  selectedNodeId,
  onSelectNode,
  currentNodeId,
  feasibleNodeIds,
  infeasibleReasons,
  otherPlayers,
  riskRings,
  interactive = true,
  heatmapGrid,
  vanMarkers,
  vanRoutes,
  bounds: boundsOverride,
}: OptimizerMapProps) {
  const isHeatmapMode = heatmapGrid !== undefined;
  const [hoveredNodeId, setHoveredNodeId] = useState<string | undefined>(undefined);
  // Per-node circles (and their hover handlers below) only render outside
  // heatmap mode -- at 20,000-cell scale there's no per-node shape to
  // hover at all, so "hover a node" could never do anything. This gives
  // heatmap mode its own hoverable target: the aggregated bin itself.
  const [hoveredBin, setHoveredBin] = useState<HeatmapBin | undefined>(undefined);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const maxDemand = useMemo(() => Math.max(1, ...nodes.map((n) => n.demand)), [nodes]);
  const nodeLabels = useMemo(() => buildNodeLabels(nodes, depotNodeId), [nodes, depotNodeId]);
  const visitedSet = useMemo(() => new Set(visitedPath ?? []), [visitedPath]);
  const feasibleSet = useMemo(() => new Set(feasibleNodeIds ?? []), [feasibleNodeIds]);

  const bounds: Bounds = useMemo(() => {
    if (boundsOverride) return boundsOverride;
    if (nodes.length === 0) return { minX: 0, minY: 0, width: 1, height: 1 };
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - VIEWBOX_PADDING_KM;
    const minY = Math.min(...ys) - VIEWBOX_PADDING_KM;
    const width = Math.max(...xs) - Math.min(...xs) + VIEWBOX_PADDING_KM * 2;
    const height = Math.max(...ys) - Math.min(...ys) + VIEWBOX_PADDING_KM * 2;
    return { minX, minY, width: Math.max(width, 1), height: Math.max(height, 1) };
  }, [nodes, boundsOverride]);

  // Scaled to the map's actual span, not a fixed km value -- a fixed
  // 0.45km radius is invisible against a 600km-wide, 15km-binned heatmap
  // (measured: that's exactly what made van markers disappear at scale).
  const vanMarkerRadius = Math.max(bounds.width, bounds.height) * 0.012;

  const gridLinesX = useMemo(() => {
    const start = Math.floor(bounds.minX / GRID_STEP_KM) * GRID_STEP_KM;
    const lines: number[] = [];
    for (let x = start; x <= bounds.minX + bounds.width; x += GRID_STEP_KM) lines.push(x);
    return lines;
  }, [bounds]);
  const gridLinesY = useMemo(() => {
    const start = Math.floor(bounds.minY / GRID_STEP_KM) * GRID_STEP_KM;
    const lines: number[] = [];
    for (let y = start; y <= bounds.minY + bounds.height; y += GRID_STEP_KM) lines.push(y);
    return lines;
  }, [bounds]);

  const routePoints = useMemo((): [number, number][] => {
    if (!route || route.stops.length === 0) return [];
    const startId = currentNodeId ?? depotNodeId;
    const ids = [startId, ...route.stops.map((s) => s.nodeId), depotNodeId];
    return ids
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNode => !!n)
      .map((n): [number, number] => [n.x, n.y]);
  }, [route, depotNodeId, currentNodeId, nodeById]);

  const visitedPoints = useMemo((): [number, number][] => {
    if (!visitedPath || visitedPath.length < 2) return [];
    return visitedPath
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNode => !!n)
      .map((n): [number, number] => [n.x, n.y]);
  }, [visitedPath, nodeById]);

  const secondaryRoutePoints = useMemo((): [number, number][] => {
    if (!secondaryRoute || secondaryRoute.stops.length === 0) return [];
    const startId = currentNodeId ?? depotNodeId;
    const ids = [startId, ...secondaryRoute.stops.map((s) => s.nodeId), depotNodeId];
    return ids
      .map((id) => nodeById.get(id))
      .filter((n): n is GraphNode => !!n)
      .map((n): [number, number] => [n.x, n.y]);
  }, [secondaryRoute, depotNodeId, currentNodeId, nodeById]);

  const hoveredNode = hoveredNodeId ? nodeById.get(hoveredNodeId) : undefined;
  const hoveredPriority = hoveredNodeId ? priorities[hoveredNodeId] ?? 0 : 0;
  const hoveredHours = hoveredNode?.openingHours.monday;
  const hoveredReason = hoveredNodeId ? infeasibleReasons?.[hoveredNodeId] : undefined;

  return (
    <div className="flex h-full w-full flex-col gap-2 lg:flex-row">
      <svg
        viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        className="h-full min-h-0 flex-1 rounded-lg bg-slate-950"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          {/* markerUnits="userSpaceOnUse" -- sized directly in the SVG's
              own (x, y) km units, NOT multiplied by strokeWidth (the
              default), which at strokeWidth=0.1 made these too small to
              see at all. A sleeker chevron (vs. a flat triangle) with a
              dark outline for contrast against any background color. */}
          {(
            [
              ["arrow-visited", "#3b82f6"],
              ["arrow-baseline", "#f8fafc"],
              ["arrow-secondary", "#a855f7"],
            ] as const
          ).map(([id, fill]) => (
            <marker
              key={id}
              id={id}
              viewBox="0 0 12 12"
              refX="9.5"
              refY="6"
              markerWidth="1.4"
              markerHeight="1.4"
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M1,1.5 L11,6 L1,10.5 L3.8,6 Z" fill={fill} stroke="#0f172a" strokeWidth="0.6" strokeLinejoin="round" />
            </marker>
          ))}
          {/* One arrowhead marker per van, in that van's own color, so the
              direction of travel along its dashed route is unambiguous
              even with several vans' lines overlapping on the full map. */}
          {vanRoutes?.map((vr) => (
            <marker
              key={`arrow-van-${vr.vanId}`}
              id={`arrow-van-${vr.vanId}`}
              viewBox="0 0 12 12"
              refX="9.5"
              refY="6"
              // Scaled to vanMarkerRadius (which already accounts for the
              // current viewBox/zoom), NOT a fixed absolute size -- a fixed
              // size looked tiny on the full map but gigantic once zoomed
              // into a single van's route, where bounds are much smaller.
              markerWidth={vanMarkerRadius * 0.9}
              markerHeight={vanMarkerRadius * 0.9}
              markerUnits="userSpaceOnUse"
              orient="auto-start-reverse"
            >
              <path d="M1,1.5 L11,6 L1,10.5 L3.8,6 Z" fill={vr.color} stroke="#0f172a" strokeWidth="1.1" strokeLinejoin="round" />
            </marker>
          ))}
        </defs>

        {/* Subtle coordinate grid -- an abstract simulation plane, not a real map. */}
        {gridLinesX.map((x) => (
          <line
            key={`gx-${x}`}
            x1={x}
            y1={bounds.minY}
            x2={x}
            y2={bounds.minY + bounds.height}
            stroke="#172033"
            strokeWidth={0.04}
          />
        ))}
        {gridLinesY.map((y) => (
          <line
            key={`gy-${y}`}
            x1={bounds.minX}
            y1={y}
            x2={bounds.minX + bounds.width}
            y2={y}
            stroke="#172033"
            strokeWidth={0.04}
          />
        ))}

        {isHeatmapMode &&
          heatmapGrid!.bins.map((bin) => (
            <rect
              key={`bin-${bin.binX}-${bin.binY}`}
              x={bin.minX}
              y={bin.minY}
              width={bin.maxX - bin.minX}
              height={bin.maxY - bin.minY}
              fill={bin.worstTier === "normal" ? "#334155" : TIER_COLORS[bin.worstTier]}
              fillOpacity={bin.worstTier === "normal" ? 0.3 : 0.55 + bin.averageRiskScore * 0.4}
              stroke={hoveredBin?.binX === bin.binX && hoveredBin?.binY === bin.binY ? "#f8fafc" : "#0f172a"}
              strokeWidth={hoveredBin?.binX === bin.binX && hoveredBin?.binY === bin.binY ? 0.12 : 0.03}
              onMouseEnter={() => setHoveredBin(bin)}
              onMouseLeave={() => setHoveredBin((b) => (b?.binX === bin.binX && b?.binY === bin.binY ? undefined : b))}
              style={{ cursor: "pointer" }}
            />
          ))}

        {isHeatmapMode &&
          nodes
            .filter((n) => n.role === "shelter")
            .map((shelter) => (
              <circle
                key={`shelter-${shelter.id}`}
                cx={shelter.x}
                cy={shelter.y}
                r={vanMarkerRadius * 0.8}
                fill="#ef4444"
                stroke="#0f172a"
                strokeWidth={vanMarkerRadius * 0.12}
              />
            ))}

        {riskRings?.map((ring, i) => (
          <circle
            key={`risk-${i}`}
            cx={ring.centerX}
            cy={ring.centerY}
            r={ring.radiusKm}
            fill={RISK_COLORS[ring.level]}
            fillOpacity={ring.level === "high" ? 0.16 : 0.07}
            stroke={RISK_COLORS[ring.level]}
            strokeWidth={ring.level === "high" ? 0.07 : 0.035}
            strokeDasharray="0.4 0.3"
          />
        ))}

        {edges.map((edge, i) => {
          const from = nodeById.get(edge.from);
          const to = nodeById.get(edge.to);
          if (!from || !to) return null;
          return (
            <line
              key={`edge-${i}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#334155"
              strokeWidth={0.03}
              strokeOpacity={0.35}
            />
          );
        })}

        {/* Solid line: the route actually traveled so far, one arrowhead per hop. */}
        {visitedPoints.length > 1 &&
          visitedPoints.slice(0, -1).map(([x1, y1], i) => {
            const [x2, y2] = visitedPoints[i + 1];
            return (
              <line
                key={`visited-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke="#3b82f6"
                strokeWidth={0.14}
                strokeOpacity={0.95}
                strokeLinecap="round"
                markerEnd="url(#arrow-visited)"
              />
            );
          })}

        {/* Dashed line: the recommended/baseline PREVIEW from here onward -- not yet
            traveled, one arrowhead per hop. Offset perpendicular to its own direction so
            it doesn't visually fuse with the secondary route below when both follow a
            similar, tightly packed path. */}
        {routePoints.length > 1 &&
          routePoints.slice(0, -1).map(([x1, y1], i) => {
            const [x2, y2] = routePoints[i + 1];
            const [ox1, oy1, ox2, oy2] = offsetSegment(x1, y1, x2, y2, LINE_OFFSET);
            return (
              <line
                key={`route-${i}`}
                x1={ox1}
                y1={oy1}
                x2={ox2}
                y2={oy2}
                stroke="#f8fafc"
                strokeWidth={0.12}
                strokeOpacity={0.9}
                strokeLinecap="round"
                strokeDasharray="0.45 0.3"
                markerEnd="url(#arrow-baseline)"
              />
            );
          })}

        {/* Dotted line: the exact benchmark's plan for this player, one arrowhead per hop,
            offset the other way from the baseline line above. */}
        {secondaryRoutePoints.length > 1 &&
          secondaryRoutePoints.slice(0, -1).map(([x1, y1], i) => {
            const [x2, y2] = secondaryRoutePoints[i + 1];
            const [ox1, oy1, ox2, oy2] = offsetSegment(x1, y1, x2, y2, -LINE_OFFSET);
            return (
              <line
                key={`secondary-${i}`}
                x1={ox1}
                y1={oy1}
                x2={ox2}
                y2={oy2}
                stroke="#a855f7"
                strokeWidth={0.12}
                strokeOpacity={0.9}
                strokeLinecap="round"
                strokeDasharray="0.06 0.22"
                markerEnd="url(#arrow-secondary)"
              />
            );
          })}

        {!isHeatmapMode &&
          nodes.map((node) => {
          const isDepot = node.id === depotNodeId;
          const isCurrent = node.id === currentNodeId;
          const isVisited = visitedSet.has(node.id);
          const isSelected = node.id === selectedNodeId;
          const isFeasible = feasibleNodeIds ? feasibleSet.has(node.id) : true;
          const clickable = interactive && !!onSelectNode && isFeasible;

          const color = isVisited ? "#3b82f6" : isFeasible ? "#10b981" : "#64748b";
          const borderColor = isCurrent ? "#facc15" : isSelected ? "#3b82f6" : "#0f172a";

          const radius = isDepot ? 1.0 : markerRadius(node.demand, maxDemand);

          return (
            <g
              key={node.id}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId((id) => (id === node.id ? undefined : id))}
              onClick={() => clickable && onSelectNode!(node.id)}
              style={{ cursor: clickable ? "pointer" : "default" }}
            >
              {isDepot ? (
                <path d={starPath(node.x, node.y, 1.0, 0.42)} fill="#ef4444" />
              ) : (
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={radius}
                  fill={color}
                  fillOpacity={isVisited ? 0.95 : isFeasible ? 0.85 : 0.4}
                  stroke={borderColor}
                  strokeWidth={isCurrent || isSelected ? 0.12 : 0.035}
                />
              )}
              {node.id === hoveredNodeId && (
                <circle cx={node.x} cy={node.y} r={radius + 0.3} fill="none" stroke="#e2e8f0" strokeWidth={0.05} />
              )}
              {nodeLabels.has(node.id) && (
                <text
                  x={node.x + radius + 0.2}
                  y={node.y - radius - 0.15}
                  textAnchor="start"
                  fontSize={0.62}
                  fill="#cbd5e1"
                  stroke="#0f172a"
                  strokeWidth={0.14}
                  paintOrder="stroke"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {nodeLabels.get(node.id)}
                </text>
              )}
            </g>
          );
        })}

        {vanRoutes?.map((vr) =>
          vr.points.slice(0, -1).map(([x1, y1], i) => {
            const [x2, y2] = vr.points[i + 1];
            return (
              <line
                key={`vanroute-${vr.vanId}-${i}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={vr.color}
                strokeWidth={vanMarkerRadius * 0.35}
                strokeOpacity={0.85}
                strokeLinecap="round"
                strokeDasharray={`${vanMarkerRadius * 0.9} ${vanMarkerRadius * 0.6}`}
                markerEnd={`url(#arrow-van-${vr.vanId})`}
              />
            );
          }),
        )}

        {vanMarkers?.map((van) => (
          <g key={`van-${van.vanId}`}>
            <circle
              cx={van.x}
              cy={van.y}
              r={vanMarkerRadius}
              fill={van.color}
              stroke="#0f172a"
              strokeWidth={vanMarkerRadius * 0.16}
            />
            {van.label && (
              <text
                x={van.x + vanMarkerRadius * 1.3}
                y={van.y - vanMarkerRadius * 0.9}
                fontSize={vanMarkerRadius * 1.4}
                fill="#e2e8f0"
                stroke="#0f172a"
                strokeWidth={vanMarkerRadius * 0.3}
                paintOrder="stroke"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {van.label}
              </text>
            )}
          </g>
        ))}

        {otherPlayers?.map((player) => {
          const node = nodeById.get(player.currentNodeId);
          if (!node) return null;
          return (
            <circle
              key={`player-${player.id}`}
              cx={node.x}
              cy={node.y}
              r={0.4}
              fill={player.color}
              stroke="#0f172a"
              strokeWidth={0.05}
            />
          );
        })}
      </svg>

      {/* Node detail panel -- replaces map-tile tooltips entirely. */}
      <div className="w-full shrink-0 rounded-lg border bg-card p-3 text-sm lg:w-56">
        {hoveredNode ? (
          <div className="space-y-1">
            <p className="font-semibold">
              {hoveredNode.name}
              {nodeLabels.has(hoveredNode.id) && (
                <span className="font-normal text-muted-foreground"> ({nodeLabels.get(hoveredNode.id)})</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground capitalize">{hoveredNode.role}</p>
            {hoveredNode.role === "origin" ? (
              <p>Population: {hoveredNode.demand}</p>
            ) : (
              <p>Capacity: {hoveredNode.capacity}</p>
            )}
            <p>Priority: +{hoveredPriority}</p>
            {hoveredHours && !hoveredHours.closed && (
              <p className="text-xs text-muted-foreground">
                Access window: {hoveredHours.open}–{hoveredHours.close}
              </p>
            )}
            <p className="text-xs">
              {visitedSet.has(hoveredNode.id)
                ? "Status: evacuated"
                : feasibleSet.has(hoveredNode.id)
                  ? "Status: feasible now"
                  : "Status: not currently reachable"}
            </p>
            {!visitedSet.has(hoveredNode.id) && !feasibleSet.has(hoveredNode.id) && (
              <p className="mt-1 text-xs text-amber-500">
                {hoveredReason ? INFEASIBLE_REASON_LABELS[hoveredReason] : "Not currently feasible."}
              </p>
            )}
          </div>
        ) : hoveredBin ? (
          <div className="space-y-1">
            <p className="font-semibold capitalize">
              {hoveredBin.worstTier === "normal" ? "No risk" : hoveredBin.worstTier} area
            </p>
            <p className="text-xs text-muted-foreground">
              {heatmapGrid?.binSizeKm}km × {heatmapGrid?.binSizeKm}km cell
            </p>
            <p>Villages/shelters in this cell: {hoveredBin.cellCount}</p>
            <p>Average risk score: {hoveredBin.averageRiskScore.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">
              Worst tier present: <span className="capitalize">{hoveredBin.worstTier}</span>
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            {isHeatmapMode ? "Hover a heatmap cell to see its details." : "Hover a node to see its details."}
          </p>
        )}
      </div>
    </div>
  );
}

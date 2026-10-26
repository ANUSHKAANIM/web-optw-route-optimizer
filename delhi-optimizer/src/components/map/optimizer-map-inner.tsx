"use client";

import { useMemo, useState } from "react";
import type { GraphNode, Edge } from "@/types/graph";
import type { Route, InfeasibilityReason } from "@/types/game";
import { buildNodeLabels } from "@/lib/node-labels";

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
}

const RISK_COLORS: Record<MapRiskRing["level"], string> = { high: "#dc2626", medium: "#f97316", low: "#facc15" };
const VIEWBOX_PADDING_KM = 6;
const GRID_STEP_KM = 5;

function markerRadius(priority: number, maxPriority: number): number {
  if (maxPriority <= 0) return 0.42;
  return 0.42 + Math.max(0, Math.min(1, priority / maxPriority)) * 0.5;
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
};

interface Bounds {
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
}: OptimizerMapProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | undefined>(undefined);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const maxPriority = useMemo(() => Math.max(1, ...Object.values(priorities)), [priorities]);
  const nodeLabels = useMemo(() => buildNodeLabels(nodes, depotNodeId), [nodes, depotNodeId]);
  const visitedSet = useMemo(() => new Set(visitedPath ?? []), [visitedPath]);
  const feasibleSet = useMemo(() => new Set(feasibleNodeIds ?? []), [feasibleNodeIds]);

  const bounds: Bounds = useMemo(() => {
    if (nodes.length === 0) return { minX: 0, minY: 0, width: 1, height: 1 };
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs) - VIEWBOX_PADDING_KM;
    const minY = Math.min(...ys) - VIEWBOX_PADDING_KM;
    const width = Math.max(...xs) - Math.min(...xs) + VIEWBOX_PADDING_KM * 2;
    const height = Math.max(...ys) - Math.min(...ys) + VIEWBOX_PADDING_KM * 2;
    return { minX, minY, width: Math.max(width, 1), height: Math.max(height, 1) };
  }, [nodes]);

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

        {nodes.map((node) => {
          const isDepot = node.id === depotNodeId;
          const isCurrent = node.id === currentNodeId;
          const isVisited = visitedSet.has(node.id);
          const isSelected = node.id === selectedNodeId;
          const isFeasible = feasibleNodeIds ? feasibleSet.has(node.id) : true;
          const priority = priorities[node.id] ?? 0;
          const clickable = interactive && !!onSelectNode && isFeasible;

          const color = isVisited ? "#3b82f6" : isFeasible ? "#10b981" : "#64748b";
          const borderColor = isCurrent ? "#facc15" : isSelected ? "#3b82f6" : "#0f172a";

          const radius = isDepot ? 1.0 : markerRadius(priority, maxPriority);

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
        ) : (
          <p className="text-xs text-muted-foreground">Hover a node to see its details.</p>
        )}
      </div>
    </div>
  );
}

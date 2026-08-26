"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";

export interface RouteMapProps {
  coords: [number, number][];
  effectiveRewards: number[];
  path: number[];
  feasibleNodes: number[];
  recommendedPath: number[];
  currentNode: number;
  onSelectNode?: (node: number) => void;
  interactive?: boolean;
}

const SIZE = 600;
const PADDING = 40;

export function RouteMap({
  coords,
  effectiveRewards,
  path,
  feasibleNodes,
  recommendedPath,
  currentNode,
  onSelectNode,
  interactive = true,
}: RouteMapProps) {
  const project = useMemo(() => {
    const xs = coords.map((c) => c[0]);
    const ys = coords.map((c) => c[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    return ([x, y]: [number, number]): [number, number] => [
      PADDING + ((x - minX) / spanX) * (SIZE - 2 * PADDING),
      SIZE - (PADDING + ((y - minY) / spanY) * (SIZE - 2 * PADDING)),
    ];
  }, [coords]);

  const visitedSet = new Set(path);
  const feasibleSet = new Set(feasibleNodes);

  const pathLines = pairwise(path);
  const recommendedLines = pairwise(recommendedPath);

  return (
    <svg
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-full w-full rounded-lg border bg-card"
      role="img"
      aria-label="Route map: click a highlighted node to travel there next"
    >
      <defs>
        <marker id="arrow-visited" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-blue-500" />
        </marker>
        <marker id="arrow-recommended" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="fill-amber-500" />
        </marker>
      </defs>

      {recommendedLines.map(([u, v], i) => {
        const [x1, y1] = project(coords[u]);
        const [x2, y2] = project(coords[v]);
        return (
          <line
            key={`rec-${i}`}
            x1={x1} y1={y1} x2={x2} y2={y2}
            className="stroke-amber-500"
            strokeWidth={1.75}
            strokeDasharray="6 5"
            markerEnd="url(#arrow-recommended)"
            opacity={0.85}
          />
        );
      })}

      {pathLines.map(([u, v], i) => {
        const [x1, y1] = project(coords[u]);
        const [x2, y2] = project(coords[v]);
        return (
          <line
            key={`path-${i}`}
            x1={x1} y1={y1} x2={x2} y2={y2}
            className="stroke-blue-500"
            strokeWidth={2.5}
            markerEnd="url(#arrow-visited)"
          />
        );
      })}

      {coords.map((coord, node) => {
        if (node === 0) return null;
        const [x, y] = project(coord);
        const isVisited = visitedSet.has(node);
        const isFeasible = feasibleSet.has(node);
        const isCurrent = node === currentNode;
        const clickable = interactive && isFeasible && !!onSelectNode;

        return (
          <g key={node}>
            <circle
              cx={x} cy={y}
              r={isFeasible ? 11 : 7}
              className={cn(
                "transition-all",
                isVisited && "fill-blue-500 stroke-black/50",
                !isVisited && isFeasible && "fill-emerald-500 stroke-black/60 cursor-pointer",
                !isVisited && !isFeasible && "fill-muted-foreground/30 stroke-none",
              )}
              strokeWidth={1.25}
              onClick={clickable ? () => onSelectNode!(node) : undefined}
              role={clickable ? "button" : undefined}
              tabIndex={clickable ? 0 : undefined}
              aria-label={clickable ? `Travel to node ${node}, reward ${effectiveRewards[node]?.toFixed(1)}` : undefined}
              onKeyDown={
                clickable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") onSelectNode!(node);
                    }
                  : undefined
              }
            />
            {isCurrent && (
              <circle
                cx={x} cy={y} r={16}
                className="fill-none stroke-yellow-400"
                strokeWidth={3}
              />
            )}
            <text x={x + 12} y={y - 10} className="fill-foreground text-[9px]">
              N{node} (+{effectiveRewards[node]?.toFixed(1) ?? "0.0"})
            </text>
          </g>
        );
      })}

      {/* Depot drawn last so it's always on top */}
      {coords[0] && (
        <g>
          {(() => {
            const [x, y] = project(coords[0]);
            return (
              <>
                {currentNode === 0 && (
                  <circle cx={x} cy={y} r={20} className="fill-none stroke-yellow-400" strokeWidth={3} />
                )}
                <path
                  d={starPath(x, y, 14, 6)}
                  className="fill-rose-600 stroke-black/40"
                  strokeWidth={1}
                />
                <text x={x + 16} y={y - 10} className="fill-foreground text-[9px] font-semibold">
                  Depot
                </text>
              </>
            );
          })()}
        </g>
      )}
    </svg>
  );
}

function pairwise(list: number[]): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < list.length - 1; i++) pairs.push([list[i], list[i + 1]]);
  return pairs;
}

function starPath(cx: number, cy: number, outerR: number, innerR: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    points.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return `M${points.join("L")}Z`;
}

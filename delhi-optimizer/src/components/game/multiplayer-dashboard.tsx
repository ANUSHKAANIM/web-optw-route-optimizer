"use client";

import { useEffect, useState } from "react";
import { OptimizerMap } from "@/components/map/optimizer-map";
import { formatDurationClock, formatMinutesClock } from "@/lib/ist-clock";
import { buildNodeLabels } from "@/lib/node-labels";
import type { GraphNode, Edge } from "@/types/graph";
import type { SessionView } from "@/game/game.service";
import type { ExactSessionPlan } from "@/game/exact-plan.service";

const POLL_INTERVAL_MS = 2500; // ~2-3s polling

export function MultiplayerDashboard({ sessionId, playerId }: { sessionId: number; playerId: number }) {
  const [view, setView] = useState<SessionView | null>(null);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exactPlan, setExactPlan] = useState<ExactSessionPlan | null>(null);
  const [exactPlanLoading, setExactPlanLoading] = useState(false);
  const [exactPlanError, setExactPlanError] = useState<string | null>(null);
  const [exactSolver, setExactSolver] = useState<"highs" | "cplex">("highs");

  useEffect(() => {
    fetch("/api/nodes")
      .then((r) => r.json())
      .then((data: { nodes: GraphNode[]; edges: Edge[] }) => {
        setNodes(data.nodes);
        setEdges(data.edges);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}?playerId=${playerId}`);
        if (!res.ok) throw new Error((await res.json()).error ?? "Failed to load session.");
        const data: SessionView = await res.json();
        if (!cancelled) setView(data);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load session.");
      }
    }
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [sessionId, playerId]);

  async function collectNode(nodeId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, nodeId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not collect that node.");
      setView(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not collect that node.");
    } finally {
      setBusy(false);
    }
  }

  async function endJourney() {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, end: true }),
      });
      setView(await res.json());
    } finally {
      setBusy(false);
    }
  }

  async function simulateNextForecast() {
    const res = await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ advanceForecast: true }),
    });
    if (res.ok) setView(await res.json());
  }

  async function computeExactPlan() {
    setExactPlanLoading(true);
    setExactPlanError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/exact-plan?solver=${exactSolver}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not compute the exact plan.");
      setExactPlan(await res.json());
    } catch (err) {
      setExactPlanError(err instanceof Error ? err.message : "Could not compute the exact plan.");
    } finally {
      setExactPlanLoading(false);
    }
  }

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!view || nodes.length === 0) return <div className="h-[60vh] animate-pulse rounded-xl bg-muted" />;

  const self = view.self;
  const otherPlayers = view.players.filter((p) => p.id !== playerId);
  const leaderboard = [...view.players].sort((a, b) => b.demandServed - a.demandServed);
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const nodeLabels = buildNodeLabels(nodes, view.session.depotNodeId);
  const displayName = (nodeId: string) => {
    const name = nodeById.get(nodeId)?.name ?? nodeId;
    const label = nodeLabels.get(nodeId);
    return label ? `${name} (${label})` : name;
  };
  const capacityRemaining = Math.max(0, view.session.shelterCapacity - view.session.demandServed);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <div className="h-[60vh] min-h-[420px] overflow-hidden rounded-xl border">
          <OptimizerMap
            nodes={nodes}
            edges={edges}
            priorities={view.priorities}
            depotNodeId={view.session.depotNodeId}
            currentNodeId={self?.currentNodeId}
            feasibleNodeIds={self?.feasibleNodeIds}
            infeasibleReasons={self?.infeasibleReasons}
            visitedPath={self?.path}
            route={self?.baselineRoute}
            secondaryRoute={exactPlan?.routesByPlayerId[playerId]}
            otherPlayers={otherPlayers}
            riskRings={view.forecast?.riskZone}
            interactive={!busy && self?.status === "active"}
            onSelectNode={collectNode}
          />
        </div>

        {self && (
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-semibold">
                {self.status === "finished" ? "Your final route" : "Your route so far"}
              </h3>
              {self.status === "active" && (
                <button
                  onClick={endJourney}
                  disabled={busy}
                  className="rounded-md border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  End Journey Now
                </button>
              )}
            </div>

            {/* The solid blue line on the map -- every stop actually visited, in order. */}
            <ol className="mb-3 space-y-1 text-sm">
              {self.path.map((nodeId, i) => (
                <li key={`${nodeId}-${i}`} className="flex items-center gap-2">
                  <span className="flex size-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-medium text-white">
                    {i === 0 ? "S" : i}
                  </span>
                  <span className={i === self.path.length - 1 ? "font-medium" : ""}>{displayName(nodeId)}</span>
                  {i === self.path.length - 1 && self.status === "active" && (
                    <span className="text-xs text-muted-foreground">(you are here)</span>
                  )}
                </li>
              ))}
            </ol>

            <div className="grid grid-cols-3 gap-2 border-t pt-2 text-center text-xs">
              <Stat label="Origins reached" value={`${self.path.length - 1}`} />
              <Stat label="People evacuated" value={self.demandServed.toFixed(0)} />
              <Stat label="Time used" value={formatDurationClock(self.elapsedMinutes)} />
            </div>

            {self.status === "active" && (
              <>
                {/* The amber dashed, arrowed line on the map -- what the
                    baseline optimizer suggests doing next, not yet traveled. */}
                {self.baselineRoute.stops.length > 0 ? (
                  <div className="mt-3 border-t pt-2 text-xs">
                    <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                      <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-slate-50" />
                      Suggested route (baseline) -- {self.baselineRoute.totalDemandServed} people, +
                      {self.baselineRoute.totalReward}
                    </p>
                    <ol className="space-y-0.5 text-muted-foreground">
                      {self.baselineRoute.stops.map((s, i) => (
                        <li key={`${s.nodeId}-${i}`}>
                          {i + 1}. {displayName(s.nodeId)}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : (
                  <p className="mt-3 border-t pt-2 text-xs text-muted-foreground">
                    No feasible villages left to suggest right now -- click a green (feasible) origin on the map
                    to travel there and evacuate it, if any are shown.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border bg-card p-4 shadow-sm text-sm">
          <h3 className="mb-2 font-semibold">Session Status</h3>
          <Row label="Session" value={`#${view.session.id}`} />
          <Row label="Started" value={formatMinutesClock(view.session.gameStartMinutesOfDay)} />
          <Row label="Shelter capacity" value={`${view.session.demandServed} / ${view.session.shelterCapacity}`} />
          <Row label="Capacity remaining" value={`${capacityRemaining}`} />
          {self && (
            <>
              <Row label="Your priority score" value={self.totalReward.toFixed(0)} />
              <Row label="People you evacuated" value={self.demandServed.toFixed(0)} />
              <Row label="Time used" value={formatDurationClock(self.elapsedMinutes)} />
              <Row label="Status" value={self.status} />
            </>
          )}
        </div>

        {view.forecast && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm dark:border-red-900 dark:bg-red-950/30">
            <h3 className="mb-1 flex items-center gap-1.5 font-semibold text-red-700 dark:text-red-400">
              ⚠️ Simulated Forecast
            </h3>
            <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-red-600 dark:text-red-500">
              Simulation -- not a real cyclone forecast
            </p>
            <Row label="Scenario" value={`#${view.forecast.scenarioId}`} />
            <Row label="Concentration" value={view.forecast.concentration} />
            <Row label="Next update in" value={formatDurationClock(view.secondsUntilNextForecast / 60)} />
            <button
              onClick={simulateNextForecast}
              className="mt-2 w-full rounded-md border border-red-300 bg-white px-2 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
            >
              Simulate Next Forecast
            </button>
          </div>
        )}

        <div className="rounded-xl border bg-card p-4 shadow-sm text-sm">
          <h3 className="mb-2 font-semibold">Priorities</h3>
          <ul className="space-y-1">
            {Object.entries(view.priorities)
              .filter(([id]) => id !== view.session.depotNodeId)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 6)
              .map(([id, priority]) => (
                <li key={id} className="flex items-center justify-between text-muted-foreground">
                  <span className="truncate">{displayName(id)}</span>
                  <span className="font-medium text-foreground">+{priority}</span>
                </li>
              ))}
          </ul>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm text-sm">
          <div className="mb-1 flex items-center justify-between">
            <h3 className="font-semibold">Exact Benchmark</h3>
            <div className="flex items-center gap-1.5">
              <select
                value={exactSolver}
                onChange={(e) => setExactSolver(e.target.value as "highs" | "cplex")}
                disabled={exactPlanLoading}
                className="rounded-md border bg-background px-1.5 py-1 text-xs"
              >
                <option value="highs">HiGHS</option>
                <option value="cplex">CPLEX</option>
              </select>
              <button
                onClick={computeExactPlan}
                disabled={exactPlanLoading}
                className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
              >
                {exactPlanLoading ? "Solving…" : "Compute"}
              </button>
            </div>
          </div>
          <p className="mb-2 text-[10px] text-muted-foreground">
            A real exact MILP solver jointly optimizing every active team&apos;s route at once, for comparison
            against each team&apos;s baseline/neural suggestion. HiGHS is open-source and always available; CPLEX
            is a genuine local IBM CPLEX Community Edition install (dev-machine only, capped at 1,000
            variables/constraints). Your own plan is drawn on the map as a dotted purple line.
          </p>
          {exactPlanError && <p className="text-xs text-destructive">{exactPlanError}</p>}
          {exactPlan && Object.keys(exactPlan.routesByPlayerId).length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing to benchmark right now -- every team is either finished or has no feasible village left to
              reach, so there&apos;s no active route to jointly optimize.
            </p>
          ) : (
            exactPlan && (
              <div className="space-y-2">
                <Row label="Backend" value={exactPlan.backend} />
                <Row label="Solver status" value={exactPlan.solverStatus} />
                <Row label="Objective (total priority)" value={exactPlan.objectiveValue?.toFixed(1) ?? "—"} />
                {exactPlan.optimalityGap !== undefined && (
                  <Row label="MIP gap" value={`${(exactPlan.optimalityGap * 100).toFixed(2)}%`} />
                )}
                <Row label="Runtime" value={`${exactPlan.runtimeMs} ms`} />
                <ul className="space-y-2 border-t pt-2">
                  {view.players
                    .filter((p) => exactPlan.routesByPlayerId[p.id])
                    .map((p) => {
                      const route = exactPlan.routesByPlayerId[p.id];
                      return (
                        <li key={p.id}>
                          <div className="flex items-center justify-between text-muted-foreground">
                            <span className="flex items-center gap-2 truncate">
                              <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                              {p.name}
                              {p.id === playerId && <span className="text-xs">(you)</span>}
                            </span>
                            <span className="font-medium text-foreground">
                              {route.stops.length} stops · +{route.totalReward}
                            </span>
                          </div>
                          {route.stops.length > 0 ? (
                            <p className="mt-0.5 pl-4 text-xs text-muted-foreground">
                              {route.stops.map((s) => displayName(s.nodeId)).join(" → ")}
                            </p>
                          ) : (
                            <p className="mt-0.5 pl-4 text-xs text-muted-foreground">No feasible route found.</p>
                          )}
                        </li>
                      );
                    })}
                </ul>
              </div>
            )
          )}
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-sm text-sm">
          <h3 className="mb-2 font-semibold">Leaderboard (people evacuated)</h3>
          <ol className="space-y-1">
            {leaderboard.map((p, i) => (
              <li key={p.id} className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <span className="w-4 text-muted-foreground">{i + 1}.</span>
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                  {p.name}
                  {p.id === playerId && <span className="text-xs text-muted-foreground">(you)</span>}
                </span>
                <span className="font-medium tabular-nums">{p.demandServed.toFixed(0)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

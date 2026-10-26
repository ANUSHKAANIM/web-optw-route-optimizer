import type { Graph, Weekday } from "@/types/graph";
import type { Route } from "@/types/game";
import { computeRelativeWindow, planArrival } from "@/optimization/feasibility";
import { solveWithCplex, type LpSolveResult } from "./cplex-solver";

/**
 * Independent mathematical-optimization benchmark (joint multi-team
 * routing), solved EXACTLY (to proven optimality, within a configured
 * relative gap, or a reported time-limit cutoff) by either of two REAL
 * solvers, selected via `ExactPlanInput.solver`:
 *
 *   - "highs" (default): HiGHS, open-source, MIT-licensed, run in-process
 *     via the `highs` WASM package (https://highs.dev). Always available,
 *     no external dependency.
 *   - "cplex": genuine, FULLY LICENSED IBM CPLEX Studio 22.1.2.0, invoked
 *     via a subprocess calling the native `cplex.exe` binary directly (see
 *     cplex-solver.ts and cplex_bridge.py) -- NOT through the `pip install
 *     cplex` Python package, which bundles its own separate engine capped
 *     at the free Community Edition's 1,000-variable/1,000-constraint
 *     limit regardless of any full license installed elsewhere on the
 *     machine. That distinction was confirmed empirically: the pip
 *     package rejected a 1,500-variable test problem with "CPLEX Error
 *     1016: Community Edition," while the native binary solved the
 *     identical problem (and a 1,500-variable/1,100-constraint binary MIP)
 *     with full 16-thread parallel branch-and-cut, no restriction. Still
 *     dev-machine only -- requires the native binary and a Python runtime
 *     to exist on whatever machine runs this server. When unavailable,
 *     this is reported explicitly (`solverStatus: "Unavailable"`), never
 *     silently substituted with HiGHS under CPLEX's name.
 *
 * Earlier in this project CPLEX was unavailable (no package, no install,
 * no license) -- then installed as the free, size-capped Community
 * Edition -- then upgraded to a full license, at which point the bridge
 * itself had to be rewritten (it had been silently hitting the pip
 * package's own restricted engine instead of the real one). Each stage
 * was reported as it actually was, not assumed.
 *
 * Formulation: a multi-vehicle Team Orienteering Problem with Time
 * Windows, plus a side constraint this project actually needs that
 * classic TOPTW doesn't have -- a SHARED shelter-capacity budget consumed
 * jointly by every team's selected villages, not a per-vehicle capacity.
 *
 *   - Each team k starts at ITS OWN current node (not necessarily the
 *     depot) with ITS OWN remaining time budget, and must end at the
 *     depot within that budget.
 *   - Each candidate origin may be assigned to AT MOST ONE team across the
 *     whole model (no duplicate rescues) -- enforced globally, across
 *     every team's arcs into it, not just within one team's own route.
 *   - Each origin has a hard accessibility window; arrival must fall
 *     inside it (modeled with big-M time-propagation constraints, the
 *     standard VRPTW technique -- this is also what makes the formulation
 *     subtour-free without a separate MTZ counter).
 *   - sum(demand of every assigned origin) must not exceed the shelter's
 *     REMAINING capacity (shelterCapacity - demandServed) -- one shared
 *     knapsack constraint across all teams simultaneously.
 *   - Objective: maximize total priority collected -- credited once per
 *     origin, via whichever single arc (from any team, from any
 *     predecessor) the solution actually uses to reach it.
 *
 * Variables: y[k][a][b] in {0,1} for every team k and ordered pair (a, b)
 * of {team k's start, every candidate origin, team k's end/depot}; t[k][a]
 * continuous, the (team-k-relative) time at which node a is reached.
 *
 * This formulation scales as O(teams * candidates^2) arc variables -- fine
 * for the current ~13-node scenario, NOT validated at anything near the
 * eventual ~2,000-node target. That is a known, reported limitation, not a
 * claim.
 *
 * MEASURED, not theoretical: even at this small (~13-node) scale, a
 * single-team solve sometimes does not close to the `mip_rel_gap`
 * tolerance within a 15s budget and reports `time_limit` rather than
 * `optimal` -- the big-M VRPTW-style time-propagation constraints give a
 * relatively weak LP relaxation (a well-known property of this
 * formulation family), so HiGHS's branch-and-bound can take longer than
 * the instance size alone would suggest. `time_limit` is reported
 * honestly rather than silently waiting longer or claiming optimality it
 * hasn't proven; a tighter formulation (e.g. a flow-based or
 * resource-indexed reformulation) would likely close faster, and is the
 * natural next step before trusting this at larger scales.
 */

export interface ExactTeamInput {
  teamId: number;
  currentNodeId: string;
  /** This team's OWN remaining minutes before it must be back at the
   * depot -- i.e. totalGameMinutes - elapsedMinutes, the same reframing
   * computeBaselineRoute/computeNeuralRoute already use per team. */
  remainingMinutes: number;
  /** gameStartMinutesOfDay shifted forward by this team's own
   * elapsedMinutes, so computeRelativeWindow returns windows relative to
   * THIS team's "now" -- again mirroring the existing per-team convention. */
  shiftedGameStartMinutesOfDay: number;
}

export interface ExactPlanInput {
  graph: Graph;
  depotNodeId: string;
  teams: ExactTeamInput[];
  /** Origins any team could possibly be assigned -- normally every origin
   * not already globally evacuated by some other player. */
  candidateOriginIds: string[];
  priorities: ReadonlyMap<string, number>;
  /** Shelter capacity remaining right now (shelterCapacity - demandServed),
   * the single shared budget every team's assigned demand draws from. */
  remainingCapacity: number;
  weekday: Weekday;
  /** Wall-clock cap on the solve itself, not a budget in the model. */
  timeLimitSeconds?: number;
  /** Which real solver actually runs the model. Defaults to "highs" (always
   * available). "cplex" requires a local CPLEX install -- see the module
   * doc comment -- and reports `solverStatus: "Unavailable"` rather than
   * silently falling back to HiGHS if it can't run. */
  solver?: "highs" | "cplex";
}

export interface ExactTeamPlan {
  teamId: number;
  route: Route;
}

export type ExactSolveStatus = "optimal" | "time_limit" | "infeasible" | "error";

export interface ExactPlanResult {
  status: ExactSolveStatus;
  /** Which solver actually produced this result. */
  backend: "highs" | "cplex";
  /** Total priority collected across every team, per the solver's own
   * objective value -- undefined if no solution was found at all. */
  objectiveValue?: number;
  /** The backend's own reported model status string, kept verbatim for
   * transparency (e.g. HiGHS's "Optimal"/"Time limit reached", or CPLEX's
   * "integer optimal solution"/"time limit exceeded"). */
  solverStatus: string;
  runtimeMs: number;
  /** CPLEX reports a real relative MIP gap after a time-limited solve;
   * HiGHS's one-shot API used here does not expose one. Present only when
   * the backend actually reported a number -- never fabricated. */
  optimalityGap?: number;
  plans: ExactTeamPlan[];
}

interface ArcInfo {
  team: number;
  from: string; // "start" or a real origin id
  to: string; // "end" or a real origin id
}

const BIG_M_SLACK = 1000;

function emptyRoute(computeTimeMs: number): Route {
  return { stops: [], totalDistanceKm: 0, totalTravelMinutes: 0, totalReward: 0, totalDemandServed: 0, computeTimeMs };
}

/** Lazily loads the HiGHS WASM module -- large (~4MB), so only paid for by
 * callers that actually invoke the exact solver. */
let highsPromise: Promise<import("highs").Highs> | null = null;
async function getHighs() {
  if (!highsPromise) {
    const loadHighs = (await import("highs")).default;
    highsPromise = loadHighs();
  }
  return highsPromise;
}

async function solveWithHighs(lpText: string, timeLimitSeconds: number): Promise<LpSolveResult> {
  const highs = await getHighs();
  const result = highs.solve(lpText, {
    output_flag: false,
    time_limit: timeLimitSeconds,
    // Accept a solution within 1% of the true optimum as "Optimal" --
    // standard MIP practice, and still reported honestly: a run that only
    // meets this looser tolerance is NOT the same claim as proving the
    // exact optimum, but HiGHS's own "Optimal" status already means
    // exactly "met its configured optimality criterion," not "gap = 0".
    mip_rel_gap: 0.01,
  });
  const columns: Record<string, number> = {};
  if ("Columns" in result) {
    for (const [name, col] of Object.entries(result.Columns)) columns[name] = col.Primal;
  }
  return { status: result.Status, objectiveValue: result.ObjectiveValue, columns };
}

/** Classifies either backend's own status string into this module's
 * ExactSolveStatus -- HiGHS and CPLEX use different vocabularies
 * ("Optimal"/"Time limit reached" vs "integer optimal solution"/
 * "time limit exceeded"), so this normalizes by keyword rather than an
 * exhaustive per-backend table. */
function classifyStatus(status: string, hasColumns: boolean): ExactSolveStatus {
  const s = status.toLowerCase();
  if (s.includes("infeasible")) return "infeasible";
  if (s.includes("optimal")) return "optimal";
  if (hasColumns) return "time_limit"; // a feasible incumbent exists, just not proven optimal
  return "error";
}

export async function computeExactPlan(input: ExactPlanInput): Promise<ExactPlanResult> {
  const start = Date.now();
  const { graph, depotNodeId, teams, candidateOriginIds, priorities, remainingCapacity, weekday, timeLimitSeconds } = input;
  const backend = input.solver ?? "highs";

  if (teams.length === 0) {
    return { status: "optimal", backend, objectiveValue: 0, solverStatus: "Optimal", runtimeMs: Date.now() - start, plans: [] };
  }

  const demandOf = (nodeId: string) => graph.nodesById.get(nodeId)?.demand ?? 0;
  const serviceDurationOf = (nodeId: string) => graph.nodesById.get(nodeId)?.serviceDurationMinutes ?? 0;
  const travel = (a: string, b: string) => graph.travelTimeMinutes.get(a)?.get(b) ?? Number.POSITIVE_INFINITY;

  const maxBudget = Math.max(1, ...teams.map((t) => t.remainingMinutes));
  const bigM = maxBudget + candidateOriginIds.reduce((sum, id) => sum + serviceDurationOf(id), 0) + BIG_M_SLACK;

  // Opaque sequential variable names -- avoids any ambiguity from real node
  // ids (which already contain underscores) when building the LP text.
  let nextVarIndex = 0;
  const newName = (prefix: string) => `${prefix}${nextVarIndex++}`;

  const arcVarName = new Map<string, string>(); // `${team}|${from}|${to}` -> var name
  const arcVarInfo = new Map<string, ArcInfo>(); // var name -> info
  const timeVarName = new Map<string, string>(); // `${team}|${node}` -> var name
  /** Every arc variable whose destination is a given real origin id,
   * across EVERY team and every kind of predecessor -- the single source
   * of truth both for "is this origin visited at all" (objective credit)
   * and for "at most one team visits it" (the cross-team constraint). */
  const originInflowArcs = new Map<string, string[]>();

  function arcKey(team: number, from: string, to: string) {
    return `${team}|${from}|${to}`;
  }
  function recordArc(team: number, from: string, to: string): string {
    const v = newName("y");
    arcVarName.set(arcKey(team, from, to), v);
    arcVarInfo.set(v, { team, from, to });
    if (to !== "end") {
      const list = originInflowArcs.get(to) ?? [];
      list.push(v);
      originInflowArcs.set(to, list);
    }
    return v;
  }

  const binaryVars: string[] = [];
  const continuousVarBounds: { name: string; upper: number }[] = [];
  const constraints: string[] = [];
  let constraintIndex = 0;
  const nextConstraintName = () => `c${constraintIndex++}`;

  for (let k = 0; k < teams.length; k++) {
    const team = teams[k];
    const startVar = newName("t");
    timeVarName.set(`${k}|__start__`, startVar);
    continuousVarBounds.push({ name: startVar, upper: 0 });
    constraints.push(`${nextConstraintName()}: ${startVar} = 0`);

    const endVar = newName("t");
    timeVarName.set(`${k}|__end__`, endVar);
    continuousVarBounds.push({ name: endVar, upper: team.remainingMinutes });

    const directArc = recordArc(k, "start", "end");
    binaryVars.push(directArc);

    const reachableOrigins: string[] = [];
    for (const originId of candidateOriginIds) {
      const window = computeRelativeWindow(graph.nodesById.get(originId)!, weekday, team.shiftedGameStartMinutesOfDay);
      if (!window) continue;
      const planToOrigin = planArrival(graph, team.currentNodeId, originId, 0, window, serviceDurationOf(originId));
      if (!planToOrigin.canFinishBeforeClosing) continue;
      const returnTravel = travel(originId, depotNodeId);
      if (planToOrigin.finishVisitMinutes + returnTravel > team.remainingMinutes) continue;
      reachableOrigins.push(originId);

      const tVar = newName("t");
      timeVarName.set(`${k}|${originId}`, tVar);
      continuousVarBounds.push({ name: tVar, upper: team.remainingMinutes });
    }
    for (const o of reachableOrigins) {
      const v = recordArc(k, "start", o);
      binaryVars.push(v);
      const vEnd = recordArc(k, o, "end");
      binaryVars.push(vEnd);
    }
    for (const a of reachableOrigins) {
      for (const b of reachableOrigins) {
        if (a === b) continue;
        const window = computeRelativeWindow(graph.nodesById.get(b)!, weekday, team.shiftedGameStartMinutesOfDay);
        if (!window) continue;
        const v = recordArc(k, a, b);
        binaryVars.push(v);
      }
    }

    // Start: exactly one outgoing arc.
    const outgoingFromStart = [directArc, ...reachableOrigins.map((o) => arcVarName.get(arcKey(k, "start", o))!)];
    constraints.push(`${nextConstraintName()}: ${outgoingFromStart.join(" + ")} = 1`);

    // End: exactly one incoming arc.
    const incomingToEnd = [directArc, ...reachableOrigins.map((o) => arcVarName.get(arcKey(k, o, "end"))!)];
    constraints.push(`${nextConstraintName()}: ${incomingToEnd.join(" + ")} = 1`);

    // Flow conservation + "visited at most once BY THIS TEAM" per origin.
    for (const o of reachableOrigins) {
      const incoming: string[] = [arcVarName.get(arcKey(k, "start", o))!];
      const outgoing: string[] = [arcVarName.get(arcKey(k, o, "end"))!];
      for (const other of reachableOrigins) {
        if (other === o) continue;
        const inV = arcVarName.get(arcKey(k, other, o));
        if (inV) incoming.push(inV);
        const outV = arcVarName.get(arcKey(k, o, other));
        if (outV) outgoing.push(outV);
      }
      // LP format has no parentheses -- the minus sign is distributed
      // across every outgoing term explicitly instead of grouping them.
      const negatedOutgoing = outgoing.map((v) => `- ${v}`).join(" ");
      constraints.push(`${nextConstraintName()}: ${incoming.join(" + ")} ${negatedOutgoing} = 0`);
      constraints.push(`${nextConstraintName()}: ${incoming.join(" + ")} <= 1`);

      // Time-window bounds, conditional on being visited by k (big-M).
      const inflowSum = incoming.join(" + ");
      const window = computeRelativeWindow(graph.nodesById.get(o)!, weekday, team.shiftedGameStartMinutesOfDay)!;
      const tVar = timeVarName.get(`${k}|${o}`)!;
      constraints.push(`${nextConstraintName()}: ${tVar} - ${bigM} ${inflowSum} >= ${window.effectiveOpenMinutes - bigM}`);
      constraints.push(`${nextConstraintName()}: ${tVar} + ${bigM} ${inflowSum} <= ${window.closeMinutes + bigM}`);
    }

    // Time propagation along every usable arc (standard VRPTW big-M link,
    // also what eliminates subtours not connected to start/end).
    for (const [, varName] of arcVarName.entries()) {
      const info = arcVarInfo.get(varName);
      if (!info || info.team !== k) continue;
      const fromNodeId = info.from === "start" ? team.currentNodeId : info.from;
      const toNodeId = info.to === "end" ? depotNodeId : info.to;
      const fromTimeVar = timeVarName.get(`${k}|${info.from === "start" ? "__start__" : info.from}`)!;
      const toTimeVar = timeVarName.get(`${k}|${info.to === "end" ? "__end__" : info.to}`)!;
      const travelTime = travel(fromNodeId, toNodeId);
      const serviceAtFrom = info.from === "start" ? 0 : serviceDurationOf(fromNodeId);
      // y=1 forces t_to >= t_from + travel + service (time must actually
      // advance along a used arc -- this is what rules out a disconnected
      // cycle among origins, not just what bounds arrival within a window);
      // y=0 relaxes it to an always-true, big-M-loose inequality.
      constraints.push(
        `${nextConstraintName()}: ${toTimeVar} - ${fromTimeVar} - ${bigM} ${varName} >= ${travelTime + serviceAtFrom - bigM}`,
      );
    }
  }

  // Cross-team: at most one team's arc, of any kind, may deliver this
  // origin -- and that same sum is exactly the objective's credit term.
  const objectiveTerms: string[] = [];
  for (const originId of candidateOriginIds) {
    const arcs = originInflowArcs.get(originId);
    if (!arcs || arcs.length === 0) continue;
    constraints.push(`${nextConstraintName()}: ${arcs.join(" + ")} <= 1`);
    const priority = priorities.get(originId) ?? 0;
    if (priority !== 0) {
      for (const v of arcs) objectiveTerms.push(`${priority} ${v}`);
    }
  }

  // Shared shelter-capacity knapsack: sum of demand across every assigned
  // origin, across EVERY team, bounded by the capacity remaining right now.
  const capacityTerms: string[] = [];
  for (const originId of candidateOriginIds) {
    const demand = demandOf(originId);
    const arcs = originInflowArcs.get(originId);
    if (demand <= 0 || !arcs || arcs.length === 0) continue;
    for (const v of arcs) capacityTerms.push(`${demand} ${v}`);
  }
  if (capacityTerms.length > 0) {
    constraints.push(`${nextConstraintName()}: ${capacityTerms.join(" + ")} <= ${remainingCapacity}`);
  }

  if (objectiveTerms.length === 0) {
    // No team can feasibly reach anything -- a valid, explicit "nothing to
    // do" result, not an error.
    return {
      status: "optimal",
      backend,
      objectiveValue: 0,
      solverStatus: "Optimal",
      runtimeMs: Date.now() - start,
      plans: teams.map((t) => ({ teamId: t.teamId, route: emptyRoute(0) })),
    };
  }

  const lpLines: string[] = [];
  lpLines.push("Maximize");
  lpLines.push(` obj: ${objectiveTerms.join(" + ")}`);
  lpLines.push("Subject To");
  for (const c of constraints) lpLines.push(` ${c}`);
  lpLines.push("Bounds");
  for (const b of continuousVarBounds) lpLines.push(` 0 <= ${b.name} <= ${b.upper}`);
  lpLines.push("Binary");
  lpLines.push(` ${binaryVars.join(" ")}`);
  lpLines.push("End");
  const lpText = lpLines.join("\n");

  const solveOptions = { timeLimitSeconds: timeLimitSeconds ?? 10, mipGap: 0.01 };
  let result: LpSolveResult;
  try {
    result = backend === "cplex" ? await solveWithCplex(lpText, solveOptions) : await solveWithHighs(lpText, solveOptions.timeLimitSeconds);
  } catch (err) {
    return {
      status: "error",
      backend,
      solverStatus: err instanceof Error ? err.message : String(err),
      runtimeMs: Date.now() - start,
      plans: teams.map((t) => ({ teamId: t.teamId, route: emptyRoute(0) })),
    };
  }

  const runtimeMs = Date.now() - start;

  if (result.unavailable) {
    return {
      status: "error",
      backend,
      solverStatus: `Unavailable: ${result.unavailable}`,
      runtimeMs,
      plans: teams.map((t) => ({ teamId: t.teamId, route: emptyRoute(0) })),
    };
  }

  const hasColumns = Object.keys(result.columns).length > 0;
  const status = classifyStatus(result.status, hasColumns);
  if (status === "infeasible" || status === "error") {
    return {
      status,
      backend,
      solverStatus: result.status,
      runtimeMs,
      optimalityGap: result.mipGap,
      plans: teams.map((t) => ({ teamId: t.teamId, route: emptyRoute(0) })),
    };
  }

  const chosenArcsByTeam = new Map<number, { from: string; to: string }[]>();
  for (const [varName, info] of arcVarInfo.entries()) {
    const primal = result.columns[varName] ?? 0;
    if (primal > 0.5) {
      const list = chosenArcsByTeam.get(info.team) ?? [];
      list.push({ from: info.from, to: info.to });
      chosenArcsByTeam.set(info.team, list);
    }
  }

  const plans: ExactTeamPlan[] = teams.map((team, k) => {
    const arcs = chosenArcsByTeam.get(k) ?? [];
    const nextFrom = new Map(arcs.map((a) => [a.from, a.to]));

    const stops: Route["stops"] = [];
    let cursor = "start";
    let elapsedMinutes = 0;
    let totalDistanceKm = 0;
    let totalReward = 0;
    let totalDemandServed = 0;
    let previousNodeId = team.currentNodeId;

    while (cursor !== "end") {
      const next = nextFrom.get(cursor);
      if (!next || next === "end") break;
      const node = graph.nodesById.get(next)!;
      const window = computeRelativeWindow(node, weekday, team.shiftedGameStartMinutesOfDay)!;
      const plan = planArrival(graph, previousNodeId, next, elapsedMinutes, window, node.serviceDurationMinutes);
      const reward = priorities.get(next) ?? 0;
      const demandServed = node.role === "origin" ? node.demand : 0;

      stops.push({
        nodeId: next,
        arrivalMinutes: plan.arrivalMinutes,
        waitMinutes: plan.waitMinutes,
        departureMinutes: plan.finishVisitMinutes,
        rewardCollected: reward,
        demandServed,
      });

      totalDistanceKm += graph.distanceKm.get(previousNodeId)?.get(next) ?? 0;
      totalReward += reward;
      totalDemandServed += demandServed;
      elapsedMinutes = plan.finishVisitMinutes;
      previousNodeId = next;
      cursor = next;
    }

    const returnDistanceKm = graph.distanceKm.get(previousNodeId)?.get(depotNodeId) ?? 0;
    const returnTravelMinutes = graph.travelTimeMinutes.get(previousNodeId)?.get(depotNodeId) ?? 0;

    return {
      teamId: team.teamId,
      route: {
        stops,
        totalDistanceKm: totalDistanceKm + returnDistanceKm,
        totalTravelMinutes: elapsedMinutes + returnTravelMinutes,
        totalReward,
        totalDemandServed,
        computeTimeMs: runtimeMs,
      },
    };
  });

  return {
    status,
    backend,
    objectiveValue: result.objectiveValue,
    solverStatus: result.status,
    runtimeMs,
    optimalityGap: result.mipGap,
    plans,
  };
}

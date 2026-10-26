import { evacuationGraph } from "@/api/route.service";
import { istMinutesOfDay, istWeekday } from "@/lib/ist-clock";
import { computeExactPlan, type ExactPlanResult } from "@/solver/milp";
import type { Route } from "@/types/game";
import { gameRepository } from "./game.repository";
import { globallyVisitedOrigins, rewardContextFor, shelterCapacityOf } from "./game.service";
import { riskPriorityProvider } from "@/rewards";

/**
 * Session-level exact benchmark: a SINGLE joint MILP solve covering every
 * currently-active team in the session at once, for direct comparison
 * against each team's own baseline/neural suggestion. Backed by either
 * HiGHS (open-source, always available) or genuine IBM CPLEX (Community
 * Edition, installed locally -- see src/solver/milp.ts's header comment
 * for the full story and src/solver/cplex-solver.ts for how it's invoked).
 * Whichever actually ran is reported verbatim in `backend`/`solverStatus`
 * -- never silently substituted.
 *
 * Read-only: never mutates any player or session row. A team is free to
 * ignore this plan entirely and keep playing manually, or replan via
 * replan.service.ts instead -- this is a comparison tool, not an
 * authoritative instruction.
 */
export interface ExactSessionPlan {
  status: ExactPlanResult["status"];
  backend: ExactPlanResult["backend"];
  solverStatus: string;
  objectiveValue?: number;
  runtimeMs: number;
  optimalityGap?: number;
  /** One route per currently-active player, keyed by playerId. */
  routesByPlayerId: Record<number, Route>;
}

export async function computeExactSessionPlan(
  sessionId: number,
  timeLimitSeconds?: number,
  solver?: "highs" | "cplex",
): Promise<ExactSessionPlan> {
  const session = await gameRepository.findSessionById(sessionId);
  const players = await gameRepository.listPlayers(sessionId);
  const activePlayers = players.filter((p) => p.status !== "FINISHED");

  const weekday = istWeekday(session.startedAt);
  const gameStartMinutesOfDay = istMinutesOfDay(session.startedAt);
  const shelterCapacity = shelterCapacityOf(session.depotNodeId);
  const remainingCapacity = Math.max(0, shelterCapacity - session.demandServed);
  const globallyVisited = globallyVisitedOrigins(players);

  const ctx = rewardContextFor(session);
  const snapshot = riskPriorityProvider.getSnapshot(ctx);

  const candidateOriginIds = evacuationGraph.nodes
    .filter((n) => n.role === "origin" && !globallyVisited.has(n.id))
    .map((n) => n.id);

  const result = await computeExactPlan({
    graph: evacuationGraph,
    depotNodeId: session.depotNodeId,
    teams: activePlayers.map((p) => ({
      teamId: p.id,
      currentNodeId: p.currentNodeId,
      remainingMinutes: Math.max(0, session.totalGameMinutes - p.elapsedMinutes),
      shiftedGameStartMinutesOfDay: gameStartMinutesOfDay + p.elapsedMinutes,
    })),
    candidateOriginIds,
    priorities: snapshot.priorities,
    remainingCapacity,
    weekday,
    timeLimitSeconds,
    solver,
  });

  const routesByPlayerId: Record<number, Route> = {};
  for (const plan of result.plans) routesByPlayerId[plan.teamId] = plan.route;

  return {
    status: result.status,
    backend: result.backend,
    solverStatus: result.solverStatus,
    objectiveValue: result.objectiveValue,
    runtimeMs: result.runtimeMs,
    optimalityGap: result.optimalityGap,
    routesByPlayerId,
  };
}

export const exactPlanService = {
  computeExactSessionPlan,
};

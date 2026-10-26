import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { exactPlanService } from "@/game/exact-plan.service";
import { handleRouteError } from "@/api/handle-route-error";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
const querySchema = z.object({
  timeLimitSeconds: z.coerce.number().positive().max(60).optional(),
  solver: z.enum(["highs", "cplex"]).optional(),
});

/** GET /api/sessions/:id/exact-plan -- a single joint MILP solve covering
 * every active team in the session at once, backed by either HiGHS
 * (default, always available) or genuine local CPLEX (`?solver=cplex`,
 * dev-machine only -- see src/solver/milp.ts). Read-only, slow by
 * baseline/neural standards (a few seconds, bounded by `timeLimitSeconds`),
 * and purely a comparison reference -- never mutates any player or
 * session state. */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const { timeLimitSeconds, solver } = querySchema.parse({
      timeLimitSeconds: request.nextUrl.searchParams.get("timeLimitSeconds") ?? undefined,
      solver: request.nextUrl.searchParams.get("solver") ?? undefined,
    });
    const plan = await exactPlanService.computeExactSessionPlan(id, timeLimitSeconds, solver);
    return NextResponse.json(plan);
  } catch (error) {
    return handleRouteError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { replanRequestSchema, commitPlanRequestSchema } from "@/game/game.dto";
import { replanService } from "@/game/replan.service";
import { handleRouteError } from "@/api/handle-route-error";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

/** POST /api/sessions/:id/replan -- recompute (never commit) a team's
 * remaining route from its current node, using both the baseline and the
 * neural-policy-plus-beam-search decomposition. Read-only: never mutates
 * player or session state. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const body = replanRequestSchema.parse(await request.json());
    const outcome = await replanService.replanRoute(id, body.playerId, body.scenarioVersion, body.beamWidth);
    return NextResponse.json(outcome);
  } catch (error) {
    return handleRouteError(error);
  }
}

/** PATCH /api/sessions/:id/replan -- commit a previously computed plan
 * (from the same ReplanSnapshot a prior POST returned) as this team's
 * current cached plan, rejecting it explicitly if shared state has moved
 * on since. */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const body = commitPlanRequestSchema.parse(await request.json());
    const outcome = await replanService.commitPlan(
      id,
      body.playerId,
      {
        scenarioVersion: body.scenarioVersion,
        sessionDemandServed: body.sessionDemandServed,
        playerUpdatedAt: new Date(body.playerUpdatedAtIso),
      },
      body.method,
      body.route,
    );
    return NextResponse.json(outcome);
  } catch (error) {
    return handleRouteError(error);
  }
}

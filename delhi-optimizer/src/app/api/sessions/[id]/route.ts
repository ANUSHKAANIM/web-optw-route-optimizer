import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { joinSessionSchema } from "@/game/game.dto";
import { gameService } from "@/game/game.service";
import { handleRouteError } from "@/api/handle-route-error";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

const patchBodySchema = z.union([
  z.object({ playerId: z.number().int().positive(), nodeId: z.string().min(1) }),
  z.object({ playerId: z.number().int().positive(), end: z.literal(true) }),
  z.object({ advanceForecast: z.literal(true) }),
]);

/** GET /api/sessions/:id             -> shared session state (priorities,
 *                                        forecast, all players)
 *  GET /api/sessions/:id?playerId=X   -> same, plus that player's own path,
 *                                        feasible nodes, and baseline route
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const playerIdRaw = request.nextUrl.searchParams.get("playerId");
    const playerId = playerIdRaw ? z.coerce.number().int().positive().parse(playerIdRaw) : undefined;
    return NextResponse.json(await gameService.getSessionView(id, playerId));
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/sessions/:id -- join an existing session as a new player. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const body = joinSessionSchema.parse(await request.json());
    const view = await gameService.joinSession(id, body);
    return NextResponse.json(view, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

/** PATCH /api/sessions/:id -- collect a node ({playerId, nodeId}), or end
 * that player's game early ({playerId, end: true}). */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const body = patchBodySchema.parse(await request.json());
    const view =
      "advanceForecast" in body
        ? await gameService.advanceForecast(id)
        : "end" in body
          ? await gameService.endPlayer(id, body.playerId)
          : await gameService.collectNode(id, body.playerId, body.nodeId);
    return NextResponse.json(view);
  } catch (error) {
    return handleRouteError(error);
  }
}

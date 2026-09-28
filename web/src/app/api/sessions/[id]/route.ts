import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { joinSessionSchema } from "@/lib/dto/game.dto";
import { gameService } from "@/lib/services/game.service";
import { handleRouteError } from "@/lib/errors/handle-route-error";

// onnxruntime-node is a native addon -- must run on the Node.js runtime, not
// Edge. Consolidated into one route file (GET/POST/PATCH), same reasoning as
// /api/runs/[id]: each route file singled out in next.config.ts's
// outputFileTracingIncludes for the ONNX binary becomes an isolated Lambda,
// and Vercel's Hobby plan caps a deployment at 12 serverless functions.
export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

const patchBodySchema = z.union([
  z.object({ playerId: z.number().int().positive(), node: z.number().int().min(0) }),
  z.object({ playerId: z.number().int().positive(), end: z.literal(true) }),
]);

/** GET /api/sessions/:id                -> shared session state (places, graph,
 *                                            live rewards, all players)
 *  GET /api/sessions/:id?playerId=X      -> same, plus that player's own path
 *                                            and current recommendation
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

/** PATCH /api/sessions/:id -- apply a chosen next node for one player
 * ({playerId, node}), or end that player's route early ({playerId, end: true}). */
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const body = patchBodySchema.parse(await request.json());
    const view =
      "end" in body
        ? await gameService.endPlayer(id, body.playerId)
        : await gameService.stepPlayer(id, body.playerId, body.node);
    return NextResponse.json(view);
  } catch (error) {
    return handleRouteError(error);
  }
}

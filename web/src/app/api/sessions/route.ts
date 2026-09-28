import { NextRequest, NextResponse } from "next/server";
import { createSessionSchema } from "@/lib/dto/game.dto";
import { gameService } from "@/lib/services/game.service";
import { handleRouteError } from "@/lib/errors/handle-route-error";

// onnxruntime-node is a native addon -- must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

/** POST /api/sessions -- creates a new multiplayer Delhi game session and
 * joins the creator as its first player. */
export async function POST(request: NextRequest) {
  try {
    const body = createSessionSchema.parse(await request.json().catch(() => ({})));
    const view = await gameService.createSession(body);
    return NextResponse.json(view, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

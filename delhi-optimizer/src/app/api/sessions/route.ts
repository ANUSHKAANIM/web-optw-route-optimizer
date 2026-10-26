import { NextRequest, NextResponse } from "next/server";
import { createSessionSchema } from "@/game/game.dto";
import { gameService } from "@/game/game.service";
import { handleRouteError } from "@/api/handle-route-error";

export async function POST(request: NextRequest) {
  try {
    const body = createSessionSchema.parse(await request.json().catch(() => ({})));
    const view = await gameService.createSession(body);
    return NextResponse.json(view, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

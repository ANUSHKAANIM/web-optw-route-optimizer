import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { stepRunSchema } from "@/lib/dto/run.dto";
import { runService } from "@/lib/services/run.service.impl";
import { handleRouteError } from "@/lib/errors/handle-route-error";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const body = stepRunSchema.parse(await request.json());
    const view = await runService.stepRun(id, body.node);
    return NextResponse.json(view);
  } catch (error) {
    return handleRouteError(error);
  }
}

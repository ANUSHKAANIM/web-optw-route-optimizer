import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runService } from "@/lib/services/run.service.impl";
import { handleRouteError } from "@/lib/errors/handle-route-error";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const view = await runService.endRun(id);
    return NextResponse.json(view);
  } catch (error) {
    return handleRouteError(error);
  }
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runService } from "@/lib/services/run.service.impl";
import { handleRouteError } from "@/lib/errors/handle-route-error";

export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const view = await runService.compareRun(id);
    return NextResponse.json(view);
  } catch (error) {
    return handleRouteError(error);
  }
}

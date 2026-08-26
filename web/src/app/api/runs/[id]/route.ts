import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runService } from "@/lib/services/run.service.impl";
import { handleRouteError } from "@/lib/errors/handle-route-error";
import { stepRunSchema } from "@/lib/dto/run.dto";

// Consolidated into one route file (GET/POST/PATCH) rather than separate
// step/end/compare/events routes: each route this app's outputFileTracingIncludes
// singles out for the ONNX runtime binary loses Next's automatic
// function-sharing and becomes its own isolated Lambda, and Vercel's Hobby
// plan caps a deployment at 12 serverless functions -- 6 separately-included
// routes (plus their RSC/segment output variants) blew past that. Down to 2
// (this file + POST /api/runs) keeps the deployment well under the cap.
export const runtime = "nodejs";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

/** GET /api/runs/:id             -> the run
 *  GET /api/runs/:id?view=compare -> greedy-vs-beam comparison
 *  GET /api/runs/:id?view=events  -> the run's step-by-step event log
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const view = request.nextUrl.searchParams.get("view");

    if (view === "compare") {
      return NextResponse.json(await runService.compareRun(id));
    }
    if (view === "events") {
      return NextResponse.json({ events: await runService.listEvents(id) });
    }
    return NextResponse.json(await runService.getRun(id));
  } catch (error) {
    return handleRouteError(error);
  }
}

/** POST /api/runs/:id -- apply a chosen next node (live-routing step). */
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

/** PATCH /api/runs/:id -- end the run early (mirrors the CLI's 'q' -> depot). */
export async function PATCH(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = paramsSchema.parse(await context.params);
    const view = await runService.endRun(id);
    return NextResponse.json(view);
  } catch (error) {
    return handleRouteError(error);
  }
}

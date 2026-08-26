import { NextRequest, NextResponse } from "next/server";
import { createRunSchema, listRunsQuerySchema } from "@/lib/dto/run.dto";
import { runService } from "@/lib/services/run.service.impl";
import { handleRouteError } from "@/lib/errors/handle-route-error";

// onnxruntime-node is a native addon -- must run on the Node.js runtime, not Edge.
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = createRunSchema.parse(await request.json().catch(() => ({})));
    const view = await runService.createRun(body);
    return NextResponse.json(view, { status: 201 });
  } catch (error) {
    return handleRouteError(error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const query = listRunsQuerySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams.entries()),
    );
    const result = await runService.listRuns(query);
    return NextResponse.json(result);
  } catch (error) {
    return handleRouteError(error);
  }
}

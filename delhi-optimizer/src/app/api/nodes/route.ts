import { NextResponse } from "next/server";
import { EVACUATION_NODES } from "@/data/evacuation-nodes";
import { evacuationGraph } from "@/api/route.service";

export async function GET() {
  return NextResponse.json({
    nodes: EVACUATION_NODES,
    edges: evacuationGraph.edges,
  });
}

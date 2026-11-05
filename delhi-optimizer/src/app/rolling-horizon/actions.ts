"use server";

import { revalidatePath } from "next/cache";
import { session, logEvent, TICK_STEP_MINUTES, SOLVER_TIER_THRESHOLDS, type SolverTier } from "./session";

/** revalidatePath() requires Next's real request-scoped static-generation
 * store, which only exists when this runs inside an actual Next.js
 * server action invocation -- not when these functions are called
 * directly (e.g. actions.test.ts, which exercises the real session
 * mutation logic without going through Next's RPC wire format, since
 * Server Actions can't be meaningfully curl-tested). Swallowing the
 * invariant here is specifically for that gap, not for hiding real
 * failures -- revalidatePath itself has no other failure mode worth
 * surfacing. */
function safeRevalidate(path: string): void {
  try {
    revalidatePath(path);
  } catch {
    // no-op outside a real Next.js request context (see above)
  }
}

function nowMinutes(): number {
  // "Now" within the session's own timeline: just past the last tick's
  // start, so event-driven actions (arrival, override) land inside the
  // current tick's forecast, not the next one.
  return Math.max(0, session.currentTick) * TICK_STEP_MINUTES + 1;
}

export async function setSolverTier(tier: SolverTier): Promise<void> {
  session.solverTier = tier;
  logEvent(
    tier === "real"
      ? "Solver tier switched to Real -- every replan now runs the trained Pointer Network + beam search (~5s/tick, measured)."
      : "Solver tier switched to Fast -- every replan uses the greedy baseline (~150ms/tick, measured).",
  );
  safeRevalidate("/rolling-horizon");
}

export async function advanceTick(): Promise<void> {
  const nextTick = session.currentTick + 1;
  const thresholds = SOLVER_TIER_THRESHOLDS[session.solverTier];
  const routes = await session.controller.onForecastTick(nextTick, nextTick * TICK_STEP_MINUTES, thresholds);
  for (const [vanId, route] of routes) session.vanRoutes.set(vanId, route);
  session.currentTick = nextTick;
  logEvent(`Tick ${nextTick}: forecast advanced. ${routes.size} van(s) outside their commit window were replanned.`);
  safeRevalidate("/rolling-horizon");
}

export async function simulateArrival(vanId: number, cellId: string, cellName: string): Promise<void> {
  if (session.currentTick < 0) return;
  const thresholds = SOLVER_TIER_THRESHOLDS[session.solverTier];
  const routes = await session.controller.onVanArrival(vanId, cellId, nowMinutes(), thresholds);
  for (const [id, route] of routes) session.vanRoutes.set(id, route);
  logEvent(`Van ${vanId + 1} evacuated ${cellName} -- masked immediately for every other van, its own route replanned.`);
  safeRevalidate("/rolling-horizon");
}

export async function overrideVan(vanId: number, cellId: string, cellName: string): Promise<void> {
  if (session.currentTick < 0) return;
  const thresholds = SOLVER_TIER_THRESHOLDS[session.solverTier];
  const routes = await session.controller.onHumanOverride(vanId, cellId, nowMinutes(), thresholds);
  for (const [id, route] of routes) session.vanRoutes.set(id, route);
  const honored = routes.get(vanId)?.stops[0]?.nodeId === cellId;
  logEvent(
    `Van ${vanId + 1} overridden to ${cellName} -- ${honored ? "honored as its next stop" : "could not be honored (unreachable), fell back to normal planning"}.`,
  );
  safeRevalidate("/rolling-horizon");
}

"use server";

import { revalidatePath } from "next/cache";
import { getSession, logEvent, advanceTick as advanceTickSession, onVanArrival, onHumanOverride } from "./session";
import { TICK_STEP_MINUTES, type SolverTier } from "./scene-data";

/** Same gap/fix /rolling-horizon's actions.ts documents: revalidatePath
 * needs a real Next.js request context, which direct test invocation
 * doesn't have. Swallowed here for the same reason, not to hide real
 * failures. */
function safeRevalidate(): void {
  try {
    revalidatePath("/idalia-preview");
  } catch {
    // no-op outside a real Next.js request context
  }
}

function nowMinutes(session: { currentTick: number }): number {
  return Math.max(0, session.currentTick) * TICK_STEP_MINUTES + 1;
}

export async function setSolverTier(tier: SolverTier): Promise<void> {
  const session = getSession();
  if (!session) return;
  session.solverTier = tier;
  logEvent(
    session,
    tier === "real"
      ? "Solver tier switched to Real -- exact/neural picked per shelter by its own tract count."
      : "Solver tier switched to Fast -- every replan uses the greedy baseline.",
  );
  safeRevalidate();
}

export async function advanceTick(): Promise<void> {
  const session = getSession();
  if (!session) return;
  const routes = await advanceTickSession(session, TICK_STEP_MINUTES);
  for (const [vanId, route] of routes) session.vanRoutes.set(vanId, route);
  logEvent(session, `Tick ${session.currentTick}: ${routes.size} van(s) replanned.`);
  safeRevalidate();
}

export async function simulateArrival(vanId: number, cellId: string, cellName: string): Promise<void> {
  const session = getSession();
  if (!session || session.currentTick < 0) return;
  const routes = await onVanArrival(session, vanId, cellId, nowMinutes(session));
  for (const [id, route] of routes) session.vanRoutes.set(id, route);
  logEvent(session, `Van ${vanId + 1} evacuated ${cellName} -- masked for every other van, its own route replanned.`);
  safeRevalidate();
}

export async function overrideVan(vanId: number, cellId: string, cellName: string): Promise<void> {
  const session = getSession();
  if (!session || session.currentTick < 0) return;
  const routes = await onHumanOverride(session, vanId, cellId, nowMinutes(session));
  for (const [id, route] of routes) session.vanRoutes.set(id, route);
  const honored = routes.get(vanId)?.stops[0]?.nodeId === cellId;
  logEvent(
    session,
    `Van ${vanId + 1} overridden to ${cellName} -- ${honored ? "honored as its next stop" : "could not be honored (unreachable), fell back to normal planning"}.`,
  );
  safeRevalidate();
}

"use server";

import { revalidatePath } from "next/cache";
import {
  advanceForecast as advanceForecastSession,
  setSolverTierSync,
  markEvacuatedSync,
  resetSessionSync,
  type VanPosition,
  type SolverTier,
} from "./session";

function safeRevalidate(): void {
  try {
    revalidatePath("/control-room");
  } catch {
    // no-op outside a real Next.js request context
  }
}

/** The ONE interaction this page has: pull the next forecast now, same as
 * clicking the countdown. `vanPositions` is each van's CURRENT (x, y) --
 * computed client-side from its live animation along its existing route,
 * not the shelter -- so the new route starts from wherever the van
 * visually is right now, not reset back to the depot. See session.ts's
 * header comment for why this can't be done through RollingHorizonController. */
export async function advanceForecast(vanPositions: VanPosition[]): Promise<void> {
  await advanceForecastSession(vanPositions);
  safeRevalidate();
}

export async function setSolverTier(tier: SolverTier): Promise<void> {
  setSolverTierSync(tier);
  safeRevalidate();
}

/** Fired by the client the moment a van's animation actually passes a
 * stop -- masks that village so no van (including this one, on its next
 * replan) is ever offered it again. */
export async function markEvacuated(nodeId: string): Promise<void> {
  markEvacuatedSync(nodeId);
  safeRevalidate();
}

/** Starts a brand new session -- fresh random scenario, tick back to -1,
 * every van reset to its home shelter, nothing evacuated. */
export async function resetSession(): Promise<void> {
  resetSessionSync();
  safeRevalidate();
}

"use server";

import { revalidatePath } from "next/cache";
import {
  advanceForecast as advanceForecastSession,
  setSolverTierSync,
  markEvacuatedSync,
  resetSessionSync,
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
 * clicking the countdown. Always moves the storm clock exactly one 6 h
 * forecast cycle: the server plays every van forward 6 h along its route
 * timeline (so Skip after 5 s and waiting the full 2 min end up the same)
 * and replans from there. */
export async function advanceForecast(): Promise<void> {
  await advanceForecastSession();
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

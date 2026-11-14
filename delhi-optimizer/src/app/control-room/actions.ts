"use server";

import { revalidatePath } from "next/cache";
import {
  advanceForecast as advanceForecastSession,
  markEvacuatedSync,
  resetSessionSync,
  type SolverTier,
} from "./session";
import { setAppSolverTier } from "@/lib/solver-preference";

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
  await advanceForecastSession("scheduled");
  safeRevalidate();
}

/** A sudden special advisory, issued NOW: only the storm time that has
 * really passed since the last forecast is played out, then every van is
 * rerouted from exactly where it is. The regular 6 h schedule is unchanged. */
export async function issueSpecialAdvisory(): Promise<void> {
  await advanceForecastSession("special");
  safeRevalidate();
}

export async function setSolverTier(tier: SolverTier): Promise<void> {
  // App-wide: also switches the rolling-horizon page and the sidebar.
  setAppSolverTier(tier);
  safeRevalidate();
  try {
    revalidatePath("/", "layout");
  } catch {
    // no-op outside a real Next.js request context
  }
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

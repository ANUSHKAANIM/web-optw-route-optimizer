import { session as controlRoom, setSolverTierSync } from "@/app/control-room/session";
import { session as rollingHorizon, logEvent as logRollingHorizon } from "@/app/rolling-horizon/session";

/** One solver choice for the whole app: the live pages (control room and
 * rolling horizon) each keep their own session, but switching the solver
 * anywhere -- the sidebar or either page's own buttons -- switches both. */
export type AppSolverTier = "fast" | "real";

export function getAppSolverTier(): AppSolverTier {
  return controlRoom.solverTier;
}

export function setAppSolverTier(tier: AppSolverTier): void {
  if (controlRoom.solverTier !== tier) setSolverTierSync(tier);
  if (rollingHorizon.solverTier !== tier) {
    rollingHorizon.solverTier = tier;
    logRollingHorizon(tier === "real" ? "Solver switched to Real (neural Pointer Network)." : "Solver switched to Fast (greedy).");
  }
}

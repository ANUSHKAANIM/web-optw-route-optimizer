/** One solver choice for the whole app. The live pages (control room and
 * rolling horizon) each keep their own session, but they all read the
 * solver from here, so switching it anywhere -- the sidebar or either
 * page's own buttons -- switches it everywhere.
 *
 * Deliberately imports no session module: the sidebar reads this on every
 * page, and importing a session would build that whole simulation in
 * memory on every page load. */
export type AppSolverTier = "fast" | "real";

const store = globalThis as unknown as { appSolverTier?: AppSolverTier };

export function getAppSolverTier(): AppSolverTier {
  return store.appSolverTier ?? "real";
}

export function setAppSolverTier(tier: AppSolverTier): void {
  store.appSolverTier = tier;
}

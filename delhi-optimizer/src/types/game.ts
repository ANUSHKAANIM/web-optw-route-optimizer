/**
 * Everything the optimization layer needs to decide "what's the best next
 * node," expressed generically. `riskScore` and `currentPriority` are kept
 * as two separate fields deliberately: risk is the raw hazard estimate at
 * a node, priority is what the optimizer actually tries to maximize
 * (demand-weighted risk -- see risk-priority-provider.ts). Collapsing
 * these into one number was an explicit, audited gap in an earlier design;
 * a future real forecast feed can replace how riskScore is computed
 * without anything below this type changing.
 */
/** Why a node is currently infeasible, for display -- never used in the
 * feasibility decision itself (that stays a single boolean check in
 * computeNodeStates), only computed afterward to explain an already-made
 * decision to a human. */
export type InfeasibilityReason =
  | "already_done"
  | "closed_today"
  | "time_window"
  | "time_budget"
  | "shelter_capacity";

export interface NodeState {
  nodeId: string;
  /** Raw hazard/risk estimate for this node right now, 0-1. Informational
   * -- the optimizer does not read this directly. */
  riskScore: number;
  /** The number the optimizer actually tries to maximize. */
  currentPriority: number;
  isOpenNow: boolean;
  minutesUntilClosing: number | null;
  visited: boolean;
  /** True only if the visit can be started (accessible), completed before
   * the access window closes, the player can still get back within the
   * remaining time budget, AND (for an origin) the shelter still has
   * enough remaining capacity to receive this many more evacuees. */
  feasible: boolean;
  /** Which specific rule blocked this node, when `feasible` is false --
   * undefined when feasible is true. If more than one rule is violated,
   * reports the first one checked (already_done, then closed_today, then
   * time_window, then time_budget, then shelter_capacity), since that's
   * the one the UI explains first and the others are moot once that one
   * applies. */
  infeasibleReason?: InfeasibilityReason;
}

export interface RouteStop {
  nodeId: string;
  arrivalMinutes: number;
  waitMinutes: number;
  departureMinutes: number;
  rewardCollected: number;
  /** Population evacuated at this stop (0 for the shelter itself). */
  demandServed: number;
}

export interface Route {
  stops: RouteStop[];
  totalDistanceKm: number;
  totalTravelMinutes: number;
  totalReward: number;
  /** Sum of demand served across all stops -- the primary task metric,
   * distinct from totalReward (which is risk-weighted, not a population
   * count). */
  totalDemandServed: number;
  /** Wall-clock ms the policy took to compute this route -- surfaced for
   * the RL-vs-baseline-vs-CPLEX comparison, not used by the optimizer itself. */
  computeTimeMs: number;
}

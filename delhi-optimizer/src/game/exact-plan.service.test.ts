import { describe, expect, it } from "vitest";
import { SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { gameService } from "./game.service";
import { exactPlanService } from "./exact-plan.service";

describe("exactPlanService", () => {
  async function newSession(playerName: string) {
    return gameService.createSession({
      playerName,
      depotNodeId: SHELTER_DEPOT_ID,
      totalGameMinutes: 600,
      forecastIntervalSeconds: 9 * 3600,
    });
  }

  it("computes one joint plan covering every active player in the session", async () => {
    const created = await newSession("Xena");
    const joined = await gameService.joinSession(created.session.id, { playerName: "Yusuf" });

    const plan = await exactPlanService.computeExactSessionPlan(created.session.id, 30);
    expect(["optimal", "time_limit"]).toContain(plan.status);
    expect(plan.routesByPlayerId[created.self!.id]).toBeDefined();
    expect(plan.routesByPlayerId[joined.self!.id]).toBeDefined();
  }, 45_000);

  it("never assigns the same village to two players, and respects the shared capacity already consumed", async () => {
    const created = await newSession("Zara");
    const joined = await gameService.joinSession(created.session.id, { playerName: "Amir" });

    // Zara already evacuates one origin for real before the exact solve runs.
    const claimedId = created.self!.feasibleNodeIds[0];
    await gameService.collectNode(created.session.id, created.self!.id, claimedId);

    const plan = await exactPlanService.computeExactSessionPlan(created.session.id, 15);
    expect(plan.status).toBe("optimal");

    const assigned = Object.values(plan.routesByPlayerId).flatMap((r) => r.stops.map((s) => s.nodeId));
    expect(assigned).not.toContain(claimedId); // already globally evacuated
    expect(new Set(assigned).size).toBe(assigned.length); // no duplicates

    const view = await gameService.getSessionView(created.session.id, joined.self!.id);
    const totalPlannedDemand = Object.values(plan.routesByPlayerId).reduce((sum, r) => sum + r.totalDemandServed, 0);
    expect(view.session.demandServed + totalPlannedDemand).toBeLessThanOrEqual(view.session.shelterCapacity);
  }, 30_000);

  it("excludes a FINISHED player from the joint plan", async () => {
    const created = await newSession("Bo");
    await gameService.endPlayer(created.session.id, created.self!.id);

    const plan = await exactPlanService.computeExactSessionPlan(created.session.id, 15);
    expect(plan.routesByPlayerId[created.self!.id]).toBeUndefined();
  }, 30_000);
});

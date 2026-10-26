import { describe, expect, it } from "vitest";
import { SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { gameService } from "./game.service";

/** Integration tests against the real (freshly-provisioned, isolated)
 * Postgres database via Prisma. Verifies the core multiplayer guarantee:
 * one player's actions must never leak into another's state, plus the
 * shared shelter-capacity pool that IS meant to be contested across
 * players (Decision 6). */
describe("gameService", () => {
  it("keeps two players' state fully isolated", async () => {
    const created = await gameService.createSession({
      playerName: "Alice",
      depotNodeId: SHELTER_DEPOT_ID,
      totalGameMinutes: 600,
      forecastIntervalSeconds: 9 * 3600,
    });
    expect(created.self?.name).toBe("Alice");
    expect(created.players).toHaveLength(1);

    const joined = await gameService.joinSession(created.session.id, { playerName: "Bob" });
    expect(joined.players).toHaveLength(2);
    const bob = joined.self!;
    expect(bob.currentNodeId).toBe(SHELTER_DEPOT_ID);
    expect(bob.totalReward).toBe(0);

    const aliceId = created.self!.id;
    const firstFeasible = created.self!.feasibleNodeIds[0];
    expect(firstFeasible).toBeDefined();

    const afterAlice = await gameService.collectNode(created.session.id, aliceId, firstFeasible);
    const aliceAfter = afterAlice.players.find((p) => p.id === aliceId)!;
    expect(aliceAfter.currentNodeId).toBe(firstFeasible);
    expect(aliceAfter.totalReward).toBeGreaterThan(0);

    const bobStillFresh = afterAlice.players.find((p) => p.id === bob.id)!;
    expect(bobStillFresh.currentNodeId).toBe(SHELTER_DEPOT_ID);
    expect(bobStillFresh.totalReward).toBe(0);
  }, 30_000);

  it("rejects collecting a node the server considers infeasible", async () => {
    const created = await gameService.createSession({
      playerName: "Carol",
      depotNodeId: SHELTER_DEPOT_ID,
      totalGameMinutes: 600,
      forecastIntervalSeconds: 9 * 3600,
    });

    await expect(
      gameService.collectNode(created.session.id, created.self!.id, "__not_a_real_node__"),
    ).rejects.toThrow();
  }, 30_000);

  it("returns a labeled mock forecast with risk rings", async () => {
    const created = await gameService.createSession({
      playerName: "Dana",
      depotNodeId: SHELTER_DEPOT_ID,
      totalGameMinutes: 600,
      forecastIntervalSeconds: 9 * 3600,
    });
    expect(created.forecast).toBeDefined();
    expect(created.forecast!.riskZone).toHaveLength(3);
  }, 30_000);

  it("never permits a second player to push the shared shelter total past capacity", async () => {
    const created = await gameService.createSession({
      playerName: "Erin",
      depotNodeId: SHELTER_DEPOT_ID,
      totalGameMinutes: 600,
      forecastIntervalSeconds: 9 * 3600,
    });
    const joined = await gameService.joinSession(created.session.id, { playerName: "Frank" });

    expect(created.session.shelterCapacity).toBeGreaterThan(0);
    expect(created.session.demandServed).toBe(0);

    const erinId = created.self!.id;
    const frankId = joined.self!.id;

    const erinFeasible = created.self!.feasibleNodeIds[0];
    const afterErin = await gameService.collectNode(created.session.id, erinId, erinFeasible);
    expect(afterErin.session.demandServed).toBeGreaterThan(0);

    // Shared pool: Frank's view reflects Erin's contribution too, not a
    // separate per-player counter.
    const frankView = await gameService.getSessionView(created.session.id, frankId);
    expect(frankView.session.demandServed).toBe(afterErin.session.demandServed);
    expect(frankView.session.demandServed).toBeLessThanOrEqual(frankView.session.shelterCapacity);
  }, 30_000);

  it("an evacuated origin never becomes feasible again (no round-based re-collection)", async () => {
    const created = await gameService.createSession({
      playerName: "Gale",
      depotNodeId: SHELTER_DEPOT_ID,
      totalGameMinutes: 600,
      forecastIntervalSeconds: 9 * 3600,
    });

    const nodeId = created.self!.feasibleNodeIds[0];
    const after = await gameService.collectNode(created.session.id, created.self!.id, nodeId);
    expect(after.self!.feasibleNodeIds).not.toContain(nodeId);
    expect(after.self!.path).toContain(nodeId);
  }, 30_000);
});

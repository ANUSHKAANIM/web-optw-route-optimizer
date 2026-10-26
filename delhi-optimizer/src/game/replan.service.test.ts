import { describe, expect, it } from "vitest";
import { SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { gameService } from "./game.service";
import { replanService } from "./replan.service";
import { gameRepository } from "./game.repository";

/** Integration tests against the real (isolated) Postgres database, same
 * pattern as game.service.test.ts. Covers the dynamic-replanning service's
 * read-only planning step, the optimistic-concurrency commit step, and
 * their interaction with Phase 1's shared-state invariants. */
describe("replanService", () => {
  async function newSession(playerName: string, totalGameMinutes = 600) {
    return gameService.createSession({
      playerName,
      depotNodeId: SHELTER_DEPOT_ID,
      totalGameMinutes,
      forecastIntervalSeconds: 9 * 3600,
    });
  }

  it("1. replans from the team's ACTUAL current node, not the original depot", async () => {
    const created = await newSession("Harvey");
    const sessionId = created.session.id;
    const playerId = created.self!.id;

    const fromDepot = await replanService.replanRoute(sessionId, playerId);
    if (fromDepot.status !== "ok") throw new Error("expected ok");

    const collectedNodeId = created.self!.feasibleNodeIds[0];
    await gameService.collectNode(sessionId, playerId, collectedNodeId);

    const fromNewPosition = await replanService.replanRoute(sessionId, playerId);
    if (fromNewPosition.status !== "ok") throw new Error("expected ok");

    // The already-visited node can never appear again in either route, and
    // planning from the new position must produce a DIFFERENT plan than
    // planning from the depot did (proves it actually used the new state).
    expect(fromNewPosition.baseline.route.stops.map((s) => s.nodeId)).not.toContain(collectedNodeId);
    expect(fromNewPosition.selected.route.stops.map((s) => s.nodeId)).not.toContain(collectedNodeId);
    expect(fromNewPosition.baseline.route.stops).not.toEqual(fromDepot.baseline.route.stops);
  }, 30_000);

  it("2. replanning never mutates completed rescues or committed progress", async () => {
    const created = await newSession("Ingrid");
    const sessionId = created.session.id;
    const playerId = created.self!.id;
    const collectedNodeId = created.self!.feasibleNodeIds[0];
    const afterCollect = await gameService.collectNode(sessionId, playerId, collectedNodeId);
    const before = afterCollect.players.find((p) => p.id === playerId)!;

    const outcome = await replanService.replanRoute(sessionId, playerId);
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      await replanService.commitPlan(sessionId, playerId, outcome.snapshot, outcome.selected.method, outcome.selected.route);
    }

    const after = await gameService.getSessionView(sessionId, playerId);
    const afterPlayer = after.players.find((p) => p.id === playerId)!;
    expect(afterPlayer.currentNodeId).toBe(before.currentNodeId);
    expect(afterPlayer.totalReward).toBe(before.totalReward);
    expect(after.self!.path).toEqual(afterCollect.self!.path);
  }, 30_000);

  it("3. excludes a village another team has already evacuated", async () => {
    const created = await newSession("Jaime");
    const sessionId = created.session.id;
    const joined = await gameService.joinSession(sessionId, { playerName: "Kara" });

    const jaimeId = created.self!.id;
    const karaId = joined.self!.id;
    const claimedNodeId = created.self!.feasibleNodeIds[0];
    await gameService.collectNode(sessionId, jaimeId, claimedNodeId);

    const outcome = await replanService.replanRoute(sessionId, karaId);
    if (outcome.status !== "ok") throw new Error("expected ok");
    expect(outcome.baseline.route.stops.map((s) => s.nodeId)).not.toContain(claimedNodeId);
    if ("route" in outcome.neural) {
      expect(outcome.neural.route.stops.map((s) => s.nodeId)).not.toContain(claimedNodeId);
    }
  }, 30_000);

  it("4. both routes respect the shared shelter-capacity constraint", async () => {
    const created = await newSession("Leo");
    const outcome = await replanService.replanRoute(created.session.id, created.self!.id);
    if (outcome.status !== "ok") throw new Error("expected ok");
    expect(outcome.baseline.route.totalDemandServed).toBeLessThanOrEqual(created.session.shelterCapacity);
    if ("route" in outcome.neural) {
      expect(outcome.neural.route.totalDemandServed).toBeLessThanOrEqual(created.session.shelterCapacity);
    }
  }, 30_000);

  it("5. a forecast update invalidates a plan computed against the old scenario", async () => {
    const created = await newSession("Mona");
    const sessionId = created.session.id;
    const playerId = created.self!.id;

    const outcome = await replanService.replanRoute(sessionId, playerId);
    if (outcome.status !== "ok") throw new Error("expected ok");
    const staleSnapshot = outcome.snapshot;

    await gameService.advanceForecast(sessionId);

    const commitResult = await replanService.commitPlan(
      sessionId,
      playerId,
      staleSnapshot,
      outcome.selected.method,
      outcome.selected.route,
    );
    expect(commitResult).toEqual({ committed: false, reason: "stale_scenario_version" });

    // Re-requesting a replan tagged with the now-stale version is also
    // rejected explicitly, before any computation happens.
    const retried = await replanService.replanRoute(sessionId, playerId, staleSnapshot.scenarioVersion);
    expect(retried.status).toBe("stale_scenario_version");
  }, 30_000);

  it("6. a newer committed plan cannot be overwritten by a stale commit", async () => {
    const created = await newSession("Noor");
    const sessionId = created.session.id;
    const playerId = created.self!.id;

    const first = await replanService.replanRoute(sessionId, playerId);
    if (first.status !== "ok") throw new Error("expected ok");
    const staleSnapshot = first.snapshot;

    const firstCommit = await replanService.commitPlan(sessionId, playerId, staleSnapshot, first.selected.method, first.selected.route);
    expect(firstCommit.committed).toBe(true);

    // Committing again with the SAME (now stale, since the player row's
    // updatedAt moved when the first commit landed) snapshot must fail.
    const staleCommit = await replanService.commitPlan(sessionId, playerId, staleSnapshot, first.selected.method, first.selected.route);
    expect(staleCommit).toEqual({ committed: false, reason: "stale_player_state" });
  }, 30_000);

  it("7. a concurrent rescue of a planned village is caught as a route conflict, not a silent overwrite", async () => {
    const created = await newSession("Omar");
    const sessionId = created.session.id;
    const joined = await gameService.joinSession(sessionId, { playerName: "Priya" });
    const omarId = created.self!.id;
    const priyaId = joined.self!.id;

    const omarPlan = await replanService.replanRoute(sessionId, omarId);
    const priyaPlan = await replanService.replanRoute(sessionId, priyaId);
    if (omarPlan.status !== "ok" || priyaPlan.status !== "ok") throw new Error("expected ok");
    expect(priyaPlan.baseline.route.stops.length).toBeGreaterThan(0);

    // Priya actually rescues the village her own plan's first stop names,
    // BEFORE Omar's plan (computed moments earlier, possibly naming the
    // same village) gets committed.
    const priyaTarget = priyaPlan.baseline.route.stops[0].nodeId;
    await gameService.collectNode(sessionId, priyaId, priyaTarget);

    if (omarPlan.baseline.route.stops.some((s) => s.nodeId === priyaTarget)) {
      const omarCommit = await replanService.commitPlan(
        sessionId,
        omarId,
        omarPlan.snapshot,
        omarPlan.selected.method,
        omarPlan.selected.route,
      );
      // Priya's collect changed BOTH the shared demandServed total and the
      // global-visited set, so either the capacity or the conflict guard
      // may be the one that actually fires first -- what matters is that
      // the commit is rejected explicitly, not which specific guard caught it.
      expect(omarCommit.committed).toBe(false);
      if (!omarCommit.committed) {
        expect(["stale_capacity", "route_conflict"]).toContain(omarCommit.reason);
      }
    }
  }, 30_000);

  it("8. a stale scenario version passed to replanRoute itself produces an explicit outcome (not a thrown error)", async () => {
    const created = await newSession("Quinn");
    const outcome = await replanService.replanRoute(created.session.id, created.self!.id, 999_999);
    expect(outcome).toMatchObject({ status: "stale_scenario_version", requestedScenarioVersion: 999_999 });
  }, 30_000);

  it("9. no feasible route is handled safely (explicit empty route, never a throw)", async () => {
    const created = await newSession("Rosa", 2); // far too little budget for even one stop
    const outcome = await replanService.replanRoute(created.session.id, created.self!.id);
    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.baseline.route.stops).toHaveLength(0);
      expect(outcome.baseline.route.totalReward).toBe(0);
      if ("route" in outcome.neural) {
        expect(outcome.neural.route.stops).toHaveLength(0);
      }
      expect(outcome.selected.route.stops).toHaveLength(0);
    }
  }, 30_000);

  it("10. baseline and neural are evaluated against the identical snapshot (one shared version, not two)", async () => {
    const created = await newSession("Sam");
    const outcome = await replanService.replanRoute(created.session.id, created.self!.id);
    if (outcome.status !== "ok") throw new Error("expected ok");
    // One shared snapshot object covers both methods -- not a per-method version.
    expect(outcome.snapshot.sessionDemandServed).toBe(created.session.demandServed);
    expect(outcome.snapshot.scenarioVersion).toBe(created.forecast!.scenarioId);
  }, 30_000);

  it("11. Phase 1's atomic shared-capacity collection still behaves correctly alongside replanning", async () => {
    const created = await newSession("Tariq");
    const sessionId = created.session.id;
    const joined = await gameService.joinSession(sessionId, { playerName: "Uma" });

    await replanService.replanRoute(sessionId, created.self!.id);
    await replanService.replanRoute(sessionId, joined.self!.id);

    const nodeId = created.self!.feasibleNodeIds[0];
    const after = await gameService.collectNode(sessionId, created.self!.id, nodeId);
    expect(after.session.demandServed).toBeGreaterThan(0);
    expect(after.session.demandServed).toBeLessThanOrEqual(after.session.shelterCapacity);
  }, 30_000);

  it("12. a committed plan is retrievable through the normal session view, and goes stale on forecast advance", async () => {
    const created = await newSession("Vera");
    const sessionId = created.session.id;
    const playerId = created.self!.id;

    const outcome = await replanService.replanRoute(sessionId, playerId);
    if (outcome.status !== "ok") throw new Error("expected ok");
    const commit = await replanService.commitPlan(sessionId, playerId, outcome.snapshot, outcome.selected.method, outcome.selected.route);
    expect(commit.committed).toBe(true);

    const view = await gameService.getSessionView(sessionId, playerId);
    expect(view.self!.plan).toBeDefined();
    expect(view.self!.plan!.method).toBe(outcome.selected.method);
    expect(view.self!.plan!.isStale).toBe(false);

    await gameService.advanceForecast(sessionId);
    const viewAfterForecast = await gameService.getSessionView(sessionId, playerId);
    expect(viewAfterForecast.self!.plan!.isStale).toBe(true);
  }, 30_000);

  it("true concurrency at the repository/transaction layer: two simultaneous commits for the same player, only one wins", async () => {
    const created = await newSession("Wendy");
    const sessionId = created.session.id;
    const playerId = created.self!.id;

    const outcome = await replanService.replanRoute(sessionId, playerId);
    if (outcome.status !== "ok") throw new Error("expected ok");

    const commitParams = {
      sessionId,
      playerId,
      expectedPlayerUpdatedAt: outcome.snapshot.playerUpdatedAt,
      expectedSessionDemandServed: outcome.snapshot.sessionDemandServed,
      routeStopNodeIds: outcome.selected.route.stops.map((s) => s.nodeId),
      planData: {
        planRoute: JSON.parse(JSON.stringify(outcome.selected.route)),
        planMethod: outcome.selected.method,
        planScenarioVersion: outcome.snapshot.scenarioVersion,
        planComputedAt: new Date(),
      },
    };

    // Fire two structurally identical commit attempts at the SAME instant,
    // both racing against the player row's real `updatedAt` -- an
    // application-level mock couldn't prove this; only the database's own
    // row-level locking during each transaction's conditional UPDATE can.
    const [first, second] = await Promise.all([
      gameRepository.commitPlayerPlanIfFresh(commitParams),
      gameRepository.commitPlayerPlanIfFresh(commitParams),
    ]);

    const succeeded = [first, second].filter((r) => r.ok);
    const failed = [first, second].filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ ok: false, reason: "stale_player_state" });
  }, 30_000);
});

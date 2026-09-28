import { describe, expect, it } from "vitest";
import { gameService } from "./game.service";

/** End-to-end multiplayer check against real ONNX inference and the local
 * PGlite dev database (same one `npm run dev` uses -- these tests add a
 * handful of harmless game_sessions/players rows, mirroring what a
 * developer manually trying the feature would produce; they never touch
 * production, since that requires DATABASE_URL to be set). Verifies the
 * core multiplayer guarantee from the spec: one player's moves must never
 * leak into another player's state, while both still see the same shared,
 * live dynamic reward snapshot. */
describe("gameService (multiplayer, real ONNX + local DB)", () => {
  it("keeps two players' state fully isolated while sharing the same live rewards", async () => {
    const created = await gameService.createSession({
      maxTime: 8,
      beamWidth: 8,
      rewardDecayMin: 0.3,
      rewardIntervalSeconds: 45,
      playerName: "Alice",
    });
    expect(created.self?.name).toBe("Alice");
    expect(created.players).toHaveLength(1);

    const joined = await gameService.joinSession(created.session.id, { playerName: "Bob" });
    expect(joined.players).toHaveLength(2);
    const bob = joined.self!;
    expect(bob.name).toBe("Bob");
    expect(bob.currentNode).toBe(0);
    expect(bob.totalReward).toBe(0);

    const aliceId = created.self!.id;
    const firstMove = created.self!.recommendation.feasibleNodes[0];
    expect(firstMove).toBeGreaterThan(0);

    const afterAliceStep = await gameService.stepPlayer(created.session.id, aliceId, firstMove);
    const aliceAfter = afterAliceStep.players.find((p) => p.id === aliceId)!;
    expect(aliceAfter.currentNode).toBe(firstMove);
    expect(aliceAfter.visitedCount).toBe(2);

    // Bob never moved -- his own row must be completely untouched by Alice's step.
    const bobStillFresh = afterAliceStep.players.find((p) => p.id === bob.id)!;
    expect(bobStillFresh.currentNode).toBe(0);
    expect(bobStillFresh.totalReward).toBe(0);
    expect(bobStillFresh.visitedCount).toBe(1);

    // Both players still read the same shared, currently-live reward snapshot.
    const aliceView = await gameService.getSessionView(created.session.id, aliceId);
    const bobView = await gameService.getSessionView(created.session.id, bob.id);
    expect(aliceView.currentRewards).toEqual(bobView.currentRewards);
  }, 60_000);

  it("rejects a move to a node the server considers infeasible, even if requested directly", async () => {
    const created = await gameService.createSession({
      maxTime: 8,
      beamWidth: 8,
      rewardDecayMin: 0.3,
      rewardIntervalSeconds: 45,
      playerName: "Carol",
    });

    const feasible = new Set(created.self!.recommendation.feasibleNodes);
    const numNodes = created.places.length;
    let infeasibleNode: number | undefined;
    for (let n = 1; n < numNodes; n++) {
      if (!feasible.has(n)) {
        infeasibleNode = n;
        break;
      }
    }

    if (infeasibleNode === undefined) return; // every node happened to be feasible -- nothing to assert

    await expect(
      gameService.stepPlayer(created.session.id, created.self!.id, infeasibleNode),
    ).rejects.toThrow();
  }, 60_000);
});

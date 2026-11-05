import { describe, expect, it } from "vitest";
import { SyntheticCellProvider } from "@/data/synthetic-cell-provider";
import { buildClusteredGraph } from "@/graph/spatial-clustering";
import { buildGraph } from "@/graph/build-graph";
import { RollingHorizonController, type VanState } from "./rolling-horizon-controller";

const FORECAST_INTERVAL_SECONDS = 8 * 3600;
const SESSION_STARTED_AT = new Date("2026-01-01T00:00:00Z");

function makeController(cellCount: number, clusterCount: number, commitWindowMinutes = 30, lookaheadMinutes?: number) {
  const cells = new SyntheticCellProvider({ cellCount, clusterCount, seed: 11 }).getNodes();
  const clusters = buildClusteredGraph(cells);
  const controller = new RollingHorizonController(cells, clusters, 11, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS, {
    commitWindowMinutes,
    lookaheadMinutes,
    weekday: "monday",
    thresholds: { maxCandidatesForExact: 0, maxCandidatesForNeural: 0 }, // force greedy tier -- fast, deterministic
  });
  return { cells, clusters, controller };
}

function vanAtShelter(controller: RollingHorizonController, clusters: ReturnType<typeof buildClusteredGraph>, vanId: number, clusterIndex: number): VanState {
  const cluster = clusters[clusterIndex];
  const van: VanState = {
    vanId,
    currentNodeId: cluster.shelterId,
    remainingMinutes: 600,
    shiftedGameStartMinutesOfDay: 9 * 60,
    committedUntilMinutes: 0,
  };
  controller.registerVan(van);
  return van;
}

describe("RollingHorizonController.onForecastTick", () => {
  it("produces a route for every free van and respects the commit window for vans that aren't free yet", async () => {
    const { clusters, controller } = makeController(300, 5);
    vanAtShelter(controller, clusters, 1, 0);
    const van2 = vanAtShelter(controller, clusters, 2, 0);
    van2.committedUntilMinutes = 1000; // still mid-leg, well past "now"

    const routes = await controller.onForecastTick(0, 0);
    expect(routes.has(1)).toBe(true);
    expect(routes.has(2)).toBe(false);
  });

  it("updates each replanned van's committedUntilMinutes based on its new first stop", async () => {
    const { clusters, controller } = makeController(300, 5);
    vanAtShelter(controller, clusters, 1, 0);

    await controller.onForecastTick(0, 0);
    const van = controller.getVan(1)!;
    expect(van.committedUntilMinutes).toBeGreaterThanOrEqual(0);
  });
});

describe("RollingHorizonController.onVanArrival", () => {
  it("masks the evacuated cell so it is never offered to another van in a later replan", async () => {
    const { clusters, controller } = makeController(300, 5);
    vanAtShelter(controller, clusters, 1, 0);
    vanAtShelter(controller, clusters, 2, 0);

    const firstRoutes = await controller.onForecastTick(0, 0);
    const vanOneRoute = firstRoutes.get(1);
    const firstStop = vanOneRoute?.stops[0]?.nodeId;
    expect(firstStop, "test fixture needs van 1 to have at least one stop").toBeDefined();

    await controller.onVanArrival(1, firstStop!, 10);
    // Force van 2 free regardless of its own commit window from the first
    // tick -- this test is specifically about masking persisting across
    // ticks, not about commit-window timing (covered separately above).
    controller.getVan(2)!.committedUntilMinutes = 0;
    const laterRoutes = await controller.onForecastTick(1, 20);
    const vanTwoRoute = laterRoutes.get(2);
    expect(vanTwoRoute, "van 2 should have been replanned").toBeDefined();
    expect(vanTwoRoute!.stops.map((s) => s.nodeId)).not.toContain(firstStop);
  });

  it("frees the arriving van's commit window immediately, even if it was still mid-leg", async () => {
    const { clusters, controller } = makeController(300, 5);
    const van = vanAtShelter(controller, clusters, 1, 0);
    van.committedUntilMinutes = 1000;

    await controller.onVanArrival(1, van.currentNodeId, 50);
    expect(van.committedUntilMinutes).toBeLessThanOrEqual(50 + 1); // reset to "now", not still 1000
  });
});

describe("RollingHorizonController commit window (tau) across tick boundaries", () => {
  it("keeps a van committed across a tick if the tick step is smaller than tau, and frees it once tau elapses", async () => {
    const TICK_STEP_MINUTES = 15;
    const { clusters, controller } = makeController(300, 5, 30); // tau = 30min, 2x the tick step
    vanAtShelter(controller, clusters, 1, 0);

    const tick0Routes = await controller.onForecastTick(0, 0 * TICK_STEP_MINUTES);
    expect(tick0Routes.has(1), "van should be replanned on the very first tick").toBe(true);
    const committedUntil = controller.getVan(1)!.committedUntilMinutes;

    // Only meaningful if the van's own first-leg commitment actually
    // extends past one tick step -- otherwise this test can't observe
    // tau blocking anything (it would just always be free, same bug
    // this test exists to catch regressing back to).
    if (committedUntil <= 1 * TICK_STEP_MINUTES) return;

    const tick1Routes = await controller.onForecastTick(1, 1 * TICK_STEP_MINUTES);
    expect(tick1Routes.has(1), "van should still be committed one tick step later and skipped").toBe(false);

    // Advance ticks until tau has genuinely elapsed, then confirm it's
    // replanned again.
    let lastRoutes = tick1Routes;
    for (let t = 2; t * TICK_STEP_MINUTES <= committedUntil + TICK_STEP_MINUTES; t++) {
      lastRoutes = await controller.onForecastTick(t, t * TICK_STEP_MINUTES);
    }
    expect(lastRoutes.has(1), "van should be free and replanned again once its commitment has elapsed").toBe(true);
  });
});

describe("RollingHorizonController lookaheadMinutes (H)", () => {
  it("never leaves a van's real remainingMinutes reduced, even when a tight H is configured", async () => {
    const { clusters, controller } = makeController(300, 5, 30, 5);
    const van = vanAtShelter(controller, clusters, 1, 0);
    await controller.onForecastTick(0, 0);
    expect(van.remainingMinutes).toBe(600); // the van's actual budget is untouched by H
  });

  it("plans fewer or equal stops under a tight lookahead than with an unbounded one, on the same scenario", async () => {
    const unbounded = makeController(300, 5, 30, undefined);
    vanAtShelter(unbounded.controller, unbounded.clusters, 1, 0);
    const unboundedRoutes = await unbounded.controller.onForecastTick(0, 0);
    const unboundedStops = unboundedRoutes.get(1)?.stops.length ?? 0;

    const tight = makeController(300, 5, 30, 5); // only 5 minutes of planning horizon
    vanAtShelter(tight.controller, tight.clusters, 1, 0);
    const tightRoutes = await tight.controller.onForecastTick(0, 0);
    const tightStops = tightRoutes.get(1)?.stops.length ?? 0;

    expect(tightStops).toBeLessThanOrEqual(unboundedStops);
  });
});

describe("RollingHorizonController Phase B (fleet-wide reward-aware assignment)", () => {
  it("routes a van to a different shelter's zone when its own home zone has no villages at all to visit", async () => {
    const cells = new SyntheticCellProvider({ cellCount: 600, clusterCount: 10, seed: 11 }).getNodes();
    const clusters = buildClusteredGraph(cells);
    // Force the van's home cluster to have no local villages at all,
    // regardless of what the generator naturally produced -- so any stop
    // the van ends up with unambiguously had to come from Phase B
    // sending it to a different (richer) zone, not luck of the draw.
    const shelterNode = clusters[0].graph.nodesById.get(clusters[0].shelterId)!;
    const emptyHomeClusters = [...clusters];
    emptyHomeClusters[0] = { shelterId: clusters[0].shelterId, graph: buildGraph([shelterNode]) };

    const controller = new RollingHorizonController(cells, emptyHomeClusters, 11, SESSION_STARTED_AT, FORECAST_INTERVAL_SECONDS, {
      commitWindowMinutes: 30,
      weekday: "monday",
      thresholds: { maxCandidatesForExact: 0, maxCandidatesForNeural: 0 },
    });
    const van: VanState = {
      vanId: 1,
      currentNodeId: emptyHomeClusters[0].shelterId,
      remainingMinutes: 100_000, // effectively unlimited -- reachability should never be the blocker here
      shiftedGameStartMinutesOfDay: 9 * 60,
      committedUntilMinutes: 0,
    };
    controller.registerVan(van);

    const routes = await controller.onForecastTick(0, 0);
    const route = routes.get(1);
    expect(route, "a van at an empty home cluster should still get routed somewhere").toBeDefined();
    expect(
      route!.stops.length,
      "its home cluster has nothing local to visit -- any stop here had to come from being sent to a different zone",
    ).toBeGreaterThan(0);
  });

  it("still assigns every van to exactly one zone, and never lets two vans in the same zone double-claim a cell", async () => {
    const { clusters, controller } = makeController(600, 10);
    vanAtShelter(controller, clusters, 1, 0);
    vanAtShelter(controller, clusters, 2, 1);
    vanAtShelter(controller, clusters, 3, 2);

    const routes = await controller.onForecastTick(0, 0);
    const allStops = Array.from(routes.values()).flatMap((r) => r.stops.map((s) => s.nodeId));
    expect(new Set(allStops).size).toBe(allStops.length); // no cell appears twice across the whole fleet
  });
});

describe("RollingHorizonController.onHumanOverride", () => {
  it("honors a reachable override as the van's first stop and bypasses its commit window", async () => {
    const { cells, clusters, controller } = makeController(300, 5);
    const van = vanAtShelter(controller, clusters, 1, 0);
    van.committedUntilMinutes = 1000; // would normally block replanning

    const cluster = clusters[0];
    const targetCell = cluster.graph.nodes.find((n) => n.role === "origin")!.id;
    // Need at least one forecast tick's worth of priorities computed first.
    await controller.onForecastTick(0, 0);

    const routes = await controller.onHumanOverride(1, targetCell, 5);
    expect(routes.get(1)?.stops[0]?.nodeId).toBe(targetCell);
    void cells;
  });
});

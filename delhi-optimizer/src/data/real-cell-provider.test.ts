import { describe, expect, it } from "vitest";
import { buildClusteredGraph } from "@/graph/spatial-clustering";
import { buildGraph } from "@/graph/build-graph";
import { computeBaselineRoute } from "@/optimization/baseline-policy";
import { buildRealScenario, parseTractCsv, priceByRealReward } from "./real-cell-provider";

// A genuine excerpt of the real Hurricane Idalia (Aug 2023) census-tract
// file this module is built for -- not fabricated data, just a small slice
// of it, enough to exercise the pipeline without needing the full
// 9,933-row file on disk for unit tests.
const SAMPLE_CSV = `GEO_ID,Latitude,Longitude,Reward
1400000US01005950100,32.0353533,-85.2477678,0.823097775
1400000US01005950200,31.9222752,-85.4498308,0.830065505
1400000US01005950300,31.7908933,-85.5670514,0.845192387
1400000US01005950400,31.6794432,-85.5577196,0.841392788
1400000US01005950500,31.7634183,-85.2718649,0.823164854
1400000US01005950600,31.8783526,-85.2729215,0.831276347
1400000US01005950700,31.9440855,-85.2620842,0.830763103
1400000US01005950800,31.9203546,-85.1756308,0.827561729
1400000US01005950900,31.8559766,-85.1513159,0.822454938
1400000US01011952100,32.1157274,-85.5267341,0.845700183
1400000US01011952202,32.1384894,-85.649468,0.855170257
1400000US01017953900,32.9119527,-85.2738384,0.858733951
1400000US01017954002,32.8888896,-85.3844111,0.854790544
1400000US01017954200,32.8341436,-85.2678516,0.856397002
1400000US01017954300,32.7766468,-85.2734917,0.851574542
1400000US01017954600,32.8362591,-85.1725802,0.852740992
1400000US01017954700,32.7702191,-85.1744682,0.848965982
1400000US01017954800,32.8528326,-85.2084798,0.853051078
1400000US01031010200,31.5375844,-85.8984006,0.867975258
1400000US01031010300,31.4233274,-85.8693564,0.857125628
`;

describe("parseTractCsv", () => {
  it("parses every data row from a well-formed CSV", () => {
    const records = parseTractCsv(SAMPLE_CSV);
    expect(records).toHaveLength(20);
    expect(records[0]).toEqual({
      geoId: "1400000US01005950100",
      latitude: 32.0353533,
      longitude: -85.2477678,
      reward: 0.823097775,
    });
  });

  it("skips malformed rows instead of throwing", () => {
    const withGarbage = SAMPLE_CSV + "not,a,valid\nrow,at,all,here\n1400000USBAD,notanumber,-85.1,0.8\n";
    const records = parseTractCsv(withGarbage);
    expect(records).toHaveLength(20); // the 3 bad trailing lines are all dropped
  });
});

describe("buildRealScenario", () => {
  it("produces one origin per CSV row plus the configured number of shelters", () => {
    const { cells } = buildRealScenario(SAMPLE_CSV, { shelterCount: 6 });
    const origins = cells.filter((c) => c.role === "origin");
    const shelters = cells.filter((c) => c.role === "shelter");
    expect(origins).toHaveLength(20);
    expect(shelters).toHaveLength(6);
  });

  it("generates population for every origin within [populationMin, populationMax]", () => {
    const { cells } = buildRealScenario(SAMPLE_CSV, { populationMin: 100, populationMax: 500 });
    for (const node of cells.filter((c) => c.role === "origin")) {
      expect(node.demand).toBeGreaterThanOrEqual(100);
      expect(node.demand).toBeLessThanOrEqual(500);
    }
  });

  it("generates shelter capacity within [shelterCapacityMin, shelterCapacityMax]", () => {
    const { cells } = buildRealScenario(SAMPLE_CSV, { shelterCapacityMin: 500, shelterCapacityMax: 1000 });
    for (const node of cells.filter((c) => c.role === "shelter")) {
      expect(node.capacity).toBeGreaterThanOrEqual(500);
      expect(node.capacity).toBeLessThanOrEqual(1000);
    }
  });

  it("places every shelter within [shelterOffsetKmMin, shelterOffsetKmMax] of the cone's own principal axis", () => {
    const shelterOffsetKmMin = 50;
    const shelterOffsetKmMax = 100;
    const { cells } = buildRealScenario(SAMPLE_CSV, { shelterCount: 30, shelterOffsetKmMin, shelterOffsetKmMax });
    const origins = cells.filter((c) => c.role === "origin");
    const shelters = cells.filter((c) => c.role === "shelter");

    // Recompute the same PCA axis independently here, rather than
    // reaching into the module's private helper, so this test verifies
    // the actual geometric property, not just that the same function was
    // called twice.
    const mx = origins.reduce((s, o) => s + o.x, 0) / origins.length;
    const my = origins.reduce((s, o) => s + o.y, 0) / origins.length;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    for (const o of origins) {
      const dx = o.x - mx;
      const dy = o.y - my;
      sxx += dx * dx;
      syy += dy * dy;
      sxy += dx * dy;
    }
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const perp = { x: -Math.sin(theta), y: Math.cos(theta) };

    for (const s of shelters) {
      const offset = Math.abs((s.x - mx) * perp.x + (s.y - my) * perp.y);
      expect(offset).toBeGreaterThanOrEqual(shelterOffsetKmMin - 1e-6);
      expect(offset).toBeLessThanOrEqual(shelterOffsetKmMax + 1e-6);
    }
  });

  it("every origin is always-accessible (time windows ignored, per the task)", () => {
    const { cells } = buildRealScenario(SAMPLE_CSV);
    for (const node of cells.filter((c) => c.role === "origin")) {
      for (const day of Object.values(node.openingHours)) {
        expect(day.open).toBe("00:00");
        expect(day.close).toBe("23:59");
      }
    }
  });

  it("is deterministic for a given seed", () => {
    const a = buildRealScenario(SAMPLE_CSV, { seed: 7 });
    const b = buildRealScenario(SAMPLE_CSV, { seed: 7 });
    expect(a.cells).toEqual(b.cells);
  });

  it("keeps the real GEO_ID as the origin's node id, and carries its reward through unchanged", () => {
    const { cells, rewardByNodeId } = buildRealScenario(SAMPLE_CSV);
    const first = cells.find((c) => c.id === "1400000US01005950100")!;
    expect(first).toBeDefined();
    expect(first.role).toBe("origin");
    expect(rewardByNodeId.get("1400000US01005950100")).toBeCloseTo(0.823097775, 9);
  });
});

describe("priceByRealReward", () => {
  it("prices every origin as demand * reward, and every shelter as 0", () => {
    const { cells, rewardByNodeId } = buildRealScenario(SAMPLE_CSV);
    const priorities = priceByRealReward(cells, rewardByNodeId);
    for (const node of cells) {
      if (node.role === "shelter") {
        expect(priorities.get(node.id)).toBe(0);
      } else {
        expect(priorities.get(node.id)).toBe(Math.round(node.demand * (rewardByNodeId.get(node.id) ?? 0)));
      }
    }
  });
});

describe("real-data pipeline end to end (clustering + routing on real tracts)", () => {
  it("clusters by nearest shelter and the greedy solver produces a real, non-empty route for a shelter's cluster", () => {
    const { cells, rewardByNodeId } = buildRealScenario(SAMPLE_CSV, { shelterCount: 3, seed: 11 });
    const clusters = buildClusteredGraph(cells);
    expect(clusters.length).toBe(3);

    const priorities = priceByRealReward(cells, rewardByNodeId);
    const nonEmptyCluster = clusters.find((c) => c.graph.nodes.some((n) => n.role === "origin"));
    expect(nonEmptyCluster, "test fixture needs at least one non-empty cluster").toBeDefined();

    const route = computeBaselineRoute({
      graph: nonEmptyCluster!.graph,
      currentNodeId: nonEmptyCluster!.shelterId,
      depotNodeId: nonEmptyCluster!.shelterId,
      totalGameMinutes: 600,
      gameStartMinutesOfDay: 9 * 60,
      weekday: "monday",
      priorities,
      riskScores: priorities, // no separate risk model for real data -- reward doubles as the display risk score
      demandServedSoFar: 0,
      shelterCapacity: nonEmptyCluster!.graph.nodesById.get(nonEmptyCluster!.shelterId)!.capacity,
    });

    expect(route.stops.length).toBeGreaterThan(0);
    // All people from one tract go to the same shelter -- a direct
    // consequence of this project's existing model (one visit atomically
    // serves a whole origin's demand), not something new this needed to
    // add.
    for (const stop of route.stops) {
      expect(stop.demandServed).toBeGreaterThan(0);
    }
  });

  it("the real principal-axis projection round-trips sanely: buildGraph works on the projected plane", () => {
    const { cells } = buildRealScenario(SAMPLE_CSV, { shelterCount: 2 });
    const graph = buildGraph(cells);
    expect(graph.nodes).toHaveLength(cells.length);
    // Travel time between any two distinct real tracts should be finite
    // and positive -- i.e. the lat/lon -> km projection actually produced
    // usable plane coordinates, not NaN/Infinity.
    const a = cells[0].id;
    const b = cells[1].id;
    const t = graph.travelTimeMinutes.get(a)?.get(b);
    expect(t).toBeGreaterThan(0);
    expect(Number.isFinite(t)).toBe(true);
  });
});

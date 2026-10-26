import { describe, expect, it } from "vitest";
import { EVACUATION_NODES, SHELTER_DEPOT_ID } from "@/data/evacuation-nodes";
import { buildGraph } from "@/graph/build-graph";
import { computeNodeStates } from "./feasibility";

const graph = buildGraph(EVACUATION_NODES);
const depotId = SHELTER_DEPOT_ID;
const shelterCapacity = EVACUATION_NODES.find((n) => n.id === depotId)!.capacity;

function priorities(): Map<string, number> {
  return new Map(EVACUATION_NODES.map((n) => [n.id, n.demand]));
}

function noRisk(): Map<string, number> {
  return new Map(EVACUATION_NODES.map((n) => [n.id, 0]));
}

const BASE_INPUT = {
  graph,
  currentNodeId: depotId,
  depotNodeId: depotId,
  elapsedMinutes: 0,
  totalGameMinutes: 600,
  gameStartMinutesOfDay: 9 * 60,
  weekday: "monday" as const,
  visited: new Set<string>(),
  priorities: priorities(),
  riskScores: noRisk(),
  demandServedSoFar: 0,
  shelterCapacity,
};

describe("computeNodeStates", () => {
  it("marks the current node itself as infeasible", () => {
    const states = computeNodeStates(BASE_INPUT);
    const state = states.find((s) => s.nodeId === depotId)!;
    expect(state.feasible).toBe(false);
    expect(state.infeasibleReason).toBe("already_done");
  });

  it("marks an already-visited node as infeasible", () => {
    const anOrigin = EVACUATION_NODES.find((n) => n.role === "origin")!.id;
    const states = computeNodeStates({ ...BASE_INPUT, visited: new Set([anOrigin]) });
    const state = states.find((s) => s.nodeId === anOrigin)!;
    expect(state.feasible).toBe(false);
    expect(state.infeasibleReason).toBe("already_done");
  });

  it("never reports an infeasibleReason for a feasible node", () => {
    const states = computeNodeStates(BASE_INPUT);
    for (const s of states.filter((s) => s.feasible)) {
      expect(s.infeasibleReason).toBeUndefined();
    }
  });

  it("reports time_budget when the round trip alone doesn't fit, distinct from time_window", () => {
    const states = computeNodeStates({ ...BASE_INPUT, totalGameMinutes: 5 });
    for (const s of states.filter((s) => s.nodeId !== depotId)) {
      expect(s.feasible).toBe(false);
      expect(s.infeasibleReason).toBe("time_budget");
    }
  });

  it("passes through risk score and priority as independent fields", () => {
    const origin = EVACUATION_NODES.find((n) => n.role === "origin")!;
    const states = computeNodeStates({
      ...BASE_INPUT,
      riskScores: new Map([[origin.id, 0.73]]),
      priorities: new Map([[origin.id, 999]]),
    });
    const state = states.find((s) => s.nodeId === origin.id)!;
    expect(state.riskScore).toBe(0.73);
    expect(state.currentPriority).toBe(999);
  });

  it("requires enough total game time to travel, wait, service, AND return to the shelter", () => {
    const states = computeNodeStates({ ...BASE_INPUT, totalGameMinutes: 5 });
    expect(states.every((s) => s.feasible === false)).toBe(true);
  });

  it("a generous game budget in the morning leaves most origins feasible", () => {
    const states = computeNodeStates(BASE_INPUT);
    const feasibleCount = states.filter((s) => s.feasible).length;
    expect(feasibleCount).toBeGreaterThan(EVACUATION_NODES.length / 2);
  });

  describe("shelter capacity constraint", () => {
    it("makes an origin infeasible once serving it would exceed remaining shelter capacity", () => {
      const origin = EVACUATION_NODES.find((n) => n.role === "origin")!;
      const states = computeNodeStates({
        ...BASE_INPUT,
        demandServedSoFar: shelterCapacity - origin.demand + 1, // one person short of fitting
      });
      const state = states.find((s) => s.nodeId === origin.id)!;
      expect(state.feasible).toBe(false);
      expect(state.infeasibleReason).toBe("shelter_capacity");
    });

    it("still allows an origin that exactly fills remaining capacity", () => {
      const origin = EVACUATION_NODES.find((n) => n.role === "origin")!;
      const states = computeNodeStates({
        ...BASE_INPUT,
        demandServedSoFar: shelterCapacity - origin.demand, // exactly fits
      });
      expect(states.find((s) => s.nodeId === origin.id)?.feasible).toBe(true);
    });

    it("does not apply the capacity constraint to the shelter node itself", () => {
      const states = computeNodeStates({
        ...BASE_INPUT,
        currentNodeId: EVACUATION_NODES.find((n) => n.role === "origin")!.id,
        demandServedSoFar: shelterCapacity, // already full
      });
      // The shelter itself has role "shelter", not "origin" -- capacity
      // check is skipped for it (returning there is always about capacity
      // being full, not about the shelter consuming more capacity).
      const shelterState = states.find((s) => s.nodeId === depotId)!;
      expect(shelterState.feasible).toBe(true);
    });
  });
});

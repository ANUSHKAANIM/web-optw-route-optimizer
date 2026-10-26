import { describe, expect, it } from "vitest";
import { isValidCoordinate } from "@/graph/plane-distance";
import { EVACUATION_NODES, EVACUATION_NODES_BY_ID, SHELTER_DEPOT_ID } from "./evacuation-nodes";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

describe("EVACUATION_NODES dataset", () => {
  it("has a small but non-trivial node count for the first scenario", () => {
    expect(EVACUATION_NODES.length).toBeGreaterThanOrEqual(10);
    expect(EVACUATION_NODES.length).toBeLessThanOrEqual(30);
  });

  it("has unique ids", () => {
    expect(new Set(EVACUATION_NODES.map((n) => n.id)).size).toBe(EVACUATION_NODES.length);
  });

  it("has exactly one shelter, matching SHELTER_DEPOT_ID", () => {
    const shelters = EVACUATION_NODES.filter((n) => n.role === "shelter");
    expect(shelters).toHaveLength(1);
    expect(shelters[0].id).toBe(SHELTER_DEPOT_ID);
  });

  it("gives every origin positive demand and zero capacity, and the shelter the reverse", () => {
    for (const node of EVACUATION_NODES) {
      if (node.role === "origin") {
        expect(node.demand).toBeGreaterThan(0);
        expect(node.capacity).toBe(0);
      } else {
        expect(node.capacity).toBeGreaterThan(0);
        expect(node.demand).toBe(0);
      }
    }
  });

  it("has a shelter capacity less than total demand, so the capacity constraint is actually exercised", () => {
    const shelter = EVACUATION_NODES_BY_ID[SHELTER_DEPOT_ID];
    const totalDemand = EVACUATION_NODES.filter((n) => n.role === "origin").reduce((sum, n) => sum + n.demand, 0);
    expect(shelter.capacity).toBeLessThan(totalDemand);
  });

  it("has valid, finite abstract-plane coordinates", () => {
    for (const node of EVACUATION_NODES) {
      expect(isValidCoordinate([node.x, node.y])).toBe(true);
    }
  });

  it("has well-formed accessibility windows for every weekday", () => {
    for (const node of EVACUATION_NODES) {
      for (const day of WEEKDAYS) {
        const hours = node.openingHours[day];
        expect(hours, `${node.id}.${day}`).toBeDefined();
        if (hours.closed) continue;
        expect(hours.open, `${node.id}.${day}.open`).toMatch(TIME_RE);
        expect(hours.close, `${node.id}.${day}.close`).toMatch(TIME_RE);
      }
    }
  });

  it("indexes every node by id", () => {
    for (const node of EVACUATION_NODES) {
      expect(EVACUATION_NODES_BY_ID[node.id]).toBe(node);
    }
  });
});

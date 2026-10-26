import type { GraphNode, OpeningHours } from "@/types/graph";

/**
 * SIMULATION DATA -- a small, synthetic cyclone-evacuation scenario, not a
 * real evacuation plan for any real event, and not tied to any real-world
 * place. Node positions (`x`/`y`) are abstract coordinates (kilometers) in
 * a flat simulation plane invented for this prototype -- NOT latitude/
 * longitude, and not a map of any real city or region.
 *
 * Kept deliberately small (one shelter, a dozen origins) to validate the
 * complete workflow end-to-end before scaling toward ~2,000 nodes.
 */

function alwaysAccessible(): OpeningHours {
  const day = { open: "00:00", close: "23:59" };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
}

/** A handful of origins where the access road is only passable for part of
 * the day (e.g. a low-lying crossing) -- exercises the same time-window
 * feasibility logic as the rest, just with a real constraint behind it. */
function restrictedAccess(open: string, close: string): OpeningHours {
  const day = { open, close };
  return { monday: day, tuesday: day, wednesday: day, thursday: day, friday: day, saturday: day, sunday: day };
}

export const EVACUATION_NODES: GraphNode[] = [
  {
    id: "shelter_main",
    name: "Central Shelter",
    x: 22.4,
    y: 18.08,
    role: "shelter",
    demand: 0,
    capacity: 1400,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 0,
  },
  {
    id: "origin_1",
    name: "Riverside District A",
    x: 23.52,
    y: 22.89,
    role: "origin",
    demand: 220,
    capacity: 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 25,
  },
  {
    id: "origin_2",
    name: "Low-Lying Settlement B",
    x: 18.11,
    y: 8.27,
    role: "origin",
    demand: 310,
    capacity: 0,
    openingHours: restrictedAccess("05:00", "20:00"),
    serviceDurationMinutes: 35,
  },
  {
    id: "origin_3",
    name: "Coastal Road Cluster C",
    x: 24.47,
    y: 15.91,
    role: "origin",
    demand: 180,
    capacity: 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 20,
  },
  {
    id: "origin_4",
    name: "Floodplain Village D",
    x: 25.26,
    y: 11.49,
    role: "origin",
    demand: 275,
    capacity: 0,
    openingHours: restrictedAccess("06:00", "18:00"),
    serviceDurationMinutes: 30,
  },
  {
    id: "origin_5",
    name: "Industrial Zone E",
    x: 22.78,
    y: 22.28,
    role: "origin",
    demand: 140,
    capacity: 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 15,
  },
  {
    id: "origin_6",
    name: "Hillside Hamlet F",
    x: 21.14,
    y: 19.65,
    role: "origin",
    demand: 95,
    capacity: 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 15,
  },
  {
    id: "origin_7",
    name: "Market Town G",
    x: 21.15,
    y: 20.15,
    role: "origin",
    demand: 260,
    capacity: 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 25,
  },
  {
    id: "origin_8",
    name: "Harbor Frontage H",
    x: 23.72,
    y: 17.66,
    role: "origin",
    demand: 200,
    capacity: 0,
    openingHours: restrictedAccess("04:00", "22:00"),
    serviceDurationMinutes: 25,
  },
  {
    id: "origin_9",
    name: "Suburban Block I",
    x: 20.51,
    y: 13.14,
    role: "origin",
    demand: 165,
    capacity: 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 20,
  },
  {
    id: "origin_10",
    name: "Riverside District J",
    x: 44.29,
    y: 24.33,
    role: "origin",
    demand: 230,
    capacity: 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 25,
  },
  {
    id: "origin_11",
    name: "Delta Outskirts K",
    x: 2.6,
    y: 1.05,
    role: "origin",
    demand: 190,
    capacity: 0,
    openingHours: restrictedAccess("05:30", "19:30"),
    serviceDurationMinutes: 30,
  },
  {
    id: "origin_12",
    name: "North Embankment L",
    x: 10.0,
    y: 28.21,
    role: "origin",
    demand: 150,
    capacity: 0,
    openingHours: alwaysAccessible(),
    serviceDurationMinutes: 20,
  },
];

export const EVACUATION_NODES_BY_ID: Record<string, GraphNode> = Object.fromEntries(
  EVACUATION_NODES.map((n) => [n.id, n]),
);

export const SHELTER_DEPOT_ID = "shelter_main";

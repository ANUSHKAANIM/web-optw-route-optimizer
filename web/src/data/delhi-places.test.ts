import { describe, expect, it } from "vitest";
import { isValidCoordinate } from "@/lib/geo/haversine";
import { DELHI_PLACES, DELHI_PLACES_BY_ID } from "./delhi-places";

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

describe("DELHI_PLACES dataset", () => {
  it("has roughly 80 places", () => {
    expect(DELHI_PLACES.length).toBeGreaterThanOrEqual(70);
    expect(DELHI_PLACES.length).toBeLessThanOrEqual(90);
  });

  it("has unique ids", () => {
    const ids = new Set(DELHI_PLACES.map((p) => p.id));
    expect(ids.size).toBe(DELHI_PLACES.length);
  });

  it("every place has real, valid Delhi/NCR-area coordinates", () => {
    for (const place of DELHI_PLACES) {
      expect(isValidCoordinate([place.latitude, place.longitude])).toBe(true);
      expect(place.latitude).toBeGreaterThan(27.5);
      expect(place.latitude).toBeLessThan(29.2);
      expect(place.longitude).toBeGreaterThan(76.5);
      expect(place.longitude).toBeLessThan(77.8);
    }
  });

  it("has well-formed opening hours for every weekday, or an explicit closed flag", () => {
    for (const place of DELHI_PLACES) {
      for (const day of WEEKDAYS) {
        const hours = place.openingHours[day];
        expect(hours, `${place.id}.${day}`).toBeDefined();
        if (hours.closed) continue;
        expect(hours.open, `${place.id}.${day}.open`).toMatch(TIME_RE);
        expect(hours.close, `${place.id}.${day}.close`).toMatch(TIME_RE);
      }
    }
  });

  it("has a positive visit duration and base reward for every place", () => {
    for (const place of DELHI_PLACES) {
      expect(place.visitDurationMinutes).toBeGreaterThan(0);
      expect(place.baseReward).toBeGreaterThan(0);
    }
  });

  it("indexes every place by id", () => {
    for (const place of DELHI_PLACES) {
      expect(DELHI_PLACES_BY_ID[place.id]).toBe(place);
    }
  });
});

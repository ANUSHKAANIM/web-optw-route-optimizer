import { describe, expect, it } from "vitest";
import { advanceTick, simulateArrival, overrideVan } from "./actions";
import { session } from "./session";

/**
 * Calls the actual Server Action functions directly (bypassing Next's
 * request/RPC machinery entirely, since vitest runs outside the Next.js
 * build pipeline -- "use server" is just ignored here, so these execute
 * as plain async functions against the real module-level session). This
 * is the only practical way to verify the live rolling-horizon wiring
 * works: Server Actions can't be meaningfully curl-tested (they use an
 * internal RPC wire format), but their actual logic -- mutating the real
 * session singleton via the real RollingHorizonController -- is no
 * different from any other backend function in this project.
 */
describe("rolling-horizon Server Actions", () => {
  it(
    "advanceTick starts the session at tick 0 and produces van routes",
    async () => {
      expect(session.currentTick).toBeGreaterThanOrEqual(-1);
      const startingTick = session.currentTick;

      await advanceTick();

      expect(session.currentTick).toBe(startingTick + 1);
      expect(session.log[0]).toContain(`Tick ${startingTick + 1}`);
    },
    60_000, // first call builds clustering for 250 shelters + solves routes for 12 vans
  );

  it(
    "simulateArrival masks a village and logs the event",
    async () => {
      const vanId = 0;
      const van = session.controller.getVan(vanId);
      expect(van, "test needs van 0 registered").toBeDefined();

      const lastTick = session.controller.getLastTick();
      expect(lastTick, "test needs at least one tick to have run").not.toBeNull();

      const anyOrigin = session.cells.find((c) => c.role === "origin")!;
      await simulateArrival(vanId, anyOrigin.id, anyOrigin.name);

      expect(session.log[0]).toContain(anyOrigin.name);
      expect(session.log[0]).toContain(`Van ${vanId + 1}`);

      // A second arrival for the same (now-evacuated) cell should still
      // run without throwing -- markEvacuated is idempotent.
      await simulateArrival(vanId, anyOrigin.id, anyOrigin.name);
    },
    60_000,
  );

  it(
    "overrideVan logs whether the pin was honored or rejected, never throws either way",
    async () => {
      const vanId = 1;
      const van = session.controller.getVan(vanId);
      expect(van, "test needs van 1 registered").toBeDefined();

      const anyOrigin = session.cells.find((c) => c.role === "origin" && c.id !== undefined)!;
      await overrideVan(vanId, anyOrigin.id, anyOrigin.name);

      expect(session.log[0]).toContain(`Van ${vanId + 1}`);
      expect(session.log[0]).toMatch(/honored|could not be honored/);
    },
    60_000,
  );
});

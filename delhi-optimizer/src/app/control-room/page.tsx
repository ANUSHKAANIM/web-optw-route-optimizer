import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { session, VAN_COLORS, VAN_COUNT } from "./session";
import { ControlRoomView, type ControlRoomNode, type ControlRoomVan, type ControlRoomZone } from "./control-room-view";

const plexMono = IBM_Plex_Mono({ weight: "500", subsets: ["latin"] });
const plexSans = IBM_Plex_Sans({ weight: "400", subsets: ["latin"] });

/**
 * Server shell: reads the real, live control-room session (session.ts)
 * and hands the client component plain, serializable props. All
 * animation, canvas rendering, hover/selection state lives client-side
 * (control-room-view.tsx) -- this file's only job is translating real
 * backend state into that shape.
 */
export default function ControlRoomPage() {
  const {
    cells,
    shelters,
    origins,
    vanHomeShelterId,
    vanDropoffShelterId,
    lastTick,
    currentTick,
    vanRoutes,
    vanStartPositions,
    evacuatedCellIds,
    solverTier,
    log,
  } = session;
  const nodesById = new Map(cells.map((n) => [n.id, n]));
  const sheltersById = new Map(shelters.map((s) => [s.id, s]));

  const nodes: ControlRoomNode[] = origins.map((n) => {
    const state = lastTick?.cellStates.get(n.id);
    return {
      id: n.id,
      name: n.name,
      x: n.x,
      y: n.y,
      demand: n.demand,
      tier: state?.tier ?? "normal",
      riskScore: state?.riskScore ?? 0,
      evacuated: evacuatedCellIds.has(n.id),
    };
  });

  const vans: ControlRoomVan[] = Array.from({ length: VAN_COUNT }, (_, i) => {
    const home = sheltersById.get(vanHomeShelterId.get(i)!)!;
    const dropoff = sheltersById.get(vanDropoffShelterId.get(i) ?? home.id) ?? home;
    const route = vanRoutes.get(i) ?? null;
    const startPos = vanStartPositions.get(i) ?? { vanId: i, x: home.x, y: home.y };
    const stops =
      route?.stops.map((s) => {
        const node = nodesById.get(s.nodeId);
        const state = lastTick?.cellStates.get(s.nodeId);
        return {
          nodeId: s.nodeId,
          name: node?.name ?? s.nodeId,
          x: node?.x ?? home.x,
          y: node?.y ?? home.y,
          arrivalMinutes: s.arrivalMinutes,
          departureMinutes: s.departureMinutes,
          rewardCollected: s.rewardCollected,
          demandServed: s.demandServed,
          atRisk: state ? state.tier !== "normal" : false,
        };
      }) ?? [];
    return {
      id: i,
      name: `Van ${String(i + 1).padStart(2, "0")}`,
      color: VAN_COLORS[i % VAN_COLORS.length],
      startX: startPos.x,
      startY: startPos.y,
      homeShelterId: home.id,
      homeShelterName: home.name,
      homeShelterX: home.x,
      homeShelterY: home.y,
      dropoffShelterId: dropoff.id,
      dropoffShelterName: dropoff.name,
      dropoffShelterX: dropoff.x,
      dropoffShelterY: dropoff.y,
      stops,
      totalDistanceKm: route?.totalDistanceKm ?? 0,
      totalTravelMinutes: route?.totalTravelMinutes ?? 0,
      totalReward: route?.totalReward ?? 0,
      totalDemandServed: route?.totalDemandServed ?? 0,
    };
  });

  const zone: ControlRoomZone | null = lastTick
    ? {
        centerX: lastTick.zone.centerX,
        centerY: lastTick.zone.centerY,
        rings: lastTick.zone.rings,
        concentration: lastTick.zone.concentration,
        nextUpdateIso: lastTick.zone.nextUpdateIso,
      }
    : null;

  const xs = cells.map((n) => n.x);
  const ys = cells.map((n) => n.y);
  const pad = 2.5;
  const bounds = {
    minX: Math.min(...xs) - pad,
    minY: Math.min(...ys) - pad,
    width: Math.max(...xs) - Math.min(...xs) + pad * 2,
    height: Math.max(...ys) - Math.min(...ys) + pad * 2,
  };

  return (
    <ControlRoomView
      shelters={shelters.map((s) => ({ id: s.id, name: s.name, x: s.x, y: s.y }))}
      nodes={nodes}
      vans={vans}
      zone={zone}
      bounds={bounds}
      tick={currentTick}
      solverTier={solverTier}
      log={log}
      activeStormCount={1}
      monoFont={plexMono.style.fontFamily}
      sansFont={plexSans.style.fontFamily}
    />
  );
}

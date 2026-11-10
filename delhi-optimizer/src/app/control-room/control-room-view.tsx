"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { planeDistanceKm } from "@/graph/plane-distance";
import type { RiskTier } from "@/forecast/risk-tiers";
import { advanceForecast, setSolverTier, markEvacuated, resetSession } from "./actions";
import type { SolverTier } from "./session";

/**
 * Client-side canvas control room, visually modeled on the provided
 * "Cyclone Evacuation Control" design mockup (dark control-room theme,
 * canvas map, van picker, step-by-step route panel, clickable countdown).
 *
 * Everything drawn here is computed from REAL data the server (page.tsx)
 * pulled out of the actual RollingHorizonController session -- node
 * positions, the forecast's storm geometry, and every van's route are the
 * genuine solver output, not scripted. What IS purely visual, invented
 * for this page, and not backed by any backend state: the continuous van
 * movement along its route (the backend only knows a van's route, not a
 * sub-route position) and the smooth tween when the storm rings move to
 * a new forecast position (the backend reports the new position
 * instantly; the animation between old and new is cosmetic).
 */

export interface ControlRoomNode {
  id: string;
  name: string;
  x: number;
  y: number;
  demand: number;
  tier: RiskTier;
  riskScore: number;
  /** True once a van has actually been reported passing this village
   * (see markEvacuated in actions.ts) -- masked out of every van's
   * candidate pool server-side from that moment on, not just visually. */
  evacuated: boolean;
}

export interface ControlRoomStop {
  nodeId: string;
  name: string;
  x: number;
  y: number;
  arrivalMinutes: number;
  departureMinutes: number;
  rewardCollected: number;
  demandServed: number;
  atRisk: boolean;
}

export interface ControlRoomVan {
  id: number;
  name: string;
  color: string;
  /** Where this van's CURRENT route starts from -- wherever it visually
   * was when the last forecast was pulled, not necessarily its shelter.
   * Authoritative value echoed back from the server (session.ts's
   * vanStartPositions), not computed client-side, so a fresh page load
   * renders the same thing the live session actually has. */
  startX: number;
  startY: number;
  /** This van's fixed home shelter -- its route always ends here,
   * regardless of where it started. Not every van shares the same
   * shelter (2 shelters, 4 vans split across them). */
  homeShelterId: string;
  homeShelterName: string;
  homeShelterX: number;
  homeShelterY: number;
  /** Where this van's CURRENT route actually ends -- the nearest shelter
   * to its last stop, not necessarily its home shelter (session.ts drops
   * a van off wherever is genuinely closest once its stops are fixed). */
  dropoffShelterId: string;
  dropoffShelterName: string;
  dropoffShelterX: number;
  dropoffShelterY: number;
  stops: ControlRoomStop[];
  totalDistanceKm: number;
  totalTravelMinutes: number;
  totalReward: number;
  totalDemandServed: number;
}

export interface ControlRoomZone {
  centerX: number;
  centerY: number;
  rings: { level: "high" | "medium" | "low"; radiusKm: number }[];
  concentration: string;
  nextUpdateIso: string;
}

interface Bounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

interface Props {
  shelters: { id: string; name: string; x: number; y: number }[];
  nodes: ControlRoomNode[];
  vans: ControlRoomVan[];
  zone: ControlRoomZone | null;
  bounds: Bounds;
  tick: number;
  solverTier: SolverTier;
  log: string[];
  activeStormCount: number;
  /** Resolved next/font/google family strings, loaded server-side in
   * page.tsx (same convention the root layout uses for Geist) -- passed
   * down rather than hardcoding "IBM Plex Mono"/"IBM Plex Sans" by name,
   * which would silently fail to resolve (and trip Next's
   * no-page-custom-font lint rule) without next/font's own loading. */
  monoFont: string;
  sansFont: string;
}

const CANVAS_W = 1400;
const CANVAS_H = 760;
const TIER_COLOR: Record<RiskTier, string> = {
  normal: "#5e6b7d",
  watch: "#ffd166",
  warning: "#ff9f68",
  severe: "#ff5e5e",
  critical: "#ff3030",
};
const RING_ALPHA: Record<"high" | "medium" | "low", number> = { high: 0.42, medium: 0.26, low: 0.14 };

function project(x: number, y: number, bounds: Bounds) {
  const scale = Math.min(CANVAS_W / bounds.width, CANVAS_H / bounds.height);
  const offX = (CANVAS_W - bounds.width * scale) / 2;
  const offY = (CANVAS_H - bounds.height * scale) / 2;
  return [offX + (x - bounds.minX) * scale, offY + (y - bounds.minY) * scale, scale] as const;
}

function fmtMin(m: number): string {
  const r = Math.max(0, Math.round(m));
  return r < 60 ? `${r} min` : `${Math.floor(r / 60)}h ${r % 60}m`;
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

interface VanPath {
  points: [number, number][];
  cum: number[];
  total: number;
}

/** The path ends at wherever the van actually drops off -- the nearest
 * shelter to its last stop, not necessarily its home shelter -- and
 * STARTS from wherever its current route says it started from (its last
 * known live position, not a shelter), so a new route visibly continues
 * from where the van actually is instead of snapping back to base. */
function buildVanPath(van: ControlRoomVan): VanPath {
  const points: [number, number][] = [
    [van.startX, van.startY],
    ...van.stops.map((s): [number, number] => [s.x, s.y]),
    [van.dropoffShelterX, van.dropoffShelterY],
  ];
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + planeDistanceKm(points[i - 1], points[i]));
  }
  return { points, cum, total: cum[cum.length - 1] };
}

function pointOnPath(path: VanPath, s: number): [number, number] {
  if (path.points.length === 1) return path.points[0];
  const clamped = Math.max(0, Math.min(path.total, s));
  let lo = 0;
  let hi = path.cum.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (path.cum[mid] <= clamped) lo = mid;
    else hi = mid;
  }
  const a = path.points[lo];
  const b = path.points[Math.min(lo + 1, path.points.length - 1)];
  const span = path.cum[Math.min(lo + 1, path.cum.length - 1)] - path.cum[lo] || 1;
  const t = Math.max(0, Math.min(1, (clamped - path.cum[lo]) / span));
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

export function ControlRoomView({ shelters, nodes, vans, zone, bounds, tick, solverTier, log, activeStormCount, monoFont, sansFont }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedVanId, setSelectedVanId] = useState(vans[0]?.id ?? 0);
  const [hover, setHover] = useState<{ x: number; y: number; node: ControlRoomNode } | null>(null);
  const [pending, setPending] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [flash, setFlash] = useState(false);
  const [, forceTick] = useState(0);

  const paths = useMemo(() => new Map(vans.map((v) => [v.id, buildVanPath(v)])), [vans]);

  // Per-van animation progress (km traveled along its CURRENT route) and
  // hold timer (pause once it reaches the shelter again, before looping).
  const progressRef = useRef(new Map<number, { s: number; hold: number }>());
  // Which route each van is currently animating -- a signature of its
  // stop ids. When this changes (a new forecast replanned the van), the
  // van's progress resets to 0 so it visibly restarts from the shelter
  // along the NEW path, rather than continuing to play out a path that
  // no longer exists.
  const routeSigRef = useRef(new Map<number, string>());
  // Which of a van's CURRENT route's stops have already been reported to
  // the server as evacuated (see markEvacuated below) -- reset alongside
  // progress whenever the route itself changes, so a village already
  // reported on a previous route doesn't get double-reported (harmless,
  // markEvacuatedSync is idempotent, but avoids a redundant round-trip).
  const reportedRef = useRef(new Map<number, Set<string>>());
  for (const v of vans) {
    const sig = `${v.startX.toFixed(2)},${v.startY.toFixed(2)}|${v.stops.map((s) => s.nodeId).join(">")}`;
    if (routeSigRef.current.get(v.id) !== sig) {
      routeSigRef.current.set(v.id, sig);
      progressRef.current.set(v.id, { s: 0, hold: 0 });
      reportedRef.current.set(v.id, new Set());
    }
    if (!progressRef.current.has(v.id)) progressRef.current.set(v.id, { s: 0, hold: 0 });
    if (!reportedRef.current.has(v.id)) reportedRef.current.set(v.id, new Set());
  }

  // Smooth tween of the storm rings from their previous position to the
  // new forecast's position -- purely cosmetic (the backend's position
  // change itself is instant); without this a new tick would just teleport
  // the cone, which reads as a bug rather than "the storm moved".
  const zoneTweenRef = useRef<{ from: ControlRoomZone | null; to: ControlRoomZone | null; startedAt: number } | null>(null);
  const lastZoneKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = zone ? `${tick}:${zone.centerX}:${zone.centerY}` : null;
    if (key !== lastZoneKeyRef.current) {
      zoneTweenRef.current = { from: zoneTweenRef.current?.to ?? zone, to: zone, startedAt: performance.now() };
      lastZoneKeyRef.current = key;
    }
  }, [zone, tick]);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (ts: number) => {
      const dt = Math.min(0.1, (ts - last) / 1000);
      last = ts;
      for (const v of vans) {
        const path = paths.get(v.id)!;
        const prog = progressRef.current.get(v.id)!;
        if (path.total <= 0) {
          raf = requestAnimationFrame(loop);
          draw(ts);
          return;
        }
        // Compress the route's real travel time into a watchable pace --
        // slower than a 1:1 compression so the route is easy to follow.
        const durationSeconds = Math.max(18, Math.min(90, v.totalTravelMinutes * 1.3));
        const speedKmPerSec = path.total / durationSeconds;
        if (prog.s >= path.total) {
          prog.hold += dt;
          if (prog.hold > 3.2) {
            prog.s = 0;
            prog.hold = 0;
          }
        } else {
          prog.s = Math.min(path.total, prog.s + speedKmPerSec * dt);
        }

        // The van's animation just passed a stop -- mask it server-side
        // immediately (fire-and-forget; animation never waits on this)
        // so it's excluded from every van's candidates from here on.
        const reported = reportedRef.current.get(v.id)!;
        v.stops.forEach((stop, i) => {
          if (reported.has(stop.nodeId)) return;
          if (prog.s < path.cum[i + 1]) return;
          reported.add(stop.nodeId);
          void markEvacuated(stop.nodeId);
        });
      }
      draw(ts);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vans, paths, zone, nodes, selectedVanId, bounds]);

  function draw(ts: number) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const t = ts / 1000;

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#070a0f";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // faint reference grid
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= CANVAS_W; gx += 56) {
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, CANVAS_H);
      ctx.stroke();
    }
    for (let gy = 0; gy <= CANVAS_H; gy += 56) {
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(CANVAS_W, gy);
      ctx.stroke();
    }

    // storm rings (tweened toward the latest forecast position)
    const tw = zoneTweenRef.current;
    if (tw?.to) {
      const elapsed = (performance.now() - tw.startedAt) / 1000;
      const f = easeInOutCubic(Math.max(0, Math.min(1, elapsed / 1.3)));
      const from = tw.from ?? tw.to;
      const cx = from.centerX + (tw.to.centerX - from.centerX) * f;
      const cy = from.centerY + (tw.to.centerY - from.centerY) * f;
      const [px, py, scale] = project(cx, cy, bounds);
      for (let i = tw.to.rings.length - 1; i >= 0; i--) {
        const toR = tw.to.rings[i].radiusKm;
        const fromR = from.rings[i]?.radiusKm ?? toR;
        const r = (fromR + (toR - fromR) * f) * scale;
        ctx.beginPath();
        ctx.arc(px, py, Math.max(2, r), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,64,64,${RING_ALPHA[tw.to.rings[i].level]})`;
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(px, py, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#ff5050";
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = "#ffffff";
      ctx.stroke();
      const pulse = (t * 0.5) % 1;
      ctx.beginPath();
      ctx.arc(px, py, 8 + 16 * pulse, 0, Math.PI * 2);
      ctx.globalAlpha = 1 - pulse;
      ctx.strokeStyle = "#ff6b6b";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // faint route for every van
    ctx.lineWidth = 1.6;
    for (const v of vans) {
      if (v.id === selectedVanId) continue;
      const path = paths.get(v.id)!;
      if (path.points.length < 2) continue;
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = v.color;
      ctx.beginPath();
      path.points.forEach(([x, y], i) => {
        const [px, py] = project(x, y, bounds);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // shelter markers
    ctx.fillStyle = "#12251a";
    ctx.strokeStyle = "#9be3b0";
    ctx.lineWidth = 2;
    for (const shelter of shelters) {
      const [sx, sy] = project(shelter.x, shelter.y, bounds);
      ctx.fillRect(sx - 9, sy - 9, 18, 18);
      ctx.strokeRect(sx - 9, sy - 9, 18, 18);
    }

    // origin villages, colored by current risk tier -- evacuated ones
    // drawn as a dim hollow ring instead, so masking is visibly real.
    for (const n of nodes) {
      const [px, py] = project(n.x, n.y, bounds);
      const r = n.id === hover?.node.id ? 6.5 : 4.5;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      if (n.evacuated) {
        ctx.globalAlpha = 0.35;
        ctx.strokeStyle = "#5e6b7d";
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.fillStyle = TIER_COLOR[n.tier];
      ctx.fill();
      if (n.id === hover?.node.id) {
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
      }
    }

    // selected van's route, highlighted and animated
    const selVan = vans.find((v) => v.id === selectedVanId);
    if (selVan) {
      const path = paths.get(selVan.id)!;
      if (path.points.length > 1) {
        ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(5,8,12,0.85)";
        ctx.beginPath();
        path.points.forEach(([x, y], i) => {
          const [px, py] = project(x, y, bounds);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.lineWidth = 3.2;
        ctx.strokeStyle = selVan.color;
        ctx.stroke();
        ctx.setLineDash([3, 11]);
        ctx.lineDashOffset = -t * 20;
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      }
    }

    // every van, with the animated marker position
    for (const v of vans) {
      const path = paths.get(v.id)!;
      const prog = progressRef.current.get(v.id)!;
      const [vx, vy] = pointOnPath(path, prog.s);
      const [px, py] = project(vx, vy, bounds);
      const on = v.id === selectedVanId;
      const r = on ? 12 : 9;
      if (on) {
        ctx.beginPath();
        ctx.arc(px, py, r + 3 + 3 * Math.sin(t * 4), 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.85)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = v.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#05080c";
      ctx.stroke();
      ctx.font = `700 ${on ? 12 : 10}px ${monoFont}, monospace`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#05080c";
      ctx.fillText(String(v.id + 1), px, py + 0.5);
      ctx.textAlign = "start";
    }
  }

  // Redraw on every state change that isn't already covered by the RAF
  // loop (selection, hover highlight, new server data after a tick).
  useEffect(() => {
    draw(performance.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVanId, hover, nodes, vans, bounds]);

  // Countdown, re-rendered every second.
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  async function handleAdvance() {
    if (pending) return;
    setPending(true);
    try {
      // Snapshot where every van visually is RIGHT NOW (its live
      // animated position along its current route) and send that to the
      // server -- the new route it computes must start from here, not
      // from the shelter.
      const vanPositions = vans.map((v) => {
        const path = paths.get(v.id)!;
        const prog = progressRef.current.get(v.id)!;
        const [x, y] = pointOnPath(path, prog.s);
        return { vanId: v.id, x, y };
      });
      await advanceForecast(vanPositions);
      setFlash(true);
      setTimeout(() => setFlash(false), 2500);
    } finally {
      setPending(false);
    }
  }

  async function handleReset() {
    if (resetting) return;
    setResetting(true);
    try {
      await resetSession();
      setSelectedVanId(0);
      setHover(null);
    } finally {
      setResetting(false);
    }
  }

  function handleCanvasEvent(e: MouseEvent<HTMLCanvasElement>, kind: "move" | "click" | "leave") {
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    if (kind === "leave") {
      setHover(null);
      return;
    }
    const fx = (e.clientX - rect.left) / rect.width;
    const fy = (e.clientY - rect.top) / rect.height;
    const px = fx * CANVAS_W;
    const py = fy * CANVAS_H;

    if (kind === "click") {
      let best = -1;
      let bestD = 26;
      for (const v of vans) {
        const path = paths.get(v.id)!;
        const prog = progressRef.current.get(v.id)!;
        const [vx, vy] = pointOnPath(path, prog.s);
        const [vpx, vpy] = project(vx, vy, bounds);
        const d = Math.hypot(vpx - px, vpy - py);
        if (d < bestD) {
          bestD = d;
          best = v.id;
        }
      }
      if (best >= 0) setSelectedVanId(best);
      return;
    }

    let best: ControlRoomNode | null = null;
    let bestD = 18;
    for (const n of nodes) {
      const [npx, npy] = project(n.x, n.y, bounds);
      const d = Math.hypot(npx - px, npy - py);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    setHover(best ? { x: px, y: py, node: best } : null);
  }

  const selVan = vans.find((v) => v.id === selectedVanId) ?? vans[0];
  const selPath = selVan ? paths.get(selVan.id)! : null;
  const selProg = selVan ? progressRef.current.get(selVan.id)! : null;
  const selPct = selPath && selPath.total > 0 && selProg ? Math.round((100 * selProg.s) / selPath.total) : selPath?.points.length === 1 ? 0 : 100;

  const nextUpdateMs = zone ? new Date(zone.nextUpdateIso).getTime() : Date.now();
  const remainingMs = Math.max(0, nextUpdateMs - Date.now());
  const h = Math.floor(remainingMs / 3_600_000);
  const m = Math.floor((remainingMs % 3_600_000) / 60_000);
  const s = Math.floor((remainingMs % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  let coneKm = 0;
  if (selPath) {
    for (const stop of selVan!.stops) if (stop.atRisk) coneKm += 1; // count of at-risk stops, shown as a simple tag below instead
  }
  void coneKm;

  return (
    <div style={{ minHeight: "100vh", boxSizing: "border-box", background: "#080b10", color: "#e6ebf2", fontFamily: `${sansFont}, system-ui, sans-serif`, padding: "24px 32px 28px" }}>
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        <header style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "16px 32px" }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff4d4d", display: "block", animation: "cr-blink 1.6s ease-in-out infinite" }} />
              <span style={{ fontSize: 12, letterSpacing: "0.14em", textTransform: "uppercase", color: "#ff9a9a", fontWeight: 500 }}>
                {activeStormCount} active storm{activeStormCount === 1 ? "" : "s"}
              </span>
            </div>
            <h1 style={{ margin: "6px 0 0", fontSize: 28, fontWeight: 600, letterSpacing: "-0.01em" }}>Cyclone Evacuation Control</h1>
          </div>

          <button
            type="button"
            onClick={handleAdvance}
            disabled={pending}
            style={{
              background: "#10151c",
              border: "1px solid #232b36",
              borderRadius: 12,
              padding: "12px 18px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              minWidth: 300,
              cursor: pending ? "wait" : "pointer",
              textAlign: "left",
              font: "inherit",
              color: "inherit",
            }}
            title="Click to pull the next forecast now"
          >
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
              <div>
                <div style={{ fontSize: 12, color: "#9aa6b6" }}>{pending ? "Pulling next forecast…" : "Next forecast in (click to skip)"}</div>
                <div style={{ fontFamily: `${monoFont}, monospace`, fontSize: 34, fontWeight: 500, letterSpacing: "0.02em", lineHeight: 1.1, marginTop: 2 }}>
                  {pad(h)}:{pad(m)}:{pad(s)}
                </div>
              </div>
              <div style={{ textAlign: "right", fontSize: 12, color: "#9aa6b6", lineHeight: 1.5 }}>
                <div>Tick <span style={{ color: "#e6ebf2", fontFamily: `${monoFont}, monospace` }}>{Math.max(0, tick)}</span></div>
                <div>{solverTier === "real" ? "Neural solver" : "Greedy solver"}</div>
              </div>
            </div>
            <div style={{ height: 4, borderRadius: 4, background: "#232b36", overflow: "hidden" }}>
              <div style={{ height: 4, background: "#5ec8ff", width: `${Math.max(0, Math.min(100, 100 - (remainingMs / (120 * 1000)) * 100))}%` }} />
            </div>
            {flash && <div style={{ fontSize: 12, color: "#5ec8ff", fontWeight: 500 }}>Forecast just updated -- routes recalculated</div>}
          </button>
        </header>

        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ color: "#9aa6b6" }}>Solver:</span>
          <button
            type="button"
            onClick={() => setSolverTier("fast")}
            style={{ borderRadius: 6, padding: "5px 10px", background: solverTier === "fast" ? "#1d2634" : "transparent", border: solverTier === "fast" ? "1px solid #5ec8ff" : "1px solid #232b36", color: "#e6ebf2", cursor: "pointer", font: "inherit" }}
          >
            Fast (greedy)
          </button>
          <button
            type="button"
            onClick={() => setSolverTier("real")}
            style={{ borderRadius: 6, padding: "5px 10px", background: solverTier === "real" ? "#1d2634" : "transparent", border: solverTier === "real" ? "1px solid #5ec8ff" : "1px solid #232b36", color: "#e6ebf2", cursor: "pointer", font: "inherit" }}
          >
            Real (neural Pointer Network)
          </button>
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            title="Start a brand new session -- fresh random villages/shelters/forecast, every van reset"
            style={{
              marginLeft: 8,
              borderRadius: 6,
              padding: "5px 10px",
              background: "transparent",
              border: "1px solid #3a2b2b",
              color: "#ff9a9a",
              cursor: resetting ? "wait" : "pointer",
              font: "inherit",
            }}
          >
            {resetting ? "Starting…" : "↻ New session"}
          </button>
          <span style={{ color: "#5a6577", marginLeft: 8 }}>{log[0]}</span>
        </div>

        <nav aria-label="Evacuation vans" style={{ marginTop: 20, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: 8 }}>
          {vans.map((v) => {
            const pressed = v.id === selectedVanId;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedVanId(v.id)}
                aria-pressed={pressed}
                style={{
                  minHeight: 56,
                  boxSizing: "border-box",
                  padding: "8px 12px",
                  borderRadius: 10,
                  border: `2px solid ${pressed ? v.color : "#232b36"}`,
                  background: pressed ? "#1d2634" : "#10151c",
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  cursor: "pointer",
                  color: "#e6ebf2",
                  textAlign: "left",
                  font: "inherit",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", display: "block", background: v.color }} />
                  <span style={{ fontFamily: `${monoFont}, monospace`, fontSize: 15, fontWeight: 600 }}>{v.name}</span>
                </span>
                <span style={{ fontSize: 12, color: "#9aa6b6" }}>{v.stops.length === 0 ? "No route" : `${v.stops.length} stop${v.stops.length === 1 ? "" : "s"}`}</span>
              </button>
            );
          })}
        </nav>

        <main style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "stretch" }}>
          <section aria-label="Evacuation map" style={{ flex: "9 1 620px", minWidth: 0 }}>
            <div style={{ position: "relative", width: "100%", aspectRatio: `${CANVAS_W} / ${CANVAS_H}`, background: "#070a0f", border: "1px solid #232b36", borderRadius: 14, overflow: "hidden" }}>
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                role="img"
                aria-label={`Map of ${nodes.length} villages, ${shelters.length} shelters, ${vans.length} evacuation vans and the current storm forecast. Click a van button above, or a van marker on the map, to see its route.`}
                onClick={(e) => handleCanvasEvent(e, "click")}
                onMouseMove={(e) => handleCanvasEvent(e, "move")}
                onMouseLeave={(e) => handleCanvasEvent(e, "leave")}
                style={{ width: "100%", height: "100%", display: "block", cursor: "pointer" }}
              />

              <div style={{ position: "absolute", top: 12, left: 12, pointerEvents: "none", background: "rgba(8,11,16,0.82)", border: "1px solid #232b36", borderRadius: 8, padding: "6px 10px", fontFamily: `${monoFont}, monospace`, fontSize: 12, color: "#c9d2de" }}>
                {nodes.length} villages &middot; {shelters.length} shelters &middot; {vans.length} vans &middot;{" "}
                {nodes.filter((n) => n.evacuated).length} evacuated &middot; live solver output
              </div>

              <div style={{ position: "absolute", left: 12, bottom: 12, pointerEvents: "none", display: "flex", flexWrap: "wrap", gap: "6px 16px", background: "rgba(8,11,16,0.82)", border: "1px solid #232b36", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#c9d2de" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, background: "rgba(255,70,70,0.6)", border: "1px solid #ff6b6b", display: "block" }} />
                  Storm forecast
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: "50%", background: "#5ec8ff", display: "block" }} />
                  Van
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 11, height: 11, border: "2px solid #9be3b0", background: "#12251a", display: "block" }} />
                  Shelter
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 11, height: 11, borderRadius: "50%", border: "1.4px solid #5e6b7d", opacity: 0.6, display: "block" }} />
                  Evacuated (masked)
                </span>
              </div>

              {hover && (
                <div
                  style={{
                    position: "absolute",
                    right: 12,
                    bottom: 12,
                    pointerEvents: "none",
                    maxWidth: "60%",
                    background: "rgba(8,11,16,0.9)",
                    border: "1px solid #2f3a49",
                    borderRadius: 8,
                    padding: "6px 10px",
                    fontFamily: `${monoFont}, monospace`,
                    fontSize: 12,
                    color: "#e6ebf2",
                    lineHeight: 1.5,
                  }}
                >
                  {hover.node.name} &middot; demand {hover.node.demand} &middot;{" "}
                  {hover.node.evacuated ? "evacuated" : hover.node.tier}
                  {!hover.node.evacuated && hover.node.tier !== "normal" && ` (${Math.round(hover.node.riskScore * 100)}% risk)`}
                </div>
              )}
            </div>
          </section>

          <aside aria-label="Selected van route" style={{ flex: "1 1 360px", minWidth: 0, boxSizing: "border-box", background: "#10151c", border: "1px solid #232b36", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
            {selVan && (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ width: 14, height: 14, borderRadius: "50%", display: "block", background: selVan.color }} />
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>{selVan.name}</h2>
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 500, color: "#e6ebf2", background: "#1d2634", border: "1px solid #2f3a49", borderRadius: 999, padding: "4px 10px", whiteSpace: "nowrap" }}>
                    {selVan.stops.length === 0 ? "No route" : selPct! >= 100 ? "At shelter" : "En route"}
                  </span>
                </div>

                <div>
                  <div style={{ height: 6, borderRadius: 6, background: "#232b36", overflow: "hidden" }}>
                    <div style={{ height: 6, background: selVan.color, width: `${selPct ?? 0}%` }} />
                  </div>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#9aa6b6" }}>{selPct ?? 0}% of the route done</div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                  <div style={{ background: "#171d26", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 12, color: "#9aa6b6" }}>Distance</div>
                    <div style={{ fontFamily: `${monoFont}, monospace`, fontSize: 16, fontWeight: 500, marginTop: 2 }}>{selVan.totalDistanceKm.toFixed(0)} km</div>
                  </div>
                  <div style={{ background: "#171d26", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 12, color: "#9aa6b6" }}>Drive time</div>
                    <div style={{ fontFamily: `${monoFont}, monospace`, fontSize: 16, fontWeight: 500, marginTop: 2 }}>{fmtMin(selVan.totalTravelMinutes)}</div>
                  </div>
                  <div style={{ background: "#171d26", borderRadius: 10, padding: "10px 12px" }}>
                    <div style={{ fontSize: 12, color: "#9aa6b6" }}>Reward</div>
                    <div style={{ fontFamily: `${monoFont}, monospace`, fontSize: 16, fontWeight: 500, marginTop: 2, color: "#9be3b0" }}>{selVan.totalReward.toFixed(0)}</div>
                  </div>
                </div>

                <div style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "#9aa6b6", fontWeight: 500 }}>Route, step by step</div>

                <ol style={{ margin: 0, padding: "0 4px 0 0", listStyle: "none", display: "flex", flexDirection: "column", gap: 2, maxHeight: 330, overflowY: "auto" }}>
                  {(() => {
                    const startingShelter = shelters.find((s) => Math.hypot(selVan.startX - s.x, selVan.startY - s.y) < 0.05);
                    return (
                      <li style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto", gap: 10, alignItems: "start", padding: "8px 8px", borderRadius: 8 }}>
                        <span style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: `${monoFont}, monospace`, fontSize: 12, fontWeight: 600, color: "#05080c", background: "#e6ebf2" }}>
                          {startingShelter ? "D" : "V"}
                        </span>
                        <span>
                          <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>{startingShelter ? "Depart shelter" : "Continue from current position"}</span>
                          <span style={{ display: "block", fontSize: 12, color: "#9aa6b6", marginTop: 1 }}>
                            {startingShelter ? startingShelter.name : "mid-route when this forecast arrived -- not reset to a shelter"}
                          </span>
                        </span>
                        <span />
                      </li>
                    );
                  })()}
                  {selVan.stops.length === 0 && (
                    <li style={{ padding: "8px 8px", fontSize: 13, color: "#9aa6b6" }}>Nothing reachable right now -- wait for the next forecast.</li>
                  )}
                  {selVan.stops.map((stop, i) => {
                    const prevPos = i === 0 ? { x: selVan.startX, y: selVan.startY } : selVan.stops[i - 1];
                    const legKm = planeDistanceKm([prevPos.x, prevPos.y], [stop.x, stop.y]);
                    const done = selProg && selPath ? selPath.cum[i + 1] <= selProg.s - 0.01 : false;
                    const isNow = selProg && selPath ? selPath.cum[i] <= selProg.s && selProg.s < selPath.cum[i + 1] : false;
                    return (
                      <li key={stop.nodeId} style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto", gap: 10, alignItems: "start", padding: "8px 8px", borderRadius: 8, background: isNow ? "#1b2430" : "transparent", opacity: done ? 0.55 : 1 }}>
                        <span style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: `${monoFont}, monospace`, fontSize: 12, fontWeight: 600, color: "#05080c", background: stop.atRisk ? "#ff9f68" : "#ffd166" }}>
                          {i + 1}
                        </span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 14, fontWeight: 500, lineHeight: 1.35 }}>Pick up at {stop.name}</span>
                          <span style={{ display: "block", fontSize: 12, color: "#9aa6b6", marginTop: 1 }}>
                            {legKm.toFixed(1)} km &middot; {stop.demandServed.toLocaleString()} people &middot; reward {stop.rewardCollected.toFixed(0)}
                          </span>
                          {stop.atRisk && <span style={{ display: "block", fontSize: 12, color: "#ff9a9a", marginTop: 2 }}>In the current forecast risk zone</span>}
                        </span>
                        <span style={{ textAlign: "right", fontFamily: `${monoFont}, monospace`, fontSize: 12, color: "#c9d2de", lineHeight: 1.4, whiteSpace: "nowrap" }}>
                          {isNow && <span style={{ display: "block", color: "#5ec8ff", fontWeight: 600 }}>NOW</span>}
                        </span>
                      </li>
                    );
                  })}
                  {selVan.stops.length > 0 && (
                    <li style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto", gap: 10, alignItems: "start", padding: "8px 8px", borderRadius: 8 }}>
                      <span style={{ width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: `${monoFont}, monospace`, fontSize: 12, fontWeight: 600, color: "#05080c", background: "#9be3b0" }}>S</span>
                      <span>
                        <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>
                          Drop off at {selVan.dropoffShelterId === selVan.homeShelterId ? "shelter (home)" : "nearest shelter"}
                        </span>
                        <span style={{ display: "block", fontSize: 12, color: "#9aa6b6", marginTop: 1 }}>
                          {selVan.dropoffShelterName}
                          {selVan.dropoffShelterId !== selVan.homeShelterId && ` -- closer than its home shelter (${selVan.homeShelterName})`}
                        </span>
                      </span>
                      <span />
                    </li>
                  )}
                </ol>
              </>
            )}
          </aside>
        </main>

        <p style={{ margin: "16px 0 0", fontSize: 12, color: "#8793a3", lineHeight: 1.5 }}>
          Node positions and the storm forecast are synthetic (the same abstract plane the rest of this project uses) --
          but every route shown here is computed live by the real solver stack (greedy baseline or the trained neural
          Pointer Network + beam search, dispatched by the same routeCluster() /rolling-horizon uses), not scripted.
          {shelters.length > 1 && " Two shelters, each with its own fixed set of vans, drawing from one shared pool of villages."}{" "}
          Click the countdown to pull the next forecast -- every van replans immediately, with no commit window, and
          its new route starts from wherever it currently is, not reset back to its shelter.
        </p>
      </div>
      <style>{`@keyframes cr-blink{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

/**
 * Live ticking countdown to the next forecast update. The only client
 * component on an otherwise fully server-rendered page -- everything
 * else here (tick state, van selection, evacuation, override) is driven
 * by URL params and computed server-side; a real-time countdown is the
 * one thing that genuinely needs to tick in the browser between page
 * loads rather than only updating on navigation.
 */
export function ForecastCountdown({ nextUpdateIso }: { nextUpdateIso: string }) {
  const target = new Date(nextUpdateIso).getTime();
  const [remainingMs, setRemainingMs] = useState(() => target - Date.now());

  useEffect(() => {
    const id = setInterval(() => setRemainingMs(target - Date.now()), 1000);
    return () => clearInterval(id);
  }, [target]);

  const clamped = Math.max(0, remainingMs);
  const h = Math.floor(clamped / 3_600_000);
  const m = Math.floor((clamped % 3_600_000) / 60_000);
  const s = Math.floor((clamped % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <span className="rounded bg-muted px-2 py-1 font-mono text-xs">
      {clamped === 0 ? "forecast update due" : `next forecast: ${pad(h)}:${pad(m)}:${pad(s)}`}
    </span>
  );
}

/** Small dependency-free SVG line chart (server-rendered). */
export interface Series {
  label: string;
  color: string;
  points: { x: number; y: number }[];
  faint?: boolean;
}

function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / count)));
  const err = span / count / step;
  const mult = err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1;
  const s = step * mult;
  const out: number[] = [];
  for (let v = Math.ceil(min / s) * s; v <= max + 1e-9; v += s) out.push(Number(v.toFixed(6)));
  return out;
}

export function LineChart({ series, xLabel, yLabel, height = 240 }: { series: Series[]; xLabel: string; yLabel: string; height?: number }) {
  const W = 560;
  const H = height;
  const pad = { l: 48, r: 12, t: 10, b: 34 };
  const all = series.flatMap((s) => s.points);
  const xMin = Math.min(...all.map((p) => p.x));
  const xMax = Math.max(...all.map((p) => p.x));
  const yMinRaw = Math.min(...all.map((p) => p.y));
  const yMaxRaw = Math.max(...all.map((p) => p.y));
  const yPad = (yMaxRaw - yMinRaw) * 0.08 || 1;
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;
  const sx = (x: number) => pad.l + ((x - xMin) / (xMax - xMin || 1)) * (W - pad.l - pad.r);
  const sy = (y: number) => H - pad.b - ((y - yMin) / (yMax - yMin || 1)) * (H - pad.t - pad.b);
  const yTicks = niceTicks(yMin, yMax);
  const xTicks = niceTicks(xMin, xMax, 5);

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${yLabel} by ${xLabel}`}>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="rgba(255,255,255,0.07)" />
            <text x={pad.l - 6} y={sy(t) + 3.5} textAnchor="end" fontSize="10.5" fill="#7c8796">
              {Math.abs(t) >= 1000 ? `${(t / 1000).toFixed(1)}k` : t}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={`x${t}`} x={sx(t)} y={H - pad.b + 15} textAnchor="middle" fontSize="10.5" fill="#7c8796">
            {t}
          </text>
        ))}
        <text x={(pad.l + W - pad.r) / 2} y={H - 4} textAnchor="middle" fontSize="11" fill="#9aa6b6">
          {xLabel}
        </text>
        {series.map((s) => (
          <polyline
            key={s.label}
            fill="none"
            stroke={s.color}
            strokeWidth={s.faint ? 1 : 2}
            strokeOpacity={s.faint ? 0.35 : 1}
            strokeLinejoin="round"
            points={s.points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ")}
          />
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4" style={{ background: s.color, opacity: s.faint ? 0.45 : 1 }} />
            {s.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function movingAverage(points: { x: number; y: number }[], window: number): { x: number; y: number }[] {
  return points.map((p, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = points.slice(from, i + 1);
    return { x: p.x, y: slice.reduce((a, q) => a + q.y, 0) / slice.length };
  });
}

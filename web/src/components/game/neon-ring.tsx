"use client";

import { motion } from "framer-motion";

export function NeonRing({
  progress,
  size = 104,
  strokeWidth = 8,
  color = "#00f3ff",
  trackColor = "#0f172a",
  label,
  sublabel,
}: {
  /** 0-1 */
  progress: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
  trackColor?: string;
  label: string;
  sublabel?: string;
}) {
  const clamped = Math.max(0, Math.min(1, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped);

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{ filter: `drop-shadow(0 0 6px ${color}) drop-shadow(0 0 2px ${color})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-base font-bold tabular-nums text-white">{label}</span>
        {sublabel && <span className="text-[9px] uppercase tracking-wide text-white/50">{sublabel}</span>}
      </div>
    </div>
  );
}

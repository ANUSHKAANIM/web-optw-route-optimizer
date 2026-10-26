"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MapPin,
  Radar,
  Scale,
  Trophy,
} from "lucide-react";
import { NeonRing } from "@/components/game/neon-ring";
import { formatDurationClock, formatHoursClock, istHourOfDay } from "@/lib/time/ist-clock";
import type { SessionView } from "@/lib/services/game.service";

const CYAN = "#00f3ff";
const MAGENTA = "#ff0055";

export function CommandDeck({
  view,
  currentStopName,
  nextRecommendedName,
  busy,
  done,
  onFollowRecommended,
  onEndJourney,
}: {
  view: SessionView;
  currentStopName: string;
  nextRecommendedName: string | undefined;
  busy: boolean;
  done: boolean;
  onFollowRecommended: () => void;
  onEndJourney: () => void;
}) {
  const [forecastOpen, setForecastOpen] = useState(true);
  const self = view.self!;
  const isEvacuationSim = view.session.mode === "evacuation_sim";

  const remainingHours = Math.max(0, view.session.maxTime - self.currentTime);
  const timeProgress = view.session.maxTime > 0 ? remainingHours / view.session.maxTime : 0;
  const sessionStartIstHour = istHourOfDay(new Date(view.session.startedAt));
  const gameClock = formatHoursClock(sessionStartIstHour + self.currentTime);

  const projected = self.recommendation.totalReward;
  const scoreProgress = projected > 0 ? Math.min(1, self.totalReward / projected) : 0;

  return (
    <motion.div
      initial={{ opacity: 0, x: -24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="pointer-events-auto w-[19rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-cyan-400/25 bg-black/55 p-4 shadow-[0_0_40px_rgba(0,243,255,0.12)] backdrop-blur-xl"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-cyan-300">
          {!done && (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-cyan-400 opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-cyan-400" />
            </span>
          )}
          {done ? "Route Complete" : "Live Routing"}
        </span>
        <span className="text-[10px] text-white/40">#{view.session.id}</span>
      </div>

      <div className="flex items-center gap-4">
        <NeonRing progress={timeProgress} color={CYAN} label={formatDurationClock(remainingHours)} sublabel="remaining" />
        <div className="flex-1 space-y-2 text-xs">
          <Row icon={MapPin} label="Current" value={currentStopName} color={CYAN} />
          <Row icon={Trophy} label="Score" value={`${self.totalReward.toFixed(0)}`} color={MAGENTA} />
          <Row icon={Radar} label="Clock" value={gameClock} color={CYAN} />
        </div>
      </div>

      <div className="mt-4 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-white/40">
          <span>Reward vs. projected</span>
          <span className="tabular-nums text-white/70">
            {self.totalReward.toFixed(0)} / {projected.toFixed(0)}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, ${MAGENTA}, ${CYAN})`, boxShadow: `0 0 8px ${CYAN}` }}
            initial={false}
            animate={{ width: `${Math.round(scoreProgress * 100)}%` }}
            transition={{ duration: 0.5 }}
          />
        </div>
      </div>

      {!done && (
        <div className="mt-4 flex flex-col gap-2">
          <button
            onClick={onFollowRecommended}
            disabled={busy || !nextRecommendedName}
            className="group flex items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-3 py-2.5 text-xs font-semibold text-cyan-200 shadow-[0_0_18px_rgba(0,243,255,0.15)] transition-all hover:bg-cyan-400/20 hover:shadow-[0_0_26px_rgba(0,243,255,0.3)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
            Reroute to {nextRecommendedName ?? "…"}
          </button>
          <button
            onClick={onEndJourney}
            disabled={busy}
            className="flex items-center justify-center gap-2 rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/5 px-3 py-2 text-xs font-medium text-fuchsia-200/80 transition-all hover:bg-fuchsia-500/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            End Journey → Depot
          </button>
        </div>
      )}

      {isEvacuationSim && view.forecast && (
        <div className="mt-4 overflow-hidden rounded-xl border border-red-500/30 bg-red-500/5">
          <button
            onClick={() => setForecastOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-red-300"
          >
            <span className="flex items-center gap-1.5">
              <AlertTriangle className="size-3.5" />
              Forecast Simulation
            </span>
            <ChevronDown className={`size-3.5 transition-transform ${forecastOpen ? "rotate-180" : ""}`} />
          </button>
          <AnimatePresence initial={false}>
            {forecastOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <div className="space-y-1.5 px-3 pb-3 text-[11px] text-white/60">
                  <p className="text-[9px] uppercase tracking-wide text-red-400/80">
                    Simulation / Mock Forecast -- not real weather data
                  </p>
                  <Row icon={Radar} label="Scenario" value={`#${view.forecast.scenarioId}`} color={MAGENTA} compact />
                  <Row
                    icon={AlertTriangle}
                    label="Risk radius"
                    value={`${view.forecast.riskZone.radiusKm.toFixed(1)} km`}
                    color={MAGENTA}
                    compact
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <div className="mt-4 space-y-1.5 border-t border-white/10 pt-3 text-[11px]">
        <div className="flex items-center gap-1.5 text-white/50">
          <Scale className="size-3.5" />
          <span className="uppercase tracking-wide">Neural vs. baseline</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/40">Baseline (greedy)</span>
          <span className="tabular-nums text-white/70">{self.baseline.totalReward.toFixed(0)}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-white/40">Neural (recommended)</span>
          <span className="font-semibold tabular-nums text-cyan-300">{self.recommendation.totalReward.toFixed(0)}</span>
        </div>
      </div>
    </motion.div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  color,
  compact = false,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  label: string;
  value: string;
  color: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${compact ? "" : "gap-2"}`}>
      <span className="flex items-center gap-1.5 text-white/45">
        <Icon className="size-3.5" style={{ color }} />
        {label}
      </span>
      <span className="truncate font-medium text-white/85">{value}</span>
    </div>
  );
}

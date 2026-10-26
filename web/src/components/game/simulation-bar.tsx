"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Pause, Play, RotateCcw } from "lucide-react";

const STEP_DURATION_MS = 1600;

export interface SimulationState {
  isPlaying: boolean;
  /** Index into `path` of the node currently highlighted by playback. */
  currentNode: number;
}

/**
 * Client-side-only playback of the recommended route: steps a marker along
 * `path` on a fixed visual interval and tallies reward as it goes. This is
 * a preview, not a re-simulation of real in-game time -- it never calls the
 * step mutation, so it's safe to play at any point without spending the
 * player's actual time budget.
 */
export function SimulationBar({
  path,
  placeName,
  rewards,
  onStateChange,
}: {
  path: number[];
  placeName: (nodeIndex: number) => string;
  rewards: number[];
  onStateChange: (state: SimulationState) => void;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const reset = useCallback(() => {
    setStepIndex(0);
    setIsPlaying(false);
  }, []);

  // Restart playback from the top whenever the underlying route actually
  // changes content (a real move happened) -- adjusted during render
  // (React's documented pattern for deriving state from a changing prop)
  // rather than in an effect, and keyed by content so a poll that returns
  // an identical path (a new array, same values) doesn't interrupt playback.
  const pathKey = path.join(",");
  const [lastPathKey, setLastPathKey] = useState(pathKey);
  if (lastPathKey !== pathKey) {
    setLastPathKey(pathKey);
    reset();
  }

  useEffect(() => {
    onStateChange({ isPlaying, currentNode: path[stepIndex] ?? path[0] ?? 0 });
  }, [isPlaying, stepIndex, path, onStateChange]);

  useEffect(() => {
    if (!isPlaying || stepIndex >= path.length - 1) return;
    const id = setTimeout(() => setStepIndex((i) => Math.min(i + 1, path.length - 1)), STEP_DURATION_MS);
    return () => clearTimeout(id);
  }, [isPlaying, stepIndex, path.length]);

  if (path.length < 2) return null;

  const currentNode = path[stepIndex] ?? path[0];
  const simulatedReward = path.slice(0, stepIndex + 1).reduce((sum, n) => sum + (rewards[n] ?? 0), 0);
  const atEnd = stepIndex >= path.length - 1;
  const showAsPlaying = isPlaying && !atEnd;

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="pointer-events-auto w-full max-w-xl rounded-2xl border border-fuchsia-500/25 bg-black/60 px-4 py-3 shadow-[0_0_30px_rgba(255,0,85,0.12)] backdrop-blur-xl"
    >
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            if (atEnd) {
              setStepIndex(0);
              setIsPlaying(true);
            } else {
              setIsPlaying((p) => !p);
            }
          }}
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-fuchsia-400/40 bg-fuchsia-500/10 text-fuchsia-200 transition-all hover:bg-fuchsia-500/20"
          aria-label={showAsPlaying ? "Pause simulation" : "Play simulation"}
        >
          {showAsPlaying ? <Pause className="size-4" /> : <Play className="size-4 translate-x-0.5" />}
        </button>
        <button
          onClick={reset}
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/40 transition-colors hover:text-white/70"
          aria-label="Reset simulation"
        >
          <RotateCcw className="size-3.5" />
        </button>

        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-wide text-white/40">
            <span>Simulating recommended path</span>
            <span className="tabular-nums text-fuchsia-300">+{simulatedReward.toFixed(0)} pts</span>
          </div>
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-fuchsia-500 to-cyan-400"
              style={{ boxShadow: "0 0 8px #ff0055" }}
              animate={{ width: `${(stepIndex / (path.length - 1)) * 100}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <div className="mt-1 truncate text-[11px] text-white/60">
            Stop {stepIndex + 1}/{path.length}: <span className="text-white/85">{placeName(currentNode)}</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

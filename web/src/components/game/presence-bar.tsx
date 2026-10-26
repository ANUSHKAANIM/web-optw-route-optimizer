"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Users } from "lucide-react";
import type { PlayerSummary } from "@/lib/services/game.service";

export function PresenceBar({ self, others }: { self: PlayerSummary; others: PlayerSummary[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-cyan-400/25 bg-black/55 px-3 py-1.5 shadow-[0_0_24px_rgba(0,243,255,0.1)] backdrop-blur-xl"
    >
      <Users className="size-3.5 text-cyan-300" />
      <div className="flex items-center -space-x-1.5">
        <PresenceDot color="#facc15" name={`${self.name} (you)`} pulse={self.status === "active"} />
        <AnimatePresence initial={false}>
          {others.slice(0, 6).map((p) => (
            <motion.div
              key={p.id}
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <PresenceDot color={p.color} name={p.name} pulse={p.status === "active"} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {others.length > 6 && <span className="text-[10px] text-white/50">+{others.length - 6}</span>}
      {others.length === 0 && <span className="text-[10px] text-white/40">Solo</span>}
    </motion.div>
  );
}

function PresenceDot({ color, name, pulse }: { color: string; name: string; pulse: boolean }) {
  return (
    <div
      title={name}
      className="relative flex size-6 items-center justify-center rounded-full border-2 border-black/60"
      style={{ backgroundColor: color }}
    >
      {pulse && (
        <span
          className="absolute inline-flex size-full animate-ping rounded-full opacity-60"
          style={{ backgroundColor: color }}
        />
      )}
    </div>
  );
}

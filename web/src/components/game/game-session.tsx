"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { DelhiMap } from "@/components/map/delhi-map";
import { CommandDeck } from "@/components/game/command-deck";
import { PresenceBar } from "@/components/game/presence-bar";
import { SimulationBar, type SimulationState } from "@/components/game/simulation-bar";
import { apiClient } from "@/lib/api-client";
import type { SessionView } from "@/lib/services/game.service";

const POLL_INTERVAL_MS = 3000;

export function GameSession({
  sessionId,
  playerId,
  initialView,
}: {
  sessionId: number;
  playerId: number;
  initialView: SessionView;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["session", sessionId, playerId];

  const { data: view } = useQuery({
    queryKey,
    queryFn: () => apiClient.getSession(sessionId, playerId),
    initialData: initialView,
    refetchInterval: POLL_INTERVAL_MS,
  });

  const [simState, setSimState] = useState<SimulationState | null>(null);

  const stepMutation = useMutation({
    mutationFn: (node: number) => apiClient.stepPlayer(sessionId, playerId, node),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error: Error) => toast.error("Couldn't move there", { description: error.message }),
  });

  const endMutation = useMutation({
    mutationFn: () => apiClient.endPlayer(sessionId, playerId),
    onSuccess: (next) => queryClient.setQueryData(queryKey, next),
    onError: (error: Error) => toast.error("Couldn't end the route", { description: error.message }),
  });

  const self = view.self;
  if (!self) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 p-6 text-sm text-white/60">
        You are not a player in this session. Join from the lobby first.
      </div>
    );
  }

  const busy = stepMutation.isPending || endMutation.isPending;
  const done = self.status === "finished";
  const recommendedPath = self.recommendation.path;
  const nextRecommendedNode = recommendedPath.length > 1 ? recommendedPath[1] : undefined;
  const otherActivePlayers = view.players.filter((p) => p.id !== self.id);
  const pendingNode = stepMutation.isPending ? stepMutation.variables : undefined;

  return (
    <div className="duration-500 animate-in fade-in slide-in-from-bottom-2">
      <div className="relative h-[78vh] min-h-[560px] w-full overflow-hidden rounded-2xl border border-cyan-500/20 bg-black shadow-[0_0_60px_rgba(0,243,255,0.06)]">
        <DelhiMap
          theme="neon"
          places={view.places}
          currentRewards={view.currentRewards}
          graphEdges={view.graphEdges}
          depotIndex={view.depotIndex}
          feasibleNodes={done ? [] : self.recommendation.feasibleNodes}
          visitedPath={self.path}
          recommendedPath={done ? [] : recommendedPath}
          baselinePath={done ? [] : self.baseline.path}
          pendingNode={pendingNode}
          simulatedNode={simState?.currentNode}
          currentNode={self.currentNode}
          otherPlayers={otherActivePlayers}
          riskZone={view.forecast?.riskZone}
          interactive={!done && !busy}
          onSelectNode={(node) => stepMutation.mutate(node)}
        />

        {/* Floating HUD layer -- pointer-events re-enabled per-panel below,
            since the layer itself must stay click-through for map dragging. */}
        <div className="pointer-events-none absolute inset-0 z-[1000] flex flex-col justify-between gap-3 p-3 sm:p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CommandDeck
              view={view}
              currentStopName={placeName(view, self.currentNode)}
              nextRecommendedName={nextRecommendedNode !== undefined ? placeName(view, nextRecommendedNode) : undefined}
              busy={busy}
              done={done}
              onFollowRecommended={() => nextRecommendedNode !== undefined && stepMutation.mutate(nextRecommendedNode)}
              onEndJourney={() => endMutation.mutate()}
            />
            <PresenceBar self={self} others={otherActivePlayers} />
          </div>

          {!done && recommendedPath.length > 1 && (
            <div className="flex justify-center">
              <SimulationBar
                path={recommendedPath}
                placeName={(node) => placeName(view, node)}
                rewards={view.currentRewards}
                onStateChange={setSimState}
              />
            </div>
          )}
        </div>

        {stepMutation.isPending && (
          <div className="pointer-events-none absolute inset-0 z-[1100] flex items-center justify-center bg-black/40 backdrop-blur-[1px] duration-150 animate-in fade-in">
            <div className="flex items-center gap-2 rounded-full border border-cyan-400/30 bg-black/70 px-4 py-2 text-sm font-medium text-cyan-200 shadow-[0_0_20px_rgba(0,243,255,0.2)]">
              <Loader2 className="size-4 animate-spin" />
              Rerouting to {placeName(view, pendingNode ?? -1)}…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function placeName(view: SessionView, index: number): string {
  return view.places.find((p) => p.index === index)?.name ?? `Stop ${index}`;
}

"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Loader2, MapPin, Timer, Trophy, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DelhiMap } from "@/components/map/delhi-map";
import { apiClient } from "@/lib/api-client";
import { formatDurationClock, formatHoursClock, istHourOfDay } from "@/lib/time/ist-clock";
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

  const [countdown, setCountdown] = useState(Math.ceil(view.secondsUntilNextRewardUpdate));
  // Resync the visible countdown as soon as a fresh poll reports a new
  // server value -- adjusted during render (React's documented pattern for
  // deriving state from a changing prop) rather than in an effect, so the
  // resync itself never triggers an extra render pass.
  const [syncedSecondsRemaining, setSyncedSecondsRemaining] = useState(view.secondsUntilNextRewardUpdate);
  if (syncedSecondsRemaining !== view.secondsUntilNextRewardUpdate) {
    setSyncedSecondsRemaining(view.secondsUntilNextRewardUpdate);
    setCountdown(Math.ceil(view.secondsUntilNextRewardUpdate));
  }

  useEffect(() => {
    const id = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, []);

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
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          You are not a player in this session. Join from the lobby first.
        </CardContent>
      </Card>
    );
  }

  const busy = stepMutation.isPending || endMutation.isPending;
  const done = self.status === "finished";
  const recommendedPath = self.recommendation.path;
  const nextRecommendedNode = recommendedPath.length > 1 ? recommendedPath[1] : undefined;
  const otherActivePlayers = view.players.filter((p) => p.id !== self.id);

  const sessionStartIstHour = istHourOfDay(new Date(view.session.startedAt));
  const gameClock = formatHoursClock(sessionStartIstHour + self.currentTime);
  const remainingHours = Math.max(0, view.session.maxTime - self.currentTime);

  const rewardBoard = view.places
    .filter((p) => p.index !== view.depotIndex)
    .map((p) => ({ place: p, reward: view.currentRewards[p.index] ?? 0 }))
    .sort((a, b) => b.reward - a.reward)
    .slice(0, 8);

  return (
    <div className="grid gap-6 duration-500 animate-in fade-in slide-in-from-bottom-2 lg:grid-cols-[1fr_340px]">
      <Card className="overflow-hidden">
        <CardContent className="aspect-square p-2 sm:p-4">
          <DelhiMap
            places={view.places}
            currentRewards={view.currentRewards}
            graphEdges={view.graphEdges}
            depotIndex={view.depotIndex}
            feasibleNodes={done ? [] : self.recommendation.feasibleNodes}
            visitedPath={self.path}
            recommendedPath={done ? [] : recommendedPath}
            currentNode={self.currentNode}
            otherPlayers={otherActivePlayers}
            interactive={!done && !busy}
            onSelectNode={(node) => stepMutation.mutate(node)}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {!done && (
                <span className="relative flex size-2">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-75" />
                  <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
                </span>
              )}
              {done ? "Route complete" : "Live routing"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Stat icon={MapPin} label="Current stop" value={placeName(view, self.currentNode)} />
            <Stat icon={Timer} label="Game time" value={`${gameClock} · ${formatDurationClock(remainingHours)} left`} />
            <Stat icon={Trophy} label="Your score" value={self.totalReward.toFixed(0)} />
            <Stat icon={Users} label="Places visited" value={`${self.visitedCount - 1}`} />
          </CardContent>
        </Card>

        {!done && (
          <Card>
            <CardContent className="flex flex-col gap-2 pt-6">
              <Button
                className="gap-2"
                disabled={busy || nextRecommendedNode === undefined}
                onClick={() => nextRecommendedNode !== undefined && stepMutation.mutate(nextRecommendedNode)}
              >
                {stepMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Follow recommended{nextRecommendedNode !== undefined ? ` (${placeName(view, nextRecommendedNode)})` : ""}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => endMutation.mutate()}>
                {endMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                End route → depot
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Dynamic rewards</span>
              <Badge variant="secondary">Next update in {countdown}s</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {rewardBoard.map(({ place, reward }) => (
              <div key={place.id} className="flex items-center justify-between text-sm">
                <span className="truncate text-muted-foreground">{place.name}</span>
                <span className="font-medium tabular-nums">+{reward}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Players in this game</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <PlayerRow name={`${self.name} (you)`} color="#facc15" score={self.totalReward} status={self.status} />
            {otherActivePlayers.map((p) => (
              <PlayerRow key={p.id} name={p.name} color={p.color} score={p.totalReward} status={p.status} />
            ))}
            {otherActivePlayers.length === 0 && (
              <p className="text-xs text-muted-foreground">No other players have joined yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function placeName(view: SessionView, index: number): string {
  return view.places.find((p) => p.index === index)?.name ?? `Stop ${index}`;
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function PlayerRow({
  name,
  color,
  score,
  status,
}: {
  name: string;
  color: string;
  score: number;
  status: "active" | "finished";
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="flex items-center gap-2">
        <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
        {name}
      </span>
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className="tabular-nums">{score.toFixed(0)}</span>
        {status === "finished" && <Badge variant="outline">done</Badge>}
      </span>
    </div>
  );
}

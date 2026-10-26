"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { apiClient } from "@/lib/api-client";
import type { GameMode } from "@/lib/env/reward-providers";

export function NewSessionForm() {
  const router = useRouter();

  const [playerName, setPlayerName] = useState("");
  const [maxTime, setMaxTime] = useState(10);
  const [beamWidth, setBeamWidth] = useState(16);
  const [mode, setMode] = useState<GameMode>("tourist");

  const [joinId, setJoinId] = useState("");
  const [joinName, setJoinName] = useState("");

  function goToSession(view: { session: { id: number }; self?: { id: number } }) {
    if (!view.self) return;
    try {
      localStorage.setItem(`optw-player-${view.session.id}`, String(view.self.id));
    } catch {
      // localStorage can throw in private browsing -- the playerId is still
      // passed via the URL, so the game remains fully usable.
    }
    router.push(`/play/${view.session.id}?playerId=${view.self.id}`);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.createSession({
        playerName: playerName || "Player 1",
        maxTime,
        beamWidth,
        rewardDecayMin: 0.3,
        rewardIntervalSeconds: 45,
        mode,
        forecastIntervalSeconds: 9 * 3600,
      }),
    onSuccess: goToSession,
    onError: (error: Error) => toast.error("Couldn't create session", { description: error.message }),
  });

  const joinMutation = useMutation({
    mutationFn: () => apiClient.joinSession(Number(joinId), { playerName: joinName || "Player" }),
    onSuccess: goToSession,
    onError: (error: Error) => toast.error("Couldn't join session", { description: error.message }),
  });

  return (
    <div className="grid gap-6 duration-500 animate-in fade-in slide-in-from-bottom-3 sm:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Start a new game</CardTitle>
          <CardDescription>
            Creates a shared Delhi tourist-route session. Share the session link so others can join.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="player-name">Your name</Label>
            <Input
              id="player-name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Player 1"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="max-time">Time budget (h)</Label>
              <Input
                id="max-time"
                type="number"
                min={1}
                max={16}
                step={0.5}
                value={maxTime}
                onChange={(e) => setMaxTime(Number(e.target.value))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="beam-width">Beam width</Label>
              <Input
                id="beam-width"
                type="number"
                min={1}
                max={64}
                value={beamWidth}
                onChange={(e) => setBeamWidth(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border bg-muted/40 p-3">
            <div>
              <Label htmlFor="evac-mode" className="flex items-center gap-1.5">
                <AlertTriangle className="size-3.5 text-amber-500" />
                Evacuation Simulation Mode
              </Label>
              <p className="text-xs text-muted-foreground">
                Rewards become a MOCK forecast risk zone (not real weather data) that shifts every 9h
                instead of tourist attraction value. A prototype of a future real evacuation optimizer.
              </p>
            </div>
            <Switch
              id="evac-mode"
              checked={mode === "evacuation_sim"}
              onCheckedChange={(checked) => setMode(checked ? "evacuation_sim" : "tourist")}
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button
            className="gap-2"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Create session
          </Button>
        </CardFooter>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="size-4" />
            Join a game
          </CardTitle>
          <CardDescription>Enter a session ID a friend shared with you.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="join-id">Session ID</Label>
            <Input
              id="join-id"
              inputMode="numeric"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              placeholder="e.g. 4"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="join-name">Your name</Label>
            <Input
              id="join-name"
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="Player 2"
            />
          </div>
        </CardContent>
        <CardFooter>
          <Button
            className="gap-2"
            variant="outline"
            disabled={joinMutation.isPending || !joinId}
            onClick={() => joinMutation.mutate()}
          >
            {joinMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Join session
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

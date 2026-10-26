"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { GraphNode } from "@/types/graph";
import { savePlayerId } from "@/lib/player-storage";

export function NewSessionForm() {
  const router = useRouter();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [playerName, setPlayerName] = useState("");
  const [depotNodeId, setDepotNodeId] = useState("");
  const [totalGameMinutes, setTotalGameMinutes] = useState(240);
  const [joinId, setJoinId] = useState("");
  const [joinName, setJoinName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/nodes")
      .then((r) => r.json())
      .then((data: { nodes: GraphNode[] }) => {
        setNodes(data.nodes);
        const firstShelter = data.nodes.find((n) => n.role === "shelter");
        if (firstShelter) setDepotNodeId(firstShelter.id);
      });
  }, []);

  const shelters = nodes.filter((n) => n.role === "shelter");

  async function createSession() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: playerName || "Player 1",
          depotNodeId,
          totalGameMinutes,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not create session.");
      const view = await res.json();
      savePlayerId(view.session.id, view.self.id);
      router.push(`/play/${view.session.id}?playerId=${view.self.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create session.");
    } finally {
      setBusy(false);
    }
  }

  async function joinSession() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${joinId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName: joinName || "Player" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not join session.");
      const view = await res.json();
      savePlayerId(view.session.id, view.self.id);
      router.push(`/play/${view.session.id}?playerId=${view.self.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 font-semibold">Start a new game</h3>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Your name</span>
            <input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Player 1"
              className="w-full rounded-md border bg-background px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Shelter (evacuation destination)</span>
            <select
              value={depotNodeId}
              onChange={(e) => setDepotNodeId(e.target.value)}
              className="w-full rounded-md border bg-background px-2 py-1.5"
            >
              {shelters.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} (capacity {n.capacity})
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Game duration (minutes)</span>
            <input
              type="number"
              min={30}
              max={1440}
              step={30}
              value={totalGameMinutes}
              onChange={(e) => setTotalGameMinutes(Number(e.target.value))}
              className="w-full rounded-md border bg-background px-2 py-1.5"
            />
          </label>
          <p className="rounded-md border bg-muted/40 p-2.5 text-xs text-muted-foreground">
            Collect origins and deliver evacuees to the shelter before the forecast risk zone catches up. The risk
            forecast is a simulated mock input, not real weather data.
          </p>
          <button
            onClick={createSession}
            disabled={busy || nodes.length === 0}
            className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create session"}
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm">
        <h3 className="mb-3 font-semibold">Join a game</h3>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Session ID</span>
            <input
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              placeholder="e.g. 4"
              inputMode="numeric"
              className="w-full rounded-md border bg-background px-2 py-1.5"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-muted-foreground">Your name</span>
            <input
              value={joinName}
              onChange={(e) => setJoinName(e.target.value)}
              placeholder="Player 2"
              className="w-full rounded-md border bg-background px-2 py-1.5"
            />
          </label>
          <button
            onClick={joinSession}
            disabled={busy || !joinId}
            className="w-full rounded-md border px-3 py-2 font-medium disabled:opacity-50"
          >
            {busy ? "Joining…" : "Join session"}
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive sm:col-span-2">{error}</p>}
    </div>
  );
}

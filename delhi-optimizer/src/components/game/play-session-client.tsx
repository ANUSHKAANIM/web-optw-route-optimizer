"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MultiplayerDashboard } from "./multiplayer-dashboard";
import { loadPlayerId, savePlayerId } from "@/lib/player-storage";

/**
 * Resolves "which player is this browser" without ever hard-404ing:
 * 1. Use the ?playerId= query param if present (the normal case).
 * 2. Otherwise, fall back to localStorage (survives a refresh or a
 *    bookmarked/shared link that dropped the query string).
 * 3. Otherwise, offer a small rejoin form instead of a dead end.
 */
export function PlaySessionClient({
  sessionId,
  initialPlayerId,
}: {
  sessionId: number;
  initialPlayerId: number | null;
}) {
  const router = useRouter();
  const [playerId, setPlayerId] = useState<number | null>(initialPlayerId);
  const [rejoinName, setRejoinName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (playerId !== null) savePlayerId(sessionId, playerId);
  }, [sessionId, playerId]);

  useEffect(() => {
    if (playerId !== null) return;
    const stored = loadPlayerId(sessionId);
    if (stored === null) return;
    // Reading localStorage is a genuine "external system" lookup that can
    // only happen client-side -- but setting state synchronously in an
    // effect body still trips react-hooks/set-state-in-effect, so the
    // update is deferred a microtask rather than fought with a workaround
    // that duplicates the read during render (which would also mismatch
    // SSR, since the server has no localStorage to read).
    queueMicrotask(() => {
      setPlayerId(stored);
      router.replace(`/play/${sessionId}?playerId=${stored}`);
    });
  }, [sessionId, playerId, router]);

  if (playerId !== null) {
    return <MultiplayerDashboard sessionId={sessionId} playerId={playerId} />;
  }

  async function rejoin() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerName: rejoinName || "Player" }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not join this session.");
      const view = await res.json();
      savePlayerId(sessionId, view.self.id);
      setPlayerId(view.self.id);
      router.replace(`/play/${sessionId}?playerId=${view.self.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not join this session.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-sm rounded-xl border bg-card p-6 text-sm shadow-sm">
      <h2 className="mb-2 font-semibold">Rejoin session #{sessionId}</h2>
      <p className="mb-3 text-muted-foreground">
        This device isn&apos;t recognized as a player in this session. Enter a name to join it.
      </p>
      <input
        value={rejoinName}
        onChange={(e) => setRejoinName(e.target.value)}
        placeholder="Your name"
        className="mb-2 w-full rounded-md border bg-background px-2 py-1.5"
      />
      <button
        onClick={rejoin}
        disabled={busy}
        className="w-full rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50"
      >
        {busy ? "Joining…" : "Join session"}
      </button>
      {error && <p className="mt-2 text-destructive">{error}</p>}
    </div>
  );
}

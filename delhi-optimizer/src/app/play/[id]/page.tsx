import { notFound } from "next/navigation";
import { PlaySessionClient } from "@/components/game/play-session-client";

export const dynamic = "force-dynamic";

export default async function PlaySessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ playerId?: string }>;
}) {
  const { id } = await params;
  const { playerId } = await searchParams;

  const sessionId = Number(id);
  if (!Number.isInteger(sessionId) || sessionId <= 0) notFound();

  // A missing/invalid playerId is NOT a 404 -- PlaySessionClient falls back
  // to localStorage, then to a rejoin form, so a refresh or a link that
  // dropped the query string never strands the user on a dead end.
  const parsedPlayerId = Number(playerId);
  const initialPlayerId = Number.isInteger(parsedPlayerId) && parsedPlayerId > 0 ? parsedPlayerId : null;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <PlaySessionClient sessionId={sessionId} initialPlayerId={initialPlayerId} />
    </div>
  );
}

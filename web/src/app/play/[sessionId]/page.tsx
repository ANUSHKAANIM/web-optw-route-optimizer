import { notFound } from "next/navigation";
import { gameService } from "@/lib/services/game.service";
import { NotFoundError } from "@/lib/errors/domain-error";
import { GameSession } from "@/components/game/game-session";

// Multiplayer session state is live and shared -- never statically prerendered.
export const dynamic = "force-dynamic";

export default async function GameSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ sessionId: string }>;
  searchParams: Promise<{ playerId?: string }>;
}) {
  const { sessionId } = await params;
  const { playerId } = await searchParams;

  const id = Number(sessionId);
  const parsedPlayerId = Number(playerId);
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(parsedPlayerId) || parsedPlayerId <= 0) {
    notFound();
  }

  let view;
  try {
    view = await gameService.getSessionView(id, parsedPlayerId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <GameSession sessionId={id} playerId={parsedPlayerId} initialView={view} />
    </div>
  );
}

import { NewSessionForm } from "@/components/game/new-session-form";

export default function PlayLobbyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Evacuation Optimizer -- Multiplayer</h1>
        <p className="text-sm text-muted-foreground">
          Coordinate with other rescue teams to evacuate villages to the shared shelter before the simulated
          cyclone forecast catches up with them.
        </p>
      </header>
      <NewSessionForm />
    </div>
  );
}

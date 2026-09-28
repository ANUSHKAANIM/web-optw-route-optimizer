import { NewSessionForm } from "@/components/forms/new-session-form";
import { PageHeader } from "@/components/layout/page-header";

export default function PlayLobbyPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title="Delhi Multiplayer"
        description="Race friends across ~80 real Delhi tourist spots. Rewards shift every 45s and every place has its own real opening hours -- the recommended route reacts to both, live."
      />
      <NewSessionForm />
    </div>
  );
}

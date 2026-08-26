import { NewRunForm } from "@/components/forms/new-run-form";

export default function NewRunPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">New Run</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure a problem instance and let the trained model plan a live, click-to-route
          orienteering path with time windows.
        </p>
      </div>
      <NewRunForm />
    </div>
  );
}

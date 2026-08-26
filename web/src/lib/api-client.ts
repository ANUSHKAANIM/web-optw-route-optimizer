import type { ComparisonView, RunView } from "@/lib/services/run.service";
import type { CreateRunRequest, ListRunsQuery } from "@/lib/dto/run.dto";
import type { Run, RunEvent } from "@/db/schema";

/** Thin typed wrapper around the app's own API routes, used by client
 * components via TanStack Query. Throws with the server's error message on
 * non-2xx responses so callers can surface it directly. */
async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(body.error ?? "Request failed.");
  }
  return response.json() as Promise<T>;
}

export const apiClient = {
  createRun: (body: CreateRunRequest) =>
    request<RunView>("/api/runs", { method: "POST", body: JSON.stringify(body) }),

  getRun: (id: number) => request<RunView>(`/api/runs/${id}`),

  stepRun: (id: number, node: number) =>
    request<RunView>(`/api/runs/${id}`, { method: "POST", body: JSON.stringify({ node }) }),

  endRun: (id: number) => request<RunView>(`/api/runs/${id}`, { method: "PATCH" }),

  compareRun: (id: number) => request<ComparisonView>(`/api/runs/${id}?view=compare`),

  listEvents: (id: number) => request<{ events: RunEvent[] }>(`/api/runs/${id}?view=events`),

  listRuns: (query: Partial<ListRunsQuery>) => {
    const params = new URLSearchParams(query as Record<string, string>);
    return request<{ items: Run[]; total: number; page: number; pageSize: number }>(
      `/api/runs?${params.toString()}`,
    );
  },
};

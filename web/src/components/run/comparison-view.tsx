"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RouteMap } from "@/components/map/route-map";
import { apiClient } from "@/lib/api-client";

/** Fetches from the API route rather than calling the inference service
 * directly from a server component: the ONNX runtime binary is only
 * bundled for the handful of API routes that need it (see
 * next.config.ts's outputFileTracingIncludes) -- a server component
 * calling into it directly would need the same treatment, and each extra
 * route singled out that way risks tipping Vercel's serverless function
 * count over the Hobby plan's cap. */
export function ComparisonView({ runId }: { runId: number }) {
  const query = useQuery({
    queryKey: ["run-compare", runId],
    queryFn: () => apiClient.compareRun(runId),
  });

  if (query.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full" />
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="aspect-square w-full" />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-muted-foreground">
        <AlertTriangle className="size-8 opacity-60" />
        <p>Couldn&apos;t load the comparison{query.error ? `: ${query.error.message}` : "."}</p>
      </div>
    );
  }

  const { coords, rewards, greedy, beam, beamWidth } = query.data;
  const delta = beam.totalReward - greedy.totalReward;
  const pctGain = greedy.totalReward > 0 ? (delta / greedy.totalReward) * 100 : 0;

  return (
    <div className="space-y-6 duration-500 animate-in fade-in slide-in-from-bottom-2">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-6 text-sm">
          <Stat label="Greedy reward" value={greedy.totalReward.toFixed(1)} />
          <Stat label={`Beam reward (n_b=${beamWidth})`} value={beam.totalReward.toFixed(1)} />
          <Stat
            label="Improvement"
            value={`${delta >= 0 ? "+" : ""}${delta.toFixed(1)} (${pctGain >= 0 ? "+" : ""}${pctGain.toFixed(1)}%)`}
            highlight={delta > 0}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <RoutePanel
          title="Greedy Search"
          badge={`${greedy.path.length - 2} stops`}
          coords={coords}
          rewards={rewards}
          path={greedy.path}
          finalTime={greedy.finalTime}
        />
        <RoutePanel
          title={`Beam Search (n_b=${beamWidth})`}
          badge={`${beam.path.length - 2} stops`}
          coords={coords}
          rewards={rewards}
          path={beam.path}
          finalTime={beam.finalTime}
        />
      </div>
    </div>
  );
}

function RoutePanel({
  title,
  badge,
  coords,
  rewards,
  path,
  finalTime,
}: {
  title: string;
  badge: string;
  coords: [number, number][];
  rewards: number[];
  path: number[];
  finalTime: number;
}) {
  return (
    <Card className="card-interactive overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">{title}</CardTitle>
        <Badge variant="secondary">{badge}</Badge>
      </CardHeader>
      <CardContent className="aspect-square p-2 sm:p-4">
        <RouteMap
          coords={coords}
          effectiveRewards={rewards}
          path={path}
          feasibleNodes={[]}
          recommendedPath={[]}
          currentNode={path[path.length - 1]}
          interactive={false}
        />
      </CardContent>
      <p className="px-6 pb-4 text-xs text-muted-foreground">Finishes at t={finalTime.toFixed(2)}h</p>
    </Card>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`font-semibold tabular-nums ${highlight ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
        {value}
      </div>
    </div>
  );
}

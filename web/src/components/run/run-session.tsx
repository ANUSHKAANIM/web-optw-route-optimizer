"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Flag, Loader2, MapPin, Timer, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RouteMap } from "@/components/map/route-map";
import { apiClient } from "@/lib/api-client";
import type { RunView } from "@/lib/services/run.service";

export function RunSession({ initialView }: { initialView: RunView }) {
  const [view, setView] = useState(initialView);

  const stepMutation = useMutation({
    mutationFn: (node: number) => apiClient.stepRun(view.run.id, node),
    onSuccess: (next) => applyUpdate(next),
    onError: (error: Error) => toast.error("Couldn't move there", { description: error.message }),
  });

  const endMutation = useMutation({
    mutationFn: () => apiClient.endRun(view.run.id),
    onSuccess: (next) => applyUpdate(next),
    onError: (error: Error) => toast.error("Couldn't end the run", { description: error.message }),
  });

  function applyUpdate(next: RunView) {
    setView(next);
    if (next.forecastJustUpdated) {
      toast.warning("Forecast updated", {
        description: "Rewards and evacuation deadlines for unvisited nodes have shifted.",
      });
    }
    if (next.done) {
      toast.success("Route complete", {
        description: `Total reward ${next.run.totalReward.toFixed(1)} over ${next.run.path.length - 1} stops.`,
      });
    }
  }

  const busy = stepMutation.isPending || endMutation.isPending;
  const path = view.run.path as number[];
  const recommendedPath = view.recommendation.path;
  const nextRecommendedNode = recommendedPath.length > 1 ? recommendedPath[1] : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
      <Card className="overflow-hidden">
        <CardContent className="aspect-square p-2 sm:p-4">
          <RouteMap
            coords={view.coords}
            effectiveRewards={view.recommendation.effectiveRewards}
            path={path}
            feasibleNodes={view.done ? [] : view.recommendation.feasibleNodes}
            recommendedPath={view.done ? [] : recommendedPath}
            currentNode={view.run.currentNode}
            interactive={!view.done && !busy}
            onSelectNode={(node) => stepMutation.mutate(node)}
          />
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {view.done ? "Route complete" : "Live routing"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Stat icon={MapPin} label="Current node" value={`N${view.run.currentNode}`} />
            <Stat icon={Timer} label="Elapsed time" value={`${view.run.currentTime.toFixed(2)} h / ${view.maxTime}h`} />
            <Stat icon={Trophy} label="Reward so far" value={view.run.totalReward.toFixed(1)} />
            <Stat
              icon={Flag}
              label="Projected total (recommended)"
              value={`${view.recommendation.totalReward.toFixed(1)} @ t=${view.recommendation.finalTime.toFixed(2)}h`}
            />
          </CardContent>
        </Card>

        {!view.done && (
          <Card>
            <CardContent className="flex flex-col gap-2 pt-6">
              <Button
                className="gap-2"
                disabled={busy || nextRecommendedNode === undefined}
                onClick={() => nextRecommendedNode !== undefined && stepMutation.mutate(nextRecommendedNode)}
              >
                {stepMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Follow recommended{nextRecommendedNode !== undefined ? ` (N${nextRecommendedNode})` : ""}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => endMutation.mutate()}>
                {endMutation.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
                End route → depot
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recommended route</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {recommendedPath.map((node, i) => (
                <Badge key={i} variant={i === 0 ? "default" : "secondary"}>
                  N{node}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {view.done && (
          <Button variant="outline" className="w-full" render={<Link href="/history" />}>
            View run history
          </Button>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RouteMap } from "@/components/map/route-map";
import { apiClient } from "@/lib/api-client";
import { downloadRunCsv } from "@/lib/csv-export";

/** Lets the user scrub through a completed run's actual path step by step,
 * and export it as CSV. Fetches the event log lazily (only once expanded),
 * since it's not needed for the live session itself. */
export function RunReplay({
  runId,
  coords,
  rewards,
}: {
  runId: number;
  coords: [number, number][];
  rewards: number[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [step, setStep] = useState(0);

  const eventsQuery = useQuery({
    queryKey: ["run-events", runId],
    queryFn: () => apiClient.listEvents(runId),
    enabled: expanded,
  });

  if (!expanded) {
    return (
      <Button variant="outline" className="w-full gap-2" onClick={() => setExpanded(true)}>
        <PlayCircle className="size-4" />
        Replay route
      </Button>
    );
  }

  const events = eventsQuery.data?.events ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Replay</CardTitle>
        {events.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => downloadRunCsv(runId, events)}
          >
            <Download className="size-3.5" />
            Export CSV
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {eventsQuery.isLoading && <Skeleton className="h-64 w-full" />}

        {!eventsQuery.isLoading && events.length > 0 && (
          <>
            <div className="aspect-square">
              <RouteMap
                coords={coords}
                effectiveRewards={rewards}
                path={[0, ...events.slice(0, step + 1).map((e) => e.node)]}
                feasibleNodes={[]}
                recommendedPath={[]}
                currentNode={step === 0 ? 0 : events[step - 1]?.node ?? 0}
                interactive={false}
              />
            </div>
            <div className="space-y-2">
              <input
                type="range"
                min={0}
                max={events.length - 1}
                value={step}
                onChange={(e) => setStep(Number(e.target.value))}
                className="w-full"
                aria-label="Replay step"
              />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>
                  Step {step + 1} of {events.length}: N{events[step].node}
                </span>
                <span className="tabular-nums">
                  reward {events[step].cumulativeReward.toFixed(1)} @ t=
                  {events[step].currentTime.toFixed(2)}h
                </span>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RouteMap } from "@/components/map/route-map";
import type { ComparisonView as ComparisonViewData } from "@/lib/services/run.service";

export function ComparisonView({ data }: { data: ComparisonViewData }) {
  const { coords, rewards, greedy, beam, beamWidth } = data;
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

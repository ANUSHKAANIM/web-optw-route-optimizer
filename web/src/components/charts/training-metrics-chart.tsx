"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Skeleton } from "@/components/ui/skeleton";

interface EpochRow {
  epoch: number;
  averageReward: number;
  loss: number;
}

function parseCsv(text: string): EpochRow[] {
  const lines = text.trim().split("\n").slice(1);
  return lines.map((line) => {
    const [epoch, averageReward, loss] = line.split(",");
    return { epoch: Number(epoch), averageReward: Number(averageReward), loss: Number(loss) };
  });
}

export function TrainingMetricsChart() {
  const [rows, setRows] = useState<EpochRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/data/training_log.csv")
      .then((res) => {
        if (!res.ok) throw new Error("training_log.csv not found");
        return res.text();
      })
      .then((text) => setRows(parseCsv(text)))
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return <p className="text-sm text-destructive">Could not load training log: {error}</p>;
  }

  if (!rows) {
    return <Skeleton className="h-72 w-full" />;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ChartCard title="Average reward per epoch">
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="epoch" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="averageReward" stroke="var(--chart-1)" dot={false} strokeWidth={2} />
        </LineChart>
      </ChartCard>

      <ChartCard title="Training loss per epoch">
        <LineChart data={rows}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
          <XAxis dataKey="epoch" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip contentStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="loss" stroke="var(--chart-4)" dot={false} strokeWidth={2} />
        </LineChart>
      </ChartCard>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <h3 className="mb-3 text-sm font-medium text-muted-foreground">{title}</h3>
      <ResponsiveContainer width="100%" height={280}>
        {children}
      </ResponsiveContainer>
    </div>
  );
}

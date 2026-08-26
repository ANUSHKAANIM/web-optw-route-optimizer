"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowUpDown, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { apiClient } from "@/lib/api-client";
import type { ListRunsQuery } from "@/lib/dto/run.dto";
import type { Run } from "@/db/schema";

const SORT_COLUMNS: { value: ListRunsQuery["sortBy"]; label: string }[] = [
  { value: "createdAt", label: "Created" },
  { value: "totalReward", label: "Reward" },
  { value: "numNodes", label: "Nodes" },
];

export function RunsTable({ initial }: { initial: { items: Run[]; total: number; page: number; pageSize: number } }) {
  const [page, setPage] = useState(initial.page);
  const [sortBy, setSortBy] = useState<ListRunsQuery["sortBy"]>("createdAt");
  const [sortDir, setSortDir] = useState<ListRunsQuery["sortDir"]>("desc");
  const [status, setStatus] = useState<ListRunsQuery["status"] | "all">("all");

  const query = useQuery({
    queryKey: ["runs", { page, sortBy, sortDir, status }],
    queryFn: () =>
      apiClient.listRuns({
        page,
        pageSize: initial.pageSize,
        sortBy,
        sortDir,
        ...(status !== "all" ? { status } : {}),
      }),
    initialData: page === 1 && sortBy === "createdAt" && sortDir === "desc" && status === "all" ? initial : undefined,
    placeholderData: keepPreviousData,
  });

  const data = query.data ?? initial;
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  function toggleSort(column: ListRunsQuery["sortBy"]) {
    if (sortBy === column) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(column);
      setSortDir("desc");
    }
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={(v) => { setStatus(v as typeof status); setPage(1); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>

        <div className="flex gap-1">
          {SORT_COLUMNS.map((col) => (
            <Button
              key={col.value}
              variant={sortBy === col.value ? "secondary" : "ghost"}
              size="sm"
              className="gap-1"
              onClick={() => toggleSort(col.value)}
            >
              {col.label}
              <ArrowUpDown className="size-3" />
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Nodes</TableHead>
              <TableHead>Beam width</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Reward</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right">Open</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading &&
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))}

            {!query.isLoading && data.items.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No runs yet. Start one from the New Run page.
                </TableCell>
              </TableRow>
            )}

            {!query.isLoading &&
              data.items.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-mono text-xs">#{run.id}</TableCell>
                  <TableCell>
                    <Badge variant={run.status === "completed" ? "default" : "secondary"}>
                      {run.status === "completed" ? "Completed" : "In progress"}
                    </Badge>
                  </TableCell>
                  <TableCell>{run.numNodes}</TableCell>
                  <TableCell>{run.beamWidth}</TableCell>
                  <TableCell>{(run.path as number[]).length - 1} stops</TableCell>
                  <TableCell className="font-medium tabular-nums">{run.totalReward.toFixed(1)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      render={<Link href={`/runs/${run.id}`} aria-label={`Open run ${run.id}`} />}
                    >
                      <ExternalLink className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Page {data.page} of {totalPages} &middot; {data.total} runs
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

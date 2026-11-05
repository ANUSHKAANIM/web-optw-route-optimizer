import Link from "next/link";
import { getBenchmarkState } from "./state";
import { runComparison, runAllZonesComparison } from "./actions";
import type { ComparisonMethod } from "@/solver/method-comparison";

/**
 * Reward comparison across the three solve tiers -- greedy baseline,
 * neural (Pointer Network + beam search), and exact MILP (HiGHS, plus
 * real CPLEX when available) -- run on the literal same trimmed problem
 * (see actions.ts's trimmedGraph) so the numbers are a fair head-to-head,
 * not three different problem sizes. A benchmark/reporting page, not a
 * live operational one: nothing here feeds back into /rolling-horizon or
 * /idalia-preview's own routing.
 */

const SERIES_COLOR: Record<ComparisonMethod, string> = {
  greedy: "var(--series-1)",
  neural: "var(--series-2)",
  "exact-highs": "var(--series-3)",
  "exact-cplex": "var(--series-4)",
};

export default function BenchmarkPage() {
  const state = getBenchmarkState();
  const { results, scenarioLabel, candidateCount, error, source, includeCplex, allZones } = state;

  const maxReward = results ? Math.max(1, ...results.map((r) => r.totalReward)) : 1;
  const maxMeanReward = allZones.aggregate ? Math.max(1, ...allZones.aggregate.map((r) => r.meanReward)) : 1;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Solver reward comparison</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Runs greedy, neural, and exact MILP (HiGHS / CPLEX) on the identical routing problem and compares the
            total reward each one actually collected.
          </p>
        </div>
        <Link href="/rolling-horizon" className="shrink-0 rounded border px-3 py-1.5 text-sm hover:bg-accent">
          ← Back to demo
        </Link>
      </header>

      <form action={runComparison} className="mt-6 flex flex-wrap items-center gap-4 rounded border p-4 text-sm">
        <fieldset className="flex items-center gap-3">
          <label className="flex items-center gap-1.5">
            <input type="radio" name="source" value="demo" defaultChecked={source !== "idalia"} />
            Demo scenario
          </label>
          <label className="flex items-center gap-1.5">
            <input type="radio" name="source" value="idalia" defaultChecked={source === "idalia"} />
            Hurricane Idalia (real data)
          </label>
        </fieldset>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" name="includeCplex" defaultChecked={includeCplex} />
          Include real CPLEX (dev-machine only; reports &quot;Unavailable&quot; if not installed)
        </label>
        <button type="submit" className="rounded border px-4 py-1.5 font-medium hover:bg-accent">
          Run comparison →
        </button>
      </form>

      {error && (
        <p className="mt-6 rounded border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {!results && !error && (
        <p className="mt-10 text-center text-sm text-muted-foreground">
          No run yet. Exact MILP and CPLEX take a few seconds -- pick a scenario above and click Run.
        </p>
      )}

      {results && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-muted-foreground">
            {scenarioLabel} -- {candidateCount} candidate origins
          </h2>

          <div className="mt-4 space-y-3" role="img" aria-label="Total reward collected, by solve method">
            {results.map((r) => (
              <div key={r.method} className="flex items-center gap-3">
                <span className="w-56 shrink-0 text-right text-sm">{r.label}</span>
                <div className="flex-1 rounded bg-black/5 dark:bg-white/10">
                  <div
                    className="flex h-7 items-center justify-end rounded px-2 text-xs font-semibold text-white"
                    style={{
                      width: `${Math.max(4, (r.totalReward / maxReward) * 100)}%`,
                      backgroundColor: SERIES_COLOR[r.method],
                    }}
                  >
                    {r.totalReward.toFixed(1)}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <table className="mt-8 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-4">Method</th>
                <th className="py-2 pr-4">Total reward</th>
                <th className="py-2 pr-4">Demand served</th>
                <th className="py-2 pr-4">Stops</th>
                <th className="py-2 pr-4">Compute time</th>
                <th className="py-2 pr-4">Status</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.method} className="border-b border-border/60">
                  <td className="py-2 pr-4">
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                      style={{ backgroundColor: SERIES_COLOR[r.method] }}
                    />
                    {r.label}
                  </td>
                  <td className="py-2 pr-4">{r.totalReward.toFixed(2)}</td>
                  <td className="py-2 pr-4">{r.totalDemandServed.toLocaleString()}</td>
                  <td className="py-2 pr-4">{r.stopsVisited}</td>
                  <td className="py-2 pr-4">{r.computeTimeMs.toLocaleString()}ms</td>
                  <td className="py-2 pr-4 text-muted-foreground">{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="mt-4 text-xs text-muted-foreground">
            Exact MILP is a genuine upper bound on reward only when its status reports an optimal solve -- under a
            time limit it reports a sound but possibly non-optimal incumbent instead.
          </p>
        </section>
      )}

      <section className="mt-14 border-t pt-8">
        <h2 className="text-xl font-bold tracking-tight">Run across every shelter zone</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Runs the same comparison independently in every real Hurricane Idalia shelter zone (each capped to its own
          top 16 tracts by reward, same fairness rule as above) and reports aggregate stats across all of them --
          not just one zone. This runs {"~75"} solves per method sequentially and can take a few minutes.
        </p>

        <form action={runAllZonesComparison} className="mt-4 flex flex-wrap items-center gap-4 rounded border p-4 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name="includeCplex" defaultChecked={allZones.includeCplex} />
            Include real CPLEX (adds a subprocess solve per zone -- much slower)
          </label>
          <button type="submit" className="rounded border px-4 py-1.5 font-medium hover:bg-accent">
            Run all zones →
          </button>
        </form>

        {allZones.error && (
          <p className="mt-6 rounded border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {allZones.error}
          </p>
        )}

        {!allZones.aggregate && !allZones.error && (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            No batch run yet -- this is separate from the single-zone comparison above.
          </p>
        )}

        {allZones.aggregate && (
          <div className="mt-8">
            <h3 className="text-sm font-semibold text-muted-foreground">
              {allZones.zoneCount} shelter zones -- total runtime {((allZones.totalRuntimeMs ?? 0) / 1000).toFixed(1)}s
            </h3>

            <div className="mt-4 space-y-3" role="img" aria-label="Mean reward per zone, by solve method">
              {allZones.aggregate.map((a) => (
                <div key={a.method} className="flex items-center gap-3">
                  <span className="w-56 shrink-0 text-right text-sm">{a.label}</span>
                  <div className="flex-1 rounded bg-black/5 dark:bg-white/10">
                    <div
                      className="flex h-7 items-center justify-end rounded px-2 text-xs font-semibold text-white"
                      style={{
                        width: `${Math.max(4, (a.meanReward / maxMeanReward) * 100)}%`,
                        backgroundColor: SERIES_COLOR[a.method],
                      }}
                    >
                      {a.meanReward.toFixed(1)}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <table className="mt-8 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-4">Method</th>
                  <th className="py-2 pr-4">Zones run</th>
                  <th className="py-2 pr-4">Mean reward</th>
                  <th className="py-2 pr-4">Total reward</th>
                  <th className="py-2 pr-4">Mean compute time</th>
                  <th className="py-2 pr-4">Optimal zones</th>
                  <th className="py-2 pr-4">Mean gap vs exact</th>
                </tr>
              </thead>
              <tbody>
                {allZones.aggregate.map((a) => (
                  <tr key={a.method} className="border-b border-border/60">
                    <td className="py-2 pr-4">
                      <span
                        className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle"
                        style={{ backgroundColor: SERIES_COLOR[a.method] }}
                      />
                      {a.label}
                    </td>
                    <td className="py-2 pr-4">{a.zonesRun}</td>
                    <td className="py-2 pr-4">{a.meanReward.toFixed(2)}</td>
                    <td className="py-2 pr-4">{a.totalReward.toFixed(2)}</td>
                    <td className="py-2 pr-4">{a.meanComputeTimeMs.toFixed(0)}ms</td>
                    <td className="py-2 pr-4">{a.optimalCount !== undefined ? `${a.optimalCount}/${a.zonesRun}` : "--"}</td>
                    <td className="py-2 pr-4">{a.meanGapVsExactPct !== undefined ? `${a.meanGapVsExactPct.toFixed(1)}%` : "--"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3 className="mt-10 text-sm font-semibold text-muted-foreground">Per-zone breakdown</h3>
            <div className="mt-3 max-h-96 overflow-y-auto rounded border">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 bg-background">
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pl-3 pr-4">Shelter</th>
                    <th className="py-2 pr-4">Tracts in zone</th>
                    <th className="py-2 pr-4">Candidates used</th>
                    {allZones.zones![0]?.results.map((r) => (
                      <th key={r.method} className="py-2 pr-4">
                        {r.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {allZones.zones!.map((z) => (
                    <tr key={z.shelterId} className="border-b border-border/60">
                      <td className="py-1.5 pl-3 pr-4 text-xs text-muted-foreground">{z.shelterId}</td>
                      <td className="py-1.5 pr-4">{z.originCount}</td>
                      <td className="py-1.5 pr-4">{z.candidateCount}</td>
                      {z.results.map((r) => (
                        <td key={r.method} className="py-1.5 pr-4">
                          {r.totalReward.toFixed(1)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              &quot;Mean gap vs exact&quot; is averaged only over zones where exact-HiGHS itself reached a proven
              optimal solution -- a time-limited exact incumbent isn&apos;t a trustworthy upper bound to measure
              against.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

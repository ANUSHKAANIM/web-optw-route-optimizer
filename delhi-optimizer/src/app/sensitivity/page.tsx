import Link from "next/link";
import { SENSITIVITY_RESULTS, type SensitivityRow } from "./results";

export const metadata = { title: "Sensitivity test" };

function fmtP(h: number): string {
  return h < 1 ? `${h * 60} min` : `${h} h`;
}

function Table({ rows, vary, title }: { rows: SensitivityRow[]; vary: "p" | "H"; title: string }) {
  const bestWait = Math.min(...rows.map((r) => r.avgWaitH));
  const bestReassign = Math.min(...rows.map((r) => r.reassignments));
  const current = (r: SensitivityRow) => r.p === 6 && r.H === 8;
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full min-w-[520px] text-sm">
        <caption className="px-4 pt-3 text-left text-sm font-semibold text-slate-100">{title}</caption>
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <th className="px-4 py-2 font-medium">{vary === "p" ? "Replan every" : "Look-ahead"}</th>
            <th className="px-4 py-2 text-right font-medium">Replans</th>
            <th className="px-4 py-2 text-right font-medium">Avg wait</th>
            <th className="px-4 py-2 text-right font-medium">Worst wait</th>
            <th className="px-4 py-2 text-right font-medium">Reassignments</th>
            <th className="px-4 py-2 text-right font-medium">Solve time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.p}-${r.H}`} className={`border-t border-white/5 tabular-nums ${current(r) ? "bg-sky-500/10" : ""}`}>
              <td className="px-4 py-2 text-slate-100">
                {vary === "p" ? fmtP(r.p) : `${r.H} h`}
                {current(r) && <span className="ml-2 rounded bg-sky-500/20 px-1.5 py-0.5 text-[11px] text-sky-200">current</span>}
              </td>
              <td className="px-4 py-2 text-right">{Math.round(r.replans)}</td>
              <td className={`px-4 py-2 text-right ${r.avgWaitH === bestWait ? "font-semibold text-emerald-300" : ""}`}>{r.avgWaitH.toFixed(2)} h</td>
              <td className="px-4 py-2 text-right">{r.maxWaitH.toFixed(1)} h</td>
              <td className={`px-4 py-2 text-right ${r.reassignments === bestReassign ? "font-semibold text-emerald-300" : ""}`}>{r.reassignments.toFixed(1)}</td>
              <td className="px-4 py-2 text-right">{r.avgSolveMs} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SensitivityPage() {
  const byVans = (v: number) => SENSITIVITY_RESULTS.filter((r) => r.vans === v);
  const intervals = (v: number) => byVans(v).filter((r) => r.H === 8).sort((a, b) => a.p - b.p);
  const horizons = (v: number) => byVans(v).filter((r) => r.p === 6).sort((a, b) => a.H - b.H);

  return (
    <div className="min-h-screen bg-[#080b10] px-4 py-8 text-slate-300 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-sky-400">Evaluate · step 3 of the tour</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-50">Sensitivity test</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">
          How often should the vans be replanned (interval <i>p</i>), and how far ahead should each plan look (horizon <i>H</i>)?
          Each setting was run on the same 5 storms with the neural solver and the control room&apos;s own planner, and scored
          against one shared 30-minute timeline of the storm. Means across the 5 storms.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { k: "Avg wait", v: "Hours from a village first being threatened to a van picking it up. Lower is better." },
            { k: "Reassignments", v: "How often a planned village was moved to another van or dropped. Lower means steadier plans." },
            { k: "People sheltered", v: "100% and zero missed deadlines in every setting, so wait and stability are what differ." },
          ].map((m) => (
            <div key={m.k} className="rounded-lg border border-white/10 p-3">
              <div className="text-sm font-semibold text-slate-100">{m.k}</div>
              <p className="mt-1 text-xs text-slate-400">{m.v}</p>
            </div>
          ))}
        </div>

        <h2 className="mt-10 text-lg font-semibold text-slate-100">1 · Replanning interval (horizon fixed at 8 h)</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <Table rows={intervals(4)} vary="p" title="4 vans" />
          <Table rows={intervals(2)} vary="p" title="2 vans (vans scarce)" />
        </div>

        <h2 className="mt-10 text-lg font-semibold text-slate-100">2 · Look-ahead horizon (replanning fixed at 6 h)</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <Table rows={horizons(4)} vary="H" title="4 vans" />
          <Table rows={horizons(2)} vary="H" title="2 vans (vans scarce)" />
        </div>

        <section className="mt-10 rounded-xl border border-sky-400/30 bg-sky-500/5 p-5">
          <h2 className="text-base font-semibold text-slate-100">What it shows</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm">
            <li>
              <b className="text-slate-100">Replanning more often makes things worse.</b> At 30 min villages wait about 45–50% longer
              than at 6 h, and reassignments jump from under 1 to over 100: vans keep switching targets mid-trip.
            </li>
            <li>
              <b className="text-slate-100">3–6 h is the sweet spot.</b> 6 h is best with 4 vans; 3 h is only marginally better with
              2 vans but far less stable.
            </li>
            <li>
              <b className="text-slate-100">The horizon matters only when vans are scarce.</b> With 2 vans, looking 12 h ahead cuts the
              average wait by about 11%.
            </li>
            <li>
              <b className="text-slate-100">Solve time is never the limit</b> — tens of milliseconds per replan.
            </li>
            <li className="text-slate-400">
              Limits: synthetic data, 5 storms per setting, and no commit window. Freezing near-term decisions (as in rolling-horizon
              rail rescheduling) would likely make short intervals competitive.
            </li>
          </ul>
        </section>

        <div className="mt-8 flex flex-wrap gap-2">
          <Link href="/control-room" className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400">
            Next: watch it live →
          </Link>
          <Link href="/benchmark" className="rounded-md border border-white/15 px-4 py-2 text-sm text-slate-100 hover:bg-white/5">
            Solver benchmark
          </Link>
        </div>
      </div>
    </div>
  );
}

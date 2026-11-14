import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { LineChart, movingAverage } from "@/components/app-shell/line-chart";

export const metadata = { title: "Model training" };

interface Row {
  epoch: number;
  reward: number;
  loss: number;
}

function readLog(): Row[] {
  const text = fs.readFileSync(path.join(process.cwd(), "data", "training_log.csv"), "utf8");
  return text
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const [epoch, reward, loss] = line.split(",").map(Number);
      return { epoch, reward, loss };
    });
}

export default function TrainingPage() {
  const rows = readLog();
  const reward = rows.map((r) => ({ x: r.epoch, y: r.reward }));
  const loss = rows.map((r) => ({ x: r.epoch, y: r.loss }));
  const first10 = rows.slice(0, 10).reduce((a, r) => a + r.reward, 0) / Math.min(10, rows.length);
  const last10 = rows.slice(-10).reduce((a, r) => a + r.reward, 0) / Math.min(10, rows.length);
  const best = Math.max(...rows.map((r) => r.reward));
  const lastEpoch = rows[rows.length - 1].epoch;

  const stats = [
    { label: "Epochs", value: (lastEpoch + 10).toLocaleString() },
    { label: "Avg reward, first 100 epochs", value: first10.toFixed(1) },
    { label: "Avg reward, last 100 epochs", value: last10.toFixed(1) },
    { label: "Improvement", value: `${(((last10 - first10) / first10) * 100).toFixed(0)}%` },
    { label: "Best logged reward", value: best.toFixed(1) },
  ];

  return (
    <div className="min-h-screen bg-[#080b10] px-4 py-8 text-slate-300 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-sky-400">Evaluate · step 2 of the tour</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-50">Model training</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-400">
          The Pointer Network was trained with REINFORCE: it builds a route village by village, and routes that collect more
          reward than the baseline are made more likely. Logged every 10 epochs from <code className="rounded bg-white/5 px-1">training_log.csv</code>.
        </p>

        <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="rounded-lg border border-white/10 p-3">
              <dt className="text-xs text-slate-500">{s.label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums text-slate-100">{s.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-white/10 p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-100">Average reward per epoch</h2>
            <LineChart
              xLabel="Epoch"
              yLabel="Average reward"
              series={[
                { label: "Logged", color: "#5ec8ff", points: reward, faint: true },
                { label: "10-point moving average", color: "#5ec8ff", points: movingAverage(reward, 10) },
              ]}
            />
          </section>
          <section className="rounded-xl border border-white/10 p-4">
            <h2 className="mb-2 text-sm font-semibold text-slate-100">Policy-gradient loss</h2>
            <LineChart
              xLabel="Epoch"
              yLabel="Loss"
              series={[
                { label: "Logged", color: "#ffd166", points: loss, faint: true },
                { label: "10-point moving average", color: "#ffd166", points: movingAverage(loss, 10) },
              ]}
            />
          </section>
        </div>

        <p className="mt-4 text-xs text-slate-500">
          REINFORCE rewards are noisy from batch to batch, so the moving average is the trend to read. Earlier training runs
          and comparisons are in the{" "}
          <a href="https://web-mu-two-jcjd89kwmw.vercel.app" target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">
            training runs archive ↗
          </a>
          .
        </p>

        <div className="mt-8 flex flex-wrap gap-2">
          <Link href="/benchmark" className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400">
            Next: how it compares →
          </Link>
          <Link href="/" className="rounded-md border border-white/15 px-4 py-2 text-sm text-slate-100 hover:bg-white/5">
            Back to the tour
          </Link>
        </div>
      </div>
    </div>
  );
}

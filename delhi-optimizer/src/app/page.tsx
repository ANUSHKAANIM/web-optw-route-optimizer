import Link from "next/link";
import { hasDatabase } from "@/lib/has-database";
import { isLowMemoryDeploy } from "@/lib/deploy-limits";

export const metadata = { title: "Guided tour" };

const STEPS = [
  {
    n: 1,
    title: "The problem",
    body: (
      <>
        A cyclone is coming. Evacuation vans must pick up people from villages and bring them to shelters before each
        village&apos;s deadline. Every village has a <b className="text-slate-100">reward</b> = population × urgency × forecast
        multiplier, and vans have limited seats, time and shelter space. Choosing which villages to visit, and in
        what order, to collect the most reward is the <b className="text-slate-100">Orienteering Problem with Time Windows (OPTW)</b>.
      </>
    ),
    links: [] as { href: string; label: string }[],
  },
  {
    n: 2,
    title: "How the model was trained",
    body: (
      <>
        A Pointer Network learns to build routes one village at a time and is trained with REINFORCE: routes that
        collect more reward are reinforced. The curves show average reward rising and loss settling as training
        goes on.
      </>
    ),
    links: [{ href: "/training", label: "Model training" }],
  },
  {
    n: 3,
    title: "How it compares",
    body: (
      <>
        The same routing problem is solved three ways: a fast greedy rule, the trained neural model, and an exact
        MILP solver as the gold standard. The sensitivity test then checks how often the plan should be recomputed
        and how far ahead it should look.
      </>
    ),
    links: [
      { href: "/benchmark", label: "Solver benchmark" },
      { href: "/sensitivity", label: "Sensitivity test" },
    ],
  },
  {
    n: 4,
    title: "Watch it live",
    body: (
      <>
        The control room runs the trained model inside a <b className="text-slate-100">rolling horizon</b>: every new
        forecast (6 h of storm time) each van is replanned 8 h ahead from exactly where it is. Click the countdown to
        pull the next forecast, or issue a special advisory to replan at once.
      </>
    ),
    links: [
      { href: "/control-room", label: "Open the control room" },
      { href: "/rolling-horizon", label: "Region-wide rolling horizon" },
    ],
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#080b10] px-4 py-8 text-slate-300 sm:px-8 md:py-12">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-wider text-sky-400">Guided tour</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">Cyclone Evacuation Planner</h1>
        <p className="mt-3 max-w-2xl text-base text-slate-400">
          Reinforcement learning for routing evacuation vans under a changing cyclone forecast. Follow the four steps
          in order, or jump straight to the live demo.
        </p>
        <Link
          href="/control-room"
          className="mt-6 inline-flex items-center rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400"
        >
          Jump to the live control room →
        </Link>

        <ol className="mt-10 flex flex-col gap-4">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
              <div className="flex items-baseline gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sm font-semibold text-sky-300">
                  {s.n}
                </span>
                <h2 className="text-lg font-semibold text-slate-100">{s.title}</h2>
              </div>
              <p className="mt-2 pl-10 text-sm leading-relaxed">{s.body}</p>
              {s.links.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2 pl-10">
                  {s.links.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      className="rounded-md border border-white/15 px-3 py-1.5 text-sm text-slate-100 hover:border-sky-400/60 hover:bg-sky-500/10"
                    >
                      {l.label} →
                    </Link>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ol>

        <section className="mt-10 rounded-xl border border-white/10 p-5">
          <h2 className="text-base font-semibold text-slate-100">More to explore</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {!isLowMemoryDeploy() && (
            <li>
              <Link href="/idalia-preview" className="text-sky-300 hover:underline">Hurricane Idalia</Link> — the planner on real
              census-tract data.
            </li>
            )}
            <li>
              <Link href="/scale-preview" className="text-sky-300 hover:underline">Large region</Link> — thousands of villages at
              once.
            </li>
            <li>
              <Link href="/dashboard" className="text-sky-300 hover:underline">Region dashboard</Link> — every cell, shelter and
              route.
            </li>
            {hasDatabase() && (
              <li>
                <Link href="/play" className="text-sky-300 hover:underline">Multiplayer game</Link> — route the vans yourself.
              </li>
            )}
          </ul>
        </section>
      </div>
    </div>
  );
}

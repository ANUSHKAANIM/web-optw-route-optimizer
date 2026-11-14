"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { NAV_SECTIONS } from "./nav";
import { setAppSolver } from "@/app/solver-actions";

type Tier = "fast" | "real";

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar({ solverTier, hasDatabase, lowMemory }: { solverTier: Tier; hasDatabase: boolean; lowMemory: boolean }) {
  const pathname = usePathname();
  // The menu is open only for the page it was opened on, so it closes by
  // itself on navigation.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const [pending, startTransition] = useTransition();


  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {NAV_SECTIONS.filter((s) => hasDatabase || s.title !== "Play").map((section) => (
        <div key={section.title}>
          <div className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{section.title}</div>
          <ul className="flex flex-col gap-0.5">
            {section.items.filter((item) => !(lowMemory && item.heavy)).map((item) => {
              const active = !item.external && isActive(pathname, item.href);
              const cls = `block rounded-md px-2 py-1.5 text-sm transition-colors ${
                active ? "bg-sky-500/15 text-sky-200" : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`;
              const body = (
                <>
                  <span className="block font-medium">
                    {item.label}
                    {item.external && <span aria-hidden className="ml-1 text-slate-500">↗</span>}
                  </span>
                  <span className="block text-xs text-slate-500">{item.hint}</span>
                </>
              );
              return (
                <li key={item.href}>
                  {item.external ? (
                    <a href={item.href} target="_blank" rel="noreferrer" className={cls}>
                      {body}
                    </a>
                  ) : (
                    <Link href={item.href} className={cls} aria-current={active ? "page" : undefined}>
                      {body}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const solver = (
    <div className="rounded-lg border border-white/10 p-2.5">
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Solver (all live pages)</div>
      <div className="grid grid-cols-2 gap-1" role="group" aria-label="Solver">
        {(["fast", "real"] as const).map((tier) => (
          <button
            key={tier}
            type="button"
            disabled={pending}
            aria-pressed={solverTier === tier}
            onClick={() => startTransition(() => setAppSolver(tier))}
            className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
              solverTier === tier ? "bg-sky-500/20 text-sky-100 ring-1 ring-sky-400/40" : "text-slate-300 hover:bg-white/5"
            }`}
          >
            {tier === "fast" ? "Fast (greedy)" : "Neural"}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/10 bg-[#080b10]/95 px-4 py-3 text-slate-100 backdrop-blur md:hidden">
        <Link href="/" className="text-sm font-semibold">
          Cyclone Evacuation Planner
        </Link>
        <button
          type="button"
          onClick={() => setOpenOn(open ? null : pathname)}
          aria-expanded={open}
          aria-controls="mobile-nav"
          className="rounded-md border border-white/15 px-2.5 py-1 text-sm"
        >
          {open ? "Close" : "Menu"}
        </button>
      </header>
      {open && (
        <div id="mobile-nav" className="fixed inset-x-0 top-[53px] bottom-0 z-40 overflow-y-auto bg-[#080b10] px-4 py-4 text-slate-100 md:hidden">
          <div className="flex flex-col gap-5">
            {nav}
            {solver}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-5 overflow-y-auto border-r border-white/10 bg-[#080b10] px-3 py-5 text-slate-100 md:flex">
        <Link href="/" className="px-2">
          <span className="block text-sm font-semibold">Cyclone Evacuation Planner</span>
          <span className="block text-xs text-slate-500">RL routing for evacuation vans</span>
        </Link>
        {nav}
        <div className="mt-auto">{solver}</div>
      </aside>
    </>
  );
}

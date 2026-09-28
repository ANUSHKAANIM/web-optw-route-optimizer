"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, History, LineChart, MapPinned, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const NAV_ITEMS = [
  { href: "/", label: "New Run", icon: LayoutDashboard },
  { href: "/play", label: "Multiplayer", icon: MapPinned },
  { href: "/history", label: "History", icon: History },
  { href: "/training", label: "Training", icon: LineChart },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 flex flex-col border-b border-sidebar-border/60 bg-sidebar/95 text-sidebar-foreground backdrop-blur-sm md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
            <Route className="size-3.5" aria-hidden />
          </span>
          <span className="font-heading font-semibold tracking-tight">OPTW Optimizer</span>
        </div>
        <div className="w-28">
          <ThemeToggle />
        </div>
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-2" aria-label="Primary">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-200 active:scale-95",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/65",
              )}
            >
              <Icon className={cn("size-4", active && "text-primary")} aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

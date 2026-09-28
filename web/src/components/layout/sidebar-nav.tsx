"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, History, LineChart, MapPinned, Route } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/theme-toggle";

const NAV_ITEMS = [
  { href: "/", label: "New Run", icon: LayoutDashboard },
  { href: "/play", label: "Delhi Multiplayer", icon: MapPinned },
  { href: "/history", label: "Run History", icon: History },
  { href: "/training", label: "Training Metrics", icon: LineChart },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <aside className="hidden md:sticky md:top-0 md:flex md:h-screen md:w-64 md:flex-col md:border-r md:border-sidebar-border/60 md:bg-sidebar/95 md:text-sidebar-foreground md:backdrop-blur-sm">
      <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border/60 px-6">
        <span className="flex size-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary/60 text-primary-foreground shadow-sm shadow-primary/30">
          <Route className="size-4" aria-hidden />
        </span>
        <span className="font-heading font-semibold tracking-tight">OPTW Optimizer</span>
      </div>
      <nav className="flex-1 space-y-1 p-3" aria-label="Primary">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200",
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-sidebar-foreground/65 hover:translate-x-0.5 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <span
                className={cn(
                  "absolute left-0 h-4 w-0.5 rounded-full bg-primary transition-opacity duration-200",
                  active ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
              <Icon
                className={cn(
                  "size-4 transition-colors",
                  active ? "text-primary" : "text-sidebar-foreground/50 group-hover:text-sidebar-accent-foreground",
                )}
                aria-hidden
              />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-sidebar-border/60 p-3">
        <ThemeToggle />
      </div>
    </aside>
  );
}

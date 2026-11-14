import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/app-shell/sidebar";
import { getAppSolverTier } from "@/lib/solver-preference";
import { hasDatabase } from "@/lib/has-database";
import { isLowMemoryDeploy } from "@/lib/deploy-limits";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Cyclone Evacuation Planner", template: "%s · Cyclone Evacuation Planner" },
  description: "Reinforcement-learning route planning for cyclone evacuation vans, with live rolling-horizon replanning.",
};

// The sidebar shows the live, app-wide solver choice.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col md:flex-row">
        <Sidebar solverTier={getAppSolverTier()} hasDatabase={hasDatabase()} lowMemory={isLowMemoryDeploy()} />
        <main className="min-w-0 flex-1">{children}</main>
      </body>
    </html>
  );
}

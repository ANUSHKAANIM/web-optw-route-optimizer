export interface NavItem {
  href: string;
  label: string;
  hint: string;
  external?: boolean;
  /** Hidden on low-memory deployments (see lib/deploy-limits.ts). */
  heavy?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** Public URL of the separate training-history web app (runs + sessions
 * live in its own database, so it stays its own deployment). */
export const TRAINING_RUNS_URL = "https://web-mu-two-jcjd89kwmw.vercel.app";

export const NAV_SECTIONS: NavSection[] = [
  {
    title: "Overview",
    items: [{ href: "/", label: "Guided tour", hint: "The problem and how to read this app" }],
  },
  {
    title: "Operate",
    items: [
      { href: "/control-room", label: "Control room", hint: "Live cyclone evacuation, 4 vans" },
      { href: "/rolling-horizon", label: "Rolling horizon", hint: "Region-wide replanning every forecast" },
    ],
  },
  {
    title: "Evaluate",
    items: [
      { href: "/training", label: "Model training", hint: "REINFORCE reward and loss curves" },
      { href: "/benchmark", label: "Solver benchmark", hint: "Greedy vs neural vs exact MILP" },
      { href: "/sensitivity", label: "Sensitivity test", hint: "Replan interval and horizon" },
      { href: "/dashboard", label: "Region dashboard", hint: "Every cell, shelter and route" },
      { href: TRAINING_RUNS_URL, label: "Training runs (archive)", hint: "Run history in the training web app", external: true },
    ],
  },
  {
    title: "Scenarios",
    items: [
      { href: "/idalia-preview", label: "Hurricane Idalia", hint: "Real census-tract data", heavy: true },
      { href: "/scale-preview", label: "Large region", hint: "Thousands of villages at once" },
    ],
  },
  {
    title: "Play",
    items: [{ href: "/play", label: "Multiplayer game", hint: "Route the vans yourself" }],
  },
];

"use server";

import { revalidatePath } from "next/cache";
import { setAppSolverTier, type AppSolverTier } from "@/lib/solver-preference";

/** The sidebar's solver switch: applies to every live page at once. */
export async function setAppSolver(tier: AppSolverTier): Promise<void> {
  setAppSolverTier(tier);
  revalidatePath("/", "layout");
}

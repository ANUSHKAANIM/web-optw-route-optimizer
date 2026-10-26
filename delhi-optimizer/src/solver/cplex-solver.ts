import { spawn } from "node:child_process";
import { writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Genuine, fully licensed IBM CPLEX backend -- NOT a relabeled substitute,
 * and NOT the free, size-capped Community Edition. Node has no direct
 * binding to CPLEX, so this spawns a Python process (the same `rl_env`
 * the RL training pipeline uses, though cplex_bridge.py itself only needs
 * the standard library) to run cplex_bridge.py, which shells out AGAIN to
 * the native `cplex.exe` binary and parses the XML solution file it
 * writes. This mirrors the existing Python<->TypeScript bridge pattern
 * already used for the RL model (model/export_to_onnx.py), just for a
 * live per-request solve instead of an offline export.
 *
 * Why not just `pip install cplex` and call its Python API directly, the
 * obvious first approach? Because that package bundles its OWN separate
 * engine, hard-capped at the free Community Edition's 1,000-variable/
 * 1,000-constraint limit, completely independent of a full Studio license
 * installed elsewhere on the machine -- confirmed by testing both against
 * an identical 1,500-variable problem: the pip package raised "CPLEX
 * Error 1016: Community Edition," the native binary solved it in 0.2s
 * with 16-thread parallel branch-and-cut. The native binary is what
 * actually carries this machine's full license, so cplex_bridge.py calls
 * that directly instead.
 *
 * Dev-machine only: this requires the native `cplex.exe` binary and a
 * Python runtime to exist on whatever machine runs the Next.js server. It
 * is NOT available in a typical production deployment (e.g. Vercel has
 * neither) -- callers must treat `unavailable` as an expected, not
 * exceptional, outcome and fall back to the HiGHS backend.
 */

export interface LpSolveResult {
  /** True only when CPLEX (or the bridge itself) could not run at all --
   * e.g. no local Python/CPLEX install on this machine. Distinct from a
   * normal solver outcome like infeasible or time-limited. */
  unavailable?: string;
  status: string;
  objectiveValue?: number;
  columns: Record<string, number>;
  mipGap?: number;
}

export interface LpSolveOptions {
  timeLimitSeconds: number;
  mipGap: number;
}

const BRIDGE_SCRIPT_PATH = path.join(process.cwd(), "src", "solver", "cplex_bridge.py");
// The repo root's Python environment the RL pipeline already uses --
// `delhi-optimizer` is one level under it.
const PYTHON_PATH = path.join(process.cwd(), "..", "rl_env", "Scripts", "python.exe");

export async function solveWithCplex(lpText: string, options: LpSolveOptions): Promise<LpSolveResult> {
  let tmpDir: string | undefined;
  try {
    tmpDir = await mkdtemp(path.join(tmpdir(), "delhi-optimizer-cplex-"));
    const lpPath = path.join(tmpDir, "model.lp");
    await writeFile(lpPath, lpText, "utf8");

    const stdout = await runPython(PYTHON_PATH, [BRIDGE_SCRIPT_PATH, lpPath, String(options.timeLimitSeconds), String(options.mipGap)]);

    const parsed = JSON.parse(stdout) as
      | { error: string }
      | { status: string; statusCode: number; objectiveValue?: number; mipGap?: number | null; columns: Record<string, number> };

    if ("error" in parsed) {
      return { unavailable: parsed.error, status: "Unavailable", columns: {} };
    }
    return {
      status: parsed.status,
      objectiveValue: parsed.objectiveValue,
      mipGap: parsed.mipGap ?? undefined,
      columns: parsed.columns,
    };
  } catch (err) {
    return {
      unavailable: err instanceof Error ? err.message : String(err),
      status: "Unavailable",
      columns: {},
    };
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

function runPython(pythonPath: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`cplex_bridge.py exited with code ${code}: ${stderr || stdout}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

"""Standalone bridge: reads an LP-format file, solves it with the locally
installed, FULLY LICENSED IBM CPLEX engine, and prints a JSON result to
stdout. Invoked as a subprocess from cplex-solver.ts -- the Node/Next.js
app has no direct way to call CPLEX, so this is the same kind of
Python<->TypeScript bridge model/export_to_onnx.py already uses for the RL
model, just for a live per-request solve instead of an offline export.

Usage:
    python cplex_bridge.py <lp_file_path> [time_limit_seconds] [mip_gap]

IMPORTANT: this shells out to the native `cplex.exe` CLI, NOT the `cplex`
pip package's Python API. That distinction is deliberate and load-bearing:
`pip install cplex` bundles its OWN separate engine capped at the free
Community Edition's 1,000-variable/1,000-constraint limit, completely
independent of whatever full Studio license is installed separately on
this machine -- confirmed empirically (the pip package rejected a
1,500-variable problem with "CPLEX Error 1016: Community Edition", while
the native cplex.exe solved the identical problem with 16-thread parallel
branch-and-cut in 0.2s, no restriction). The native binary is what
actually carries this machine's full license, so that's what gets called.

Never silently substitutes another solver -- if the binary can't be
found, can't run, or the problem is genuinely infeasible, this prints an
explicit JSON error/status object rather than pretending to have solved
anything.
"""
import glob
import json
import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET


def find_cplex_binary():
    """Locates the native cplex.exe via the CPLEX_STUDIO_BINARIES* env var
    the Studio installer sets, falling back to a filesystem search under
    common install roots. Never hardcodes one user's absolute path."""
    for key, value in os.environ.items():
        if key.startswith("CPLEX_STUDIO_BINARIES"):
            for binaries_dir in value.split(os.pathsep):
                candidate = os.path.join(binaries_dir, "cplex.exe")
                if os.path.isfile(candidate):
                    return candidate

    for root in [os.path.expanduser("~/Desktop"), "C:/Program Files", "C:/Program Files (x86)"]:
        matches = glob.glob(os.path.join(root, "**", "cplex.exe"), recursive=True)
        if matches:
            return matches[0]

    return None


def main():
    lp_path = sys.argv[1]
    time_limit = sys.argv[2] if len(sys.argv) > 2 else "10"
    mip_gap = sys.argv[3] if len(sys.argv) > 3 else "0.01"

    cplex_exe = find_cplex_binary()
    if not cplex_exe:
        print(json.dumps({"error": "cplex.exe not found (checked CPLEX_STUDIO_BINARIES* env vars and common install roots)"}))
        return

    sol_fd, sol_path = tempfile.mkstemp(suffix=".sol")
    os.close(sol_fd)
    os.remove(sol_path)  # CPLEX creates it fresh; a pre-existing empty file can confuse `write`

    commands = [
        f"read {lp_path}",
        f"set timelimit {time_limit}",
        f"set mip tolerances mipgap {mip_gap}",
        "optimize",
        f"write {sol_path}",
        "quit",
    ]
    args = [cplex_exe, "-c"] + commands

    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=float(time_limit) + 30)
    except subprocess.TimeoutExpired:
        print(json.dumps({"error": "cplex.exe did not return within the expected time"}))
        return

    stdout = result.stdout

    if not os.path.exists(sol_path):
        # No incumbent to write -- infeasible, or a real solve error. The
        # CLI's own text output says which; surface it rather than guessing.
        lower = stdout.lower()
        if "infeasible" in lower:
            print(json.dumps({"status": "infeasible", "columns": {}}))
        else:
            print(json.dumps({"error": f"CPLEX produced no solution. Output: {stdout[-2000:]}"}))
        return

    try:
        tree = ET.parse(sol_path)
    finally:
        try:
            os.remove(sol_path)
        except OSError:
            pass

    header = tree.getroot().find("header")
    status_string = header.get("solutionStatusString")
    objective_value = float(header.get("objectiveValue"))
    mip_gap_attr = header.get("MIPGap")
    mip_gap_achieved = float(mip_gap_attr) if mip_gap_attr is not None else None

    columns = {}
    variables_el = tree.getroot().find("variables")
    if variables_el is not None:
        for var in variables_el:
            columns[var.get("name")] = float(var.get("value"))

    print(
        json.dumps(
            {
                "status": status_string,
                "objectiveValue": objective_value,
                "mipGap": mip_gap_achieved,
                "columns": columns,
            }
        )
    )


if __name__ == "__main__":
    main()

import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node ships a native (.node) addon, and @electric-sql/pglite
  // (dev-only local database fallback, see src/db/client.ts) resolves its
  // WASM/data assets relative to import.meta.url -- both break if
  // webpack/turbopack bundles them, so both must be required at runtime
  // unbundled instead.
  serverExternalPackages: ["onnxruntime-node", "@electric-sql/pglite"],
  // onnxruntime-node loads its native .node/.so binaries dynamically at
  // runtime (based on process.platform/arch), so Next's static file tracer
  // can't discover them on its own -- every route that transitively imports
  // the inference service (directly, or via run.service -> optimizer.service)
  // needs them explicitly included, or the deployed function 500s with
  // "cannot open shared object file".
  outputFileTracingIncludes: {
    // onnxruntime-node is lazy-imported (see inference.service.ts) so only
    // routes that actually run inference ever touch it -- GET-only routes
    // like /history or /runs/[id] never do. Native addons aren't statically
    // traceable, so the binary must be listed explicitly here or the
    // deployed function 500s with "cannot open shared object file". Kept to
    // exactly 2 route files (POST /api/runs, and the consolidated
    // /api/runs/[id] handling GET/POST/PATCH) -- routes singled out here
    // lose Next's automatic function-sharing and become isolated Lambdas, and
    // more than a couple of those blows past Vercel Hobby's 12-function cap.
    "/api/runs/**": ["./model/**", "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**"],
    // Same reasoning as /api/runs/** above, for the multiplayer session
    // routes -- kept to exactly 2 route files (POST /api/sessions, and the
    // consolidated /api/sessions/[id] handling GET/POST/PATCH) for the same
    // function-count-budget reason.
    "/api/sessions/**": ["./model/**", "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**"],
  },
  // Pins the workspace root to this app (avoids Next.js misdetecting a
  // package-lock.json elsewhere on disk as the monorepo root).
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;

import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node ships a native (.node) addon, and @electric-sql/pglite
  // (dev-only local database fallback, see src/db/client.ts) resolves its
  // WASM/data assets relative to import.meta.url -- both break if
  // webpack/turbopack bundles them, so both must be required at runtime
  // unbundled instead.
  serverExternalPackages: ["onnxruntime-node", "@electric-sql/pglite"],
  outputFileTracingIncludes: {
    "/api/runs/**": ["./model/**"],
  },
  // Pins the workspace root to this app (avoids Next.js misdetecting a
  // package-lock.json elsewhere on disk as the monorepo root).
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;

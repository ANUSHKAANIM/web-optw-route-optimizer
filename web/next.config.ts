import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node ships a native (.node) addon and must not be bundled by
  // webpack/turbopack -- Next.js needs to require() it at runtime instead.
  serverExternalPackages: ["onnxruntime-node"],
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

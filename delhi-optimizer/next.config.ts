import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node ships a native (.node) addon, and highs ships a WASM
  // binary it locates relative to its own module directory -- both break
  // when Turbopack/webpack rewrite their asset paths into a bundled
  // "/_next/static/media/..." URL instead of a real filesystem path (seen
  // live: HiGHS failing with ENOENT on a server-action-triggered solve).
  // Keeping them external lets Node require() them directly at runtime.
  serverExternalPackages: ["onnxruntime-node", "highs"],
};

export default nextConfig;

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // onnxruntime-node ships a native (.node) addon -- keep it out of the
  // webpack/Turbopack bundle and let Node require() it directly at runtime
  // (same reasoning as the original web/ app's next.config.ts).
  serverExternalPackages: ["onnxruntime-node"],
};

export default nextConfig;

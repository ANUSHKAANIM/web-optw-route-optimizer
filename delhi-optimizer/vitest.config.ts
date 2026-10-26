import { defineConfig } from "vitest/config";
import path from "node:path";
import { config } from "dotenv";

// Next.js loads .env.local automatically; vitest does not -- load it here
// so DB-backed tests see the same DATABASE_URL the app runtime does.
config({ path: path.resolve(__dirname, ".env.local") });

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

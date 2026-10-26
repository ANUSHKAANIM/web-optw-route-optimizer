import { config } from "dotenv";
import path from "node:path";
import { defineConfig, env } from "prisma/config";

// Next.js loads .env.local automatically at runtime; the Prisma CLI does
// not, since it runs outside Next -- load it explicitly here so `prisma
// generate`/`db push`/`migrate` see the same DATABASE_URL the app does.
config({ path: path.join(__dirname, ".env.local") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});

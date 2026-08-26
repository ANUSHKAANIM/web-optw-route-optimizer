import fs from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";
import * as schema from "@/db/schema";

type Db = NeonHttpDatabase<typeof schema> | PgliteDatabase<typeof schema>;

// Cached on `globalThis` rather than a module-scope variable: Next.js dev
// (Turbopack) can instantiate this module more than once per process (e.g.
// once for a Route Handler's bundle, once for a Server Component's), and a
// plain module-level singleton wouldn't be shared between them -- leading to
// two competing PGlite instances opening the same on-disk database directory.
const globalForDb = globalThis as unknown as {
  __optwDb?: Db;
  __optwDbInit?: Promise<Db>;
};

/**
 * Lazily creates the Drizzle client on first use.
 *
 * - If `DATABASE_URL` is set (Neon Postgres, e.g. in production/Vercel), uses
 *   the HTTP-based Neon driver.
 * - Otherwise -- for local development with zero setup -- falls back to an
 *   embedded PGlite (real Postgres, compiled to WASM) database file under
 *   `web/.data/pglite`, and runs migrations against it automatically. This
 *   is dev-only: never used when DATABASE_URL is set, so production always
 *   talks to real Postgres.
 */
export async function getDbAsync(): Promise<Db> {
  if (globalForDb.__optwDb) return globalForDb.__optwDb;
  if (globalForDb.__optwDbInit) return globalForDb.__optwDbInit;

  globalForDb.__optwDbInit = (async () => {
    const url = process.env.DATABASE_URL;
    if (url) {
      const db = drizzleNeon(neon(url), { schema });
      globalForDb.__optwDb = db;
      return db;
    }

    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DATABASE_URL is not set. Create a Neon Postgres database and add its " +
          "connection string to your environment (see .env.example).",
      );
    }

    const dataDir = path.join(process.cwd(), ".data", "pglite");
    fs.mkdirSync(dataDir, { recursive: true });
    const client = new PGlite(dataDir);
    const db = drizzlePglite(client, { schema });
    await applyMigrationsIfNeeded(client);
    console.warn(
      `[db] DATABASE_URL not set -- using local embedded PGlite database at ${dataDir}. ` +
        "Set DATABASE_URL to use real Neon Postgres instead (see .env.example).",
    );
    globalForDb.__optwDb = db;
    return db;
  })();

  return globalForDb.__optwDbInit;
}

/** Applies each SQL file under drizzle/ (in filename order) directly via
 * PGlite's client, if the `runs` table doesn't exist yet. Bypasses
 * drizzle-orm's migrate() helper, which reads migration files in a way that
 * doesn't survive Turbopack's dev bundling of this module; reading the raw
 * .sql files ourselves with plain `fs` sidesteps that entirely. Local
 * (PGlite) dev-only path -- production always migrates real Postgres via
 * `npm run db:push` / `db:migrate` against DATABASE_URL. */
async function applyMigrationsIfNeeded(client: PGlite): Promise<void> {
  const { rows } = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.runs') IS NOT NULL AS exists",
  );
  if (rows[0]?.exists) return;

  const migrationsDir = path.join(process.cwd(), "drizzle");
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }
}

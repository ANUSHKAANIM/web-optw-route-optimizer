import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "@/db/schema";

let cachedDb: NeonHttpDatabase<typeof schema> | null = null;

/** Lazily creates the Drizzle client on first use, so the module can be
 * imported (e.g. during build/type-check) without DATABASE_URL set. */
export function getDb(): NeonHttpDatabase<typeof schema> {
  if (cachedDb) return cachedDb;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Create a Neon Postgres database and add its " +
        "connection string to .env.local (see .env.example).",
    );
  }

  cachedDb = drizzle(neon(url), { schema });
  return cachedDb;
}

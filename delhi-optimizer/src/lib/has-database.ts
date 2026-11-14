/** The multiplayer game needs a real Postgres database. Deployments
 * without one (e.g. the public demo, which sets a placeholder URL only so
 * `prisma generate` can run) hide it rather than show a broken page. */
export function hasDatabase(): boolean {
  const url = process.env.DATABASE_URL ?? "";
  return url !== "" && !url.includes("unused:unused@");
}

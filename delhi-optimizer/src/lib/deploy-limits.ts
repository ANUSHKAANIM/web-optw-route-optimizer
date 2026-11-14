/** Set LOW_MEMORY_DEPLOY=1 on small hosts (the public demo runs on a
 * 512 MB server). The Hurricane Idalia scenario holds ~375 MB of real
 * census-tract data in memory, so on such hosts it is hidden everywhere
 * and its server actions refuse to load it. Local runs are unaffected. */
export function isLowMemoryDeploy(): boolean {
  return process.env.LOW_MEMORY_DEPLOY === "1";
}

export const LOW_MEMORY_IDALIA_NOTE =
  "The Hurricane Idalia scenario needs more memory than this public demo server has, so it only runs in the local version of the app.";

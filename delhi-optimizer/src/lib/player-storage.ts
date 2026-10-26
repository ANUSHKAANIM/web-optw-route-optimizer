const KEY_PREFIX = "delhi-optimizer-player-";

/** Remembers which player this browser is, per session, so a refresh or a
 * shared/bookmarked link without the ?playerId= query string doesn't strand
 * the user with no way back in. Wrapped in try/catch since localStorage can
 * throw in private browsing -- the game stays usable via the URL alone. */
export function savePlayerId(sessionId: number, playerId: number): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${sessionId}`, String(playerId));
  } catch {
    // ignored -- see above
  }
}

export function loadPlayerId(sessionId: number): number | null {
  try {
    const raw = localStorage.getItem(`${KEY_PREFIX}${sessionId}`);
    const parsed = raw ? Number(raw) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

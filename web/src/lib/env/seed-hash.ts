/** Mixes two integers into one well-distributed 32-bit seed, so nearby
 * (seed, index) pairs don't produce visually correlated PRNG streams.
 * Shared by every deterministic-per-interval generator (dynamic tourist
 * rewards, mock forecast risk zones, ...). */
export function hashSeed(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

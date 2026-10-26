/** Deterministic PRNG (mulberry32). Given the same seed, always produces
 * the same sequence -- what makes reward rounds and forecast scenarios
 * reproducible across every player polling the same session. */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  uniform(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
}

/** Mixes two integers into one well-distributed 32-bit seed, so nearby
 * (seed, roundIndex) pairs don't produce visually correlated sequences. */
export function hashSeed(a: number, b: number): number {
  let h = (a ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ b, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

export function createSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

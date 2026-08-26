/**
 * Deterministic PRNG (mulberry32) used to seed reproducible OPTW instances.
 * Not bit-compatible with PyTorch's RNG -- only needs to be reproducible
 * within this app, given the same seed.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform float in [min, max). */
  uniform(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Uniform integer in [min, max] inclusive. */
  intInclusive(min: number, max: number): number {
    return Math.floor(this.uniform(min, max + 1));
  }
}

export function createSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

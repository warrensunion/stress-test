/** Seeded PRNG (mulberry32). Deterministic across runs and platforms. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** Uniform in [0, 1). */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Exponential sample with the given mean. */
  exp(mean: number): number {
    return -Math.log(1 - this.next()) * mean;
  }
  pick<T>(xs: T[]): T {
    return xs[Math.floor(this.next() * xs.length)];
  }
}

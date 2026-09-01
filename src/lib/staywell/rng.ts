/**
 * Deterministic seeded RNG (mulberry32).
 *
 * The contention schedule — which competing holds exist, when they land — is
 * derived from a seed, never from wall-clock time. The same seed always yields
 * the same world, which is what makes the demo reproducible and the evals
 * trustworthy.
 */

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;

  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random integer in [min, max]. */
export function intBetween(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** A random element of a readonly array. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  const index = Math.floor(rng() * items.length);
  return items[index] as T;
}

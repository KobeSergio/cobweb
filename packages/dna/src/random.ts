/** A small seeded PRNG (mulberry32). Same seed, same sequence, on the server and in the browser. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fisher-Yates on a copy. */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = out[i]!
    out[i] = out[j]!
    out[j] = a
  }
  return out
}

/** A fresh 32-bit seed. The only `Math.random()` in the package. */
export function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

/** The seed for the collection at `position`. The first collection uses the project seed itself. */
export function collectionSeed(seed: number, position: number): number {
  return (seed + position * 0x9e3779b9) >>> 0
}

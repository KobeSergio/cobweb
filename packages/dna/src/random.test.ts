import { describe, expect, it } from 'vitest'
import { collectionSeed, seededRandom, shuffle } from './random'

describe('seededRandom', () => {
  it('gives the same sequence for the same seed, in [0, 1)', () => {
    const a = seededRandom(42)
    const b = seededRandom(42)
    const first = Array.from({ length: 5 }, () => a())
    expect(Array.from({ length: 5 }, () => b())).toEqual(first)
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true)
    expect(seededRandom(43)()).not.toBe(first[0])
  })
})

describe('shuffle', () => {
  it('returns a permutation and leaves its input alone', () => {
    const input = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8])
    const out = shuffle(input, seededRandom(7))
    expect([...out].sort((x, y) => x - y)).toEqual([...input])
    expect(out).not.toEqual([...input])
    expect(shuffle(input, seededRandom(7))).toEqual(out)
  })
})

describe('collectionSeed', () => {
  it('is the project seed for the first collection and different for the next', () => {
    expect(collectionSeed(5, 0)).toBe(5)
    expect(collectionSeed(5, 1)).not.toBe(5)
  })
})

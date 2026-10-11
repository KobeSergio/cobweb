import { describe, expect, it } from 'vitest'
import { owlSpec } from './fixtures'
import { batchOf, isGenerativeToken, resolveTraits } from './generative'

const token = (dna: string[], collectionId = 'owls') => ({ id: 8, collectionId, dna, description: null })

describe('batchOf', () => {
  it('puts ids 1 to 100 in batch 0 and 101 in batch 1', () => {
    expect([1, 100, 101, 200, 201, 300].map((id) => batchOf(id, 100))).toEqual([0, 0, 1, 1, 2, 2])
  })
})

describe('isGenerativeToken', () => {
  it('tells a DNA token from an asset token', () => {
    expect(isGenerativeToken(token([]))).toBe(true)
    expect(isGenerativeToken({ id: 1, image: { key: 'a', ext: 'gif' }, attributes: [] })).toBe(false)
  })
})

describe('resolveTraits', () => {
  it('pairs every layer, bottom first, with the trait the DNA names', () => {
    const { picks } = resolveTraits(owlSpec(), token(['bg-ink', 'eyes-wide', 'hat-none']))
    expect(picks.map((p) => [p.layer.id, p.trait.id])).toEqual([
      ['background', 'bg-ink'],
      ['eyes', 'eyes-wide'],
      ['hat', 'hat-none'],
    ])
  })

  it('refuses an unknown collection, a DNA of the wrong length and a trait from another layer', () => {
    const cases = [
      token(['bg-ink', 'eyes-wide', 'hat-none'], 'bats'),
      token(['bg-ink', 'eyes-wide']),
      token(['bg-ink', 'eyes-wide', 'hat-none', 'bg-ink']),
      token(['eyes-wide', 'bg-ink', 'hat-none']),
      token(['bg-ink', 'eyes-gone', 'hat-none']),
    ]
    for (const bad of cases)
      expect(() => resolveTraits(owlSpec(), bad)).toThrow(
        expect.objectContaining({ code: 'bad-dna', tokenId: 8 }),
      )
  })
})

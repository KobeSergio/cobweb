import { attributeKeyOf, buildTraitIndex, rankTokens } from '@cobweb/dna'
import { describe, expect, it, vi } from 'vitest'
import { DEMO_LAYERS, DEMO_TOKENS } from '@/lib/demo'
import { ranksOf } from './ranks-core'

// The core's job read lives in the deploy core, which loads the server's chain clients.
vi.mock('@/lib/deploy/deploy-core', () => ({ doneJobRow: vi.fn() }))

describe('ranksOf (docs/specs/2026-10-16-mint-page-live-data.md, section 6.3)', () => {
  it("equals rankTokens with Generate's attribute key, laid out by id", () => {
    const ranks = ranksOf(DEMO_TOKENS, DEMO_LAYERS)
    expect(ranks).toHaveLength(DEMO_TOKENS.length)
    for (const token of DEMO_TOKENS) expect(ranks[token.id - 1]).toBe(token.rank)
    const ranked = rankTokens(DEMO_TOKENS, attributeKeyOf(buildTraitIndex(DEMO_LAYERS)))
    expect(ranks).toEqual([...ranked].sort((a, b) => a.id - b.id).map((token) => token.rank))
  })

  it('ranks a list stored in another order the same, as a permutation of 1 to the count (final fix wave M5)', () => {
    // The set's last 40 tokens as their own set, numbered from 1 by position, whatever ids the demo set uses.
    const tail = DEMO_TOKENS.slice(-40).map(({ dna }, index) => ({ id: index + 1, dna }))
    const ranks = ranksOf(tail, DEMO_LAYERS)
    expect([...ranks].sort((a, b) => a - b)).toEqual(
      Array.from({ length: tail.length }, (_, index) => index + 1),
    )
    expect(ranksOf([...tail].reverse(), DEMO_LAYERS)).toEqual(ranks)
    const byDna = [...tail].sort((a, b) => a.dna.join(' ').localeCompare(b.dna.join(' ')))
    expect(byDna.map((token) => token.id)).not.toEqual(tail.map((token) => token.id))
    expect(ranksOf(byDna, DEMO_LAYERS)).toEqual(ranks)
  })
})

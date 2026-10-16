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

  it('is a permutation of 1 to the count, whatever order the list is stored in', () => {
    const reversed = [...DEMO_TOKENS].reverse().slice(0, 40)
    const ranks = ranksOf(
      reversed.map(({ id, dna }) => ({ id: id - 737, dna })),
      DEMO_LAYERS,
    )
    expect([...ranks].sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, index) => index + 1))
  })
})

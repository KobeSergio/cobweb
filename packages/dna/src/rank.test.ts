import { describe, expect, it } from 'vitest'
import { fixture } from './fixture'
import { attributeKey, attributeKeyOf, buildTraitIndex } from './index-of'
import { rankTokens, rarityTier } from './rank'

/** Trait ids `<collection>:<layer>:<trait>`; the key is layer and trait name, as in the metadata. */
const keyOf = (id: string) => {
  const [, layer, trait] = id.split(':')
  return attributeKey(layer!, trait!)
}
const token = (id: number, dna: string[]) => ({ id, collectionId: 'a', dna, name: `#${id}` })

describe('rankTokens (sum of supply over attribute count)', () => {
  it('ranks a hand-computed set, ties to the lower id, and keeps order and fields', () => {
    // counts: a1 3, a2 1, b1 3, b2 1; total 4. Scores: t1 2.67, t2 5.33, t3 5.33, t4 2.67.
    const tokens = [
      token(1, ['L1:a1', 'L2:b1']),
      token(2, ['L1:a1', 'L2:b2']),
      token(3, ['L1:a2', 'L2:b1']),
      token(4, ['L1:a1', 'L2:b1']),
    ].map((t) => ({ ...t, dna: t.dna.map((d) => `a:${d}`) }))
    const ranked = rankTokens(tokens, keyOf)
    expect(ranked.map((t) => [t.id, t.rank])).toEqual([
      [1, 3],
      [2, 1],
      [3, 2],
      [4, 4],
    ])
    expect(ranked[0]!.name).toBe('#1')
  })

  it('counts the same attribute in two collections once', () => {
    const tokens = [
      { id: 1, collectionId: 'a', dna: ['a:Background:Dusk'] },
      { id: 2, collectionId: 'a', dna: ['a:Background:Ink'] },
      { id: 3, collectionId: 'b', dna: ['b:Background:Dusk'] },
      { id: 4, collectionId: 'b', dna: ['b:Background:Dusk'] },
    ]
    const ranked = rankTokens(tokens, keyOf)
    expect(ranked.find((t) => t.id === 2)!.rank).toBe(1)
    expect(ranked.find((t) => t.id === 1)!.rank).toBeGreaterThan(1)
  })

  it('adds, so a token with more attributes scores higher than one with fewer, equally rare ones', () => {
    // Tokens 1 and 3: three attributes, each on two of three tokens (score 3 x 1.5 = 4.5). Token 2: one
    // unique attribute (score 3). The sum puts 1 and 3 above 2; the old mean would have put 2 first.
    const tokens = [
      token(1, ['a:Body:Barn', 'a:Eyes:Wide', 'a:Acc:Hat']),
      token(2, ['b:Hat:Crown']),
      token(3, ['a:Body:Barn', 'a:Eyes:Wide', 'a:Acc:Hat']),
    ]
    const ranked = rankTokens(tokens, keyOf)
    expect(ranked.find((t) => t.id === 1)!.rank).toBe(1)
    expect(ranked.find((t) => t.id === 2)!.rank).toBe(3)
  })

  it('treats the same attributes in a different layer order as a tie, whatever the float drift', () => {
    // A baseline with no ties, to show the sum still orders distinct scores.
    const tokens = [
      token(1, ['a:L1:x', 'a:L2:y', 'a:L3:common']),
      token(2, ['a:L1:common', 'a:L2:z', 'a:L3:w']),
      token(3, ['a:L1:common', 'a:L2:q', 'a:L3:common']),
      token(4, ['a:L1:p', 'a:L2:q', 'a:L3:common']),
    ]
    // common on L1: tokens 2 and 3 (2); common on L3: tokens 1, 3, 4 (3); q on L2: 3 and 4 (2); the rest 1.
    // Token 1: 4 + 4 + 4/3. Token 2: 2 + 4 + 4. Token 4: 4 + 2 + 4/3. Token 3: 2 + 2 + 4/3.
    const ranked = rankTokens(tokens, keyOf)
    expect(ranked.map((t) => [t.id, t.rank])).toEqual([
      [1, 2],
      [2, 1],
      [3, 4],
      [4, 3],
    ])
    // Tokens 1, 2 and 3 each carry one attribute on three tokens (common) and two on one token, in
    // different layer orders. Summed in DNA order, [4/3, 4, 4] and [4, 4, 4/3] differ by one ulp, so the
    // old comparator put token 2 ahead of token 1; sorted first they tie and the ids decide.
    const twins = [
      token(1, ['a:L1:common', 'a:L2:v', 'a:L3:u']),
      token(2, ['a:L1:w', 'a:L2:x', 'a:L3:common']),
      token(3, ['a:L1:common', 'a:L2:y', 'a:L3:z']),
      token(4, ['a:L1:p', 'a:L2:q', 'a:L3:r']),
    ]
    expect(rankTokens(twins, (id) => id.split(':')[2]!).map((t) => [t.id, t.rank])).toEqual([
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 1],
    ])
  })

  it('copes with mixed DNA lengths and unknown ids after a layer is deleted', () => {
    const project = fixture()
    const keyOfIndex = attributeKeyOf(buildTraitIndex(project.layers))
    const tokens = [
      { id: 1, collectionId: 'owls', dna: ['bg-ink', 'body-barn', 'eyes-wide'] },
      { id: 2, collectionId: 'owls', dna: ['bg-ink', 'body-barn', 'eyes-wide', 'gone-trait'] },
      { id: 3, collectionId: 'owlets', dna: ['ob-1', 'oe-1'] },
    ]
    const ranked = rankTokens(tokens, keyOfIndex)
    expect(ranked.map((t) => t.rank).sort()).toEqual([1, 2, 3])
    expect(ranked.find((t) => t.id === 2)!.rank).toBe(1)
  })
})

describe('rarityTier', () => {
  it('cuts at 5, 15, 30 and 50 percent of the supply', () => {
    expect(rarityTier(5, 100).key).toBe('legendary')
    expect(rarityTier(6, 100).key).toBe('epic')
    expect(rarityTier(15, 100).key).toBe('epic')
    expect(rarityTier(16, 100).key).toBe('rare')
    expect(rarityTier(30, 100).key).toBe('rare')
    expect(rarityTier(31, 100).key).toBe('uncommon')
    expect(rarityTier(50, 100).key).toBe('uncommon')
    expect(rarityTier(51, 100).key).toBe('common')
    expect(rarityTier(1, 0).label).toBe('Common')
  })
})

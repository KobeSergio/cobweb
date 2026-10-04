import { describe, expect, it } from 'vitest'
import { attributeKey, rankTokens } from './art'

/** Trait ids `<collection>:<layer>:<trait>`; the key is layer and trait name, as in the metadata. */
const keyOf = (id: string) => {
  const [, layer, trait] = id.split(':')
  return attributeKey(layer!, trait!)
}

describe('rarity rank (legacy formula)', () => {
  it('sums an attribute across collections (legacy precedence bug kept one collection only)', () => {
    // "Background: Dusk" is in both collections: 3 tokens in all, so it is common, and the
    // token with "Background: Ink" (1 token) is the rarest.
    const tokens = [
      { id: 1, name: '', collectionId: 'a', dna: ['a:Background:Dusk'] },
      { id: 2, name: '', collectionId: 'a', dna: ['a:Background:Ink'] },
      { id: 3, name: '', collectionId: 'b', dna: ['b:Background:Dusk'] },
      { id: 4, name: '', collectionId: 'b', dna: ['b:Background:Dusk'] },
    ]
    const ranked = rankTokens(tokens, keyOf)
    expect(ranked.find((t) => t.id === 2)!.rank).toBe(1)
    // Had the counts been per collection, token 1's Dusk (1 of collection a) would tie with Ink.
    expect(ranked.find((t) => t.id === 1)!.rank).toBeGreaterThan(1)
  })

  it('divides by the layer count, so collections with more layers are not favoured', () => {
    // Token 1: two layers, both shared by half the set. Token 2: one layer, unique.
    const tokens = [
      { id: 1, name: '', collectionId: 'a', dna: ['a:Body:Barn', 'a:Eyes:Wide'] },
      { id: 2, name: '', collectionId: 'b', dna: ['b:Hat:Crown'] },
      { id: 3, name: '', collectionId: 'a', dna: ['a:Body:Barn', 'a:Eyes:Wide'] },
    ]
    const ranked = rankTokens(tokens, keyOf)
    expect(ranked.find((t) => t.id === 2)!.rank).toBe(1)
  })
})

import { describe, expect, it } from 'vitest'
import { DEMO_COLLECTIONS, DEMO_LAYERS } from '@/lib/demo/art'
import type { ArtRule, Collection, Layer } from '@/lib/demo'
import { buildTraitIndex } from '../lib/trait-index'
import { generateSet, tokenNameProblem, type SetContext } from './generation'
import { layersOf } from './layer-edits'

const owls = layersOf(DEMO_LAYERS, 'owls')
const ctx = (layers: Layer[]): SetContext => ({ tokenName: 'Night Owls', index: buildTraitIndex(layers) })
const one = (size: number): Collection[] => [{ id: 'owls', name: 'Owls', size }]

describe('generate (legacy auto-populate)', () => {
  it('names tokens "<token name> #<n>" running on across collections, with the description', () => {
    const outcome = generateSet(DEMO_LAYERS, [], DEMO_COLLECTIONS, 1, ctx(DEMO_LAYERS), 'Owls at night.')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.tokens).toHaveLength(777)
    expect(outcome.tokens[0]!.name).toBe('Night Owls #1')
    expect(outcome.tokens[600]!.name).toBe('Night Owls #601')
    expect(outcome.tokens[600]!.collectionId).toBe('owlets')
    expect(outcome.tokens.every((t) => t.description === 'Owls at night.')).toBe(true)
  })

  it('refuses token names with #, quotes or backticks, as legacy did', () => {
    expect(tokenNameProblem('Night Owls')).toBeNull()
    expect(tokenNameProblem('  ')).not.toBeNull()
    for (const bad of ['Owl #', "Owl's", 'Owl "x"', 'Owl `x`']) expect(tokenNameProblem(bad)).not.toBeNull()
  })

  it('says how many it can make when the rules run out ("can only generate X")', () => {
    // Two layers of two traits: four combinations, but Barn never mixes with Dusk, so three.
    const tiny: Layer[] = owls.slice(0, 2).map((layer) => ({
      ...layer,
      traits: layer.traits.slice(0, 2).map((t) => ({ ...t, weight: 50, constant: undefined })),
    }))
    const rules: ArtRule[] = [
      {
        id: 'r',
        kind: "doesn't mix with",
        traitId: tiny[1]!.traits[0]!.id,
        relatedTraitIds: [tiny[0]!.traits[0]!.id],
        bidirectional: true,
      },
    ]
    const outcome = generateSet(tiny, rules, one(4), 3, ctx(tiny), 'd')
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.problems[0]).toMatch(/Only 3 of 4 tokens/)
    expect(outcome.problems[0]).toMatch(/10,000 tries/)
  })
})

describe('"at least one" groups (art wiring)', () => {
  const eyes: Layer = {
    id: 'eyes',
    collectionId: 'c',
    name: 'Eyes',
    position: 0,
    traits: 'abcdefghij'.split('').map((id) => ({
      id,
      layerId: 'eyes',
      name: id.toUpperCase(),
      weight: 10,
      blank: false,
      imageUrl: `/${id}.png`,
    })),
  }
  const make = (seed: number) =>
    generateSet(
      [eyes],
      [],
      [{ id: 'c', name: 'C', size: 2 }],
      seed,
      {
        tokenName: 'Owl',
        index: buildTraitIndex([eyes]),
        atLeastOne: [{ id: 'g', collectionId: 'c', traitIds: ['a', 'b'] }],
      },
      '',
    )

  it('generates only tokens that carry one of the group traits, whatever the seed', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const outcome = make(seed)
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(outcome.tokens.map((token) => token.dna[0]).sort()).toEqual(['a', 'b'])
    }
  })
})

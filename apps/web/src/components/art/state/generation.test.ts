import { describe, expect, it } from 'vitest'
import { cappedShortfalls, countTraits, DEMO_COLLECTIONS, DEMO_LAYERS, satisfiesRules } from '@/lib/demo/art'
import type { ArtRule, Collection, Layer } from '@/lib/demo'
import { buildTraitIndex } from '../lib/trait-index'
import { generateSet, tokenNameProblem, type SetContext } from './generation'
import { deleteLayer, layersOf } from './layer-edits'
import { changeTrait } from './token-logic'

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

describe('maximum counts are caps, not exact quantities', () => {
  it('never places a capped trait more often than its cap, and reports a shortfall', () => {
    // Golden is capped at 7, but a rule keeps it off every background but one: it may fall short.
    const golden = owls[1]!.traits.find((t) => t.name === 'Golden')!
    const rules: ArtRule[] = [
      {
        id: 'gold',
        kind: 'must pair with',
        traitId: golden.id,
        relatedTraitIds: [owls[0]!.traits.find((t) => t.name === 'Sand')!.id],
        bidirectional: false,
      },
    ]
    const outcome = generateSet(owls, rules, one(300), 5, ctx(owls), 'd')
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const counts = countTraits(outcome.tokens)
    expect(counts[golden.id] ?? 0).toBeLessThanOrEqual(7)
    expect(outcome.tokens.every((t) => satisfiesRules(new Set(t.dna), rules))).toBe(true)
    const short = cappedShortfalls(owls, counts)
    if ((counts[golden.id] ?? 0) < 7) expect(short.map((s) => s.trait.id)).toContain(golden.id)
  })

  it('refuses a trait change that would take a capped trait past its cap', () => {
    const outcome = generateSet(owls, [], one(200), 9, ctx(owls), 'd')
    if (!outcome.ok) throw new Error(outcome.problems.join(' '))
    const golden = owls[1]!.traits.find((t) => t.name === 'Golden')!
    const without = outcome.tokens.filter((t) => !t.dna.includes(golden.id))
    let tokens = outcome.tokens
    let refused = ''
    for (const token of without) {
      const result = changeTrait(tokens, token.id, 1, golden.id, [], ctx(owls))
      if (result.ok) tokens = result.tokens
      else if (/up to 7 tokens/.test(result.reason)) {
        refused = result.reason
        break
      }
    }
    expect(countTraits(tokens)[golden.id]).toBe(7)
    expect(refused).toMatch(/up to 7 tokens/)
  })
})

describe('rules after a layer is deleted (legacy skipped them: related_layer_id < dna length)', () => {
  it('still applies every rule once a lower layer is gone', () => {
    const withoutBelly = deleteLayer(owls, 'belly')
    const accessory = withoutBelly.find((l) => l.id === 'accessory')!
    const eyes = withoutBelly.find((l) => l.id === 'eyes')!
    // Accessory sits above the deleted layer; the rule names it and Eyes.
    const rules: ArtRule[] = [
      {
        id: 'monocle',
        kind: "doesn't mix with",
        traitId: accessory.traits.find((t) => t.name === 'Monocle')!.id,
        relatedTraitIds: eyes.traits.filter((t) => t.name !== 'Wide').map((t) => t.id),
        bidirectional: true,
      },
    ]
    const outcome = generateSet(withoutBelly, rules, one(400), 11, ctx(withoutBelly), 'd')
    if (!outcome.ok) throw new Error(outcome.problems.join(' '))
    expect(outcome.tokens.every((t) => satisfiesRules(new Set(t.dna), rules))).toBe(true)
    expect(outcome.tokens.some((t) => t.dna.includes(rules[0]!.traitId))).toBe(true)
  })
})

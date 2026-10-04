import { describe, expect, it } from 'vitest'
import { DEMO_LAYERS, DEMO_RULES } from '@/lib/demo/art'
import type { ArtRule } from '@/lib/demo'
import { buildTraitIndex } from '../lib/trait-index'
import { layersOf } from './layer-edits'
import { activeRules, analyseRules, findDuplicate } from './rule-logic'

const owls = layersOf(DEMO_LAYERS, 'owls')
const index = buildTraitIndex(DEMO_LAYERS)
const rule = (id: string, kind: ArtRule['kind'], traitId: string, related: string[]): ArtRule => ({
  id,
  kind,
  traitId,
  relatedTraitIds: related,
  bidirectional: kind !== 'must pair with',
})

describe('conflict analyser', () => {
  it('reports the sample contradiction once', () => {
    const conflicts = analyseRules(owls, DEMO_RULES, index)
    expect(conflicts.map((c) => c.kind)).toEqual(['mixing'])
  })

  it('follows a chain of pairing rules, as the legacy analyser did', () => {
    // Crown must pair with Starry; Starry always pairs with Ink; Crown doesn't mix with Ink.
    const rules = [
      rule('a', 'must pair with', 'headwear-crown', ['eyes-starry']),
      rule('b', 'always pairs with', 'eyes-starry', ['background-ink']),
      rule('c', "doesn't mix with", 'headwear-crown', ['background-ink']),
    ]
    const conflicts = analyseRules(owls, rules, index)
    const chain = conflicts.find((c) => c.kind === 'mixing')
    expect(chain?.ruleIds.sort()).toEqual(['a', 'b', 'c'])
    // Generation skips only the rule that keeps them apart; the pairing rules still apply.
    expect(activeRules(rules, conflicts).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('finds a trait forced into two traits of one layer through a chain', () => {
    const rules = [
      rule('a', 'must pair with', 'headwear-crown', ['eyes-starry']),
      rule('b', 'must pair with', 'eyes-starry', ['accessory-book']),
      rule('c', 'must pair with', 'headwear-crown', ['accessory-scarf']),
    ]
    const conflicts = analyseRules(owls, rules, index)
    expect(conflicts.some((c) => c.kind === 'circular' && c.ruleIds.includes('b'))).toBe(true)
  })

  it('reports a trait that does not mix with any usable trait of a layer', () => {
    const beaks = owls.find((l) => l.id === 'beak')!.traits.map((t) => t.id)
    const conflicts = analyseRules(owls, [rule('x', "doesn't mix with", 'headwear-halo', beaks)], index)
    expect(conflicts.map((c) => c.kind)).toEqual(['isolated'])
  })
})

describe('duplicate rules', () => {
  it('catches the same two-way rule written from the other side', () => {
    const existing = [rule('a', "doesn't mix with", 'body-ember', ['background-clay'])]
    const flipped = { ...rule('b', "doesn't mix with", 'background-clay', ['body-ember']) }
    expect(findDuplicate(flipped, existing)?.id).toBe('a')
    // "Must pair with" is one-way: the reverse is a different rule.
    const oneWay = [rule('m', 'must pair with', 'body-ember', ['background-clay'])]
    expect(
      findDuplicate(rule('n', 'must pair with', 'background-clay', ['body-ember']), oneWay),
    ).toBeUndefined()
  })
})

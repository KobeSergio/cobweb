import { describe, expect, it } from 'vitest'
import {
  cappedShortfalls,
  countByCollection,
  countTraits,
  dnaKey,
  tokensBreakingRules,
  uniqueKey,
} from './curate'
import { fixture } from './fixture'
import { layersOf } from './index-of'

const project = fixture()
const owls = layersOf(project.layers, 'owls')

describe('keys', () => {
  it('ignores bypassed layers in the uniqueness key but not in the DNA key', () => {
    const a = { id: 1, collectionId: 'owls', dna: ['bg-ink', 'body-barn', 'eyes-wide', 'acc-none'] }
    const b = { id: 2, collectionId: 'owls', dna: ['bg-sand', 'body-barn', 'eyes-wide', 'acc-none'] }
    expect(uniqueKey(a.dna, owls)).toBe('*|body-barn|eyes-wide|acc-none')
    expect(uniqueKey(a.dna, owls)).toBe(uniqueKey(b.dna, owls))
    expect(dnaKey(a)).toBe('owls:bg-ink|body-barn|eyes-wide|acc-none')
    expect(dnaKey(a)).not.toBe(dnaKey(b))
  })
})

describe('counts', () => {
  const tokens = [
    { id: 1, collectionId: 'owls', dna: ['bg-ink', 'body-barn', 'eyes-gold', 'acc-none'] },
    { id: 2, collectionId: 'owls', dna: ['bg-sand', 'body-barn', 'eyes-wide', 'acc-hat'] },
    { id: 3, collectionId: 'owlets', dna: ['ob-1', 'oe-1'] },
  ]
  it('counts traits, tokens per collection and capped traits below their cap', () => {
    expect(countTraits(tokens)).toMatchObject({ 'body-barn': 2, 'eyes-gold': 1, 'ob-1': 1 })
    expect([...countByCollection(tokens)]).toEqual([
      ['owls', 2],
      ['owlets', 1],
    ])
    expect(cappedShortfalls(project.layers, countTraits(tokens))).toEqual([
      { trait: project.layers[2]!.traits[2], cap: 3, actual: 1 },
    ])
  })
  it('lists the tokens that break a rule', () => {
    const bad = { id: 4, collectionId: 'owls', dna: ['bg-sand', 'body-barn', 'eyes-sleepy', 'acc-hat'] }
    expect(tokensBreakingRules([...tokens, bad], project.rules)).toEqual([4])
  })
})

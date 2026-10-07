import { describe, expect, it } from 'vitest'
import {
  cappedShortfalls,
  countByCollection,
  changeTrait,
  countTraits,
  deleteTokens,
  dnaKey,
  shuffleIds,
  swapIds,
  tokensBreakingRules,
  uniqueKey,
} from './curate'
import { fixture } from './fixture'
import { buildTraitIndex, layersOf } from './index-of'

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

const index = buildTraitIndex(project.layers)
const owl = (id: number, dna: string[]) => ({ id, collectionId: 'owls', dna, name: `Owl #${id}` })
const hand = [
  owl(1, ['bg-ink', 'body-barn', 'eyes-wide', 'acc-none']),
  owl(2, ['bg-sand', 'body-barn', 'eyes-wide', 'acc-hat']),
  owl(3, ['bg-ink', 'body-snow', 'eyes-wide', 'acc-scarf']),
  owl(4, ['bg-ink', 'body-barn', 'eyes-sleepy', 'acc-none']),
]

describe('changeTrait', () => {
  it('accepts a change within the cap, the rules and uniqueness, keeping other fields', () => {
    const result = changeTrait(hand, 1, 2, 'eyes-gold', project, index)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens[0]!.dna).toEqual(['bg-ink', 'body-barn', 'eyes-gold', 'acc-none'])
    expect(result.tokens[0]!.name).toBe('Owl #1')
    expect(result.tokens.slice(1)).toEqual(hand.slice(1))
  })
  it('refuses a change past a cap', () => {
    const golden = [1, 2, 3].map((id) =>
      owl(id, ['bg-ink', 'body-barn', 'eyes-gold', `acc-${['none', 'hat', 'scarf'][id - 1]}`]),
    )
    const result = changeTrait([...golden, hand[3]!], 4, 2, 'eyes-gold', project, index)
    expect(result).toEqual({ ok: false, reason: 'Gold can appear on up to 3 tokens, and 3 already have it.' })
  })
  it('refuses a change that breaks a rule, with the rule', () => {
    expect(changeTrait(hand, 4, 3, 'acc-hat', project, index)).toEqual({
      ok: false,
      reason: "That breaks a rule: Hat doesn't mix with Sleepy.",
    })
  })
  it('refuses a change that makes two tokens the same under the key, ignoring a bypassed layer', () => {
    const result = changeTrait(hand, 2, 3, 'acc-none', project, index)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('Token #1 already has exactly these traits. Every token must be unique.')
    // Changing only the bypassed layer is always fine: the key does not see it.
    expect(changeTrait(hand, 1, 0, 'bg-sand', project, index).ok).toBe(true)
  })
  it('explains a missing token or trait, and refuses a trait from another layer or collection', () => {
    expect(changeTrait(hand, 99, 0, 'bg-sand', project, index)).toEqual({
      ok: false,
      reason: 'This token no longer exists.',
    })
    expect(changeTrait(hand, 1, 0, 'nope', project, index)).toEqual({
      ok: false,
      reason: 'That trait no longer exists.',
    })
    const elsewhere = { ok: false, reason: 'That trait belongs to another layer.' }
    expect(changeTrait(hand, 1, 0, 'acc-monocle', project, index)).toEqual(elsewhere)
    expect(changeTrait(hand, 1, 1, 'ob-1', project, index)).toEqual(elsewhere)
    expect(changeTrait(hand, 1, 9, 'eyes-gold', project, index)).toEqual(elsewhere)
  })
})

describe('ids', () => {
  it('swaps two ids, deletes and closes the gaps, and shuffles chosen ids deterministically', () => {
    const swapped = swapIds(hand, 1, 3)
    expect(swapped.map((t) => t.id)).toEqual([3, 2, 1, 4])
    expect(swapped[0]!.dna).toBe(hand[0]!.dna)
    const deleted = deleteTokens(hand, new Set([2]))
    expect(deleted.map((t) => [t.id, t.dna[3]])).toEqual([
      [1, 'acc-none'],
      [2, 'acc-scarf'],
      [3, 'acc-none'],
    ])
    const seed = [1, 2, 3, 4, 5, 6, 7, 8].find(
      (s) =>
        shuffleIds(hand, new Set([1, 2, 3]), s)
          .map((t) => t.id)
          .join() !== '1,2,3,4',
    )!
    const shuffled = shuffleIds(hand, new Set([1, 2, 3]), seed)
    expect(shuffled.map((t) => t.id)).not.toEqual([1, 2, 3, 4])
    expect([...shuffled.map((t) => t.id)].sort()).toEqual([1, 2, 3, 4])
    expect(shuffled.find((t) => t.dna === hand[3]!.dna)!.id).toBe(4)
    expect(shuffleIds(hand, new Set([1, 2, 3]), seed)).toEqual(shuffled)
    expect(hand.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })
})

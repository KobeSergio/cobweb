import { describe, expect, it } from 'vitest'
import { fixture, fixtureWithAtLeastOne } from './fixture'
import { buildTraitIndex, layersOf } from './index-of'
import {
  activeProjectRules,
  activeRules,
  analyseRules,
  brokenRule,
  constraintsOf,
  findDuplicate,
  pruneRules,
  rulesTouching,
  satisfiesRules,
} from './rules'
import type { ArtRule } from './types'

const project = fixture()
const index = buildTraitIndex(project.layers)
const owls = layersOf(project.layers, 'owls')
const rule = (id: string, kind: ArtRule['kind'], traitId: string, related: string[]): ArtRule => ({
  id,
  kind,
  traitId,
  relatedTraitIds: related,
  bidirectional: kind !== 'must pair with',
})

describe('satisfiesRules', () => {
  it('checks each kind on the finished token', () => {
    const r = project.rules
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-wide', 'acc-hat']), r)).toBe(true)
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-sleepy', 'acc-hat']), r)).toBe(false) // doesn't mix
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-wide', 'acc-scarf']), r)).toBe(false) // scarf without snow
    expect(satisfiesRules(new Set(['bg-ink', 'body-snow', 'eyes-wide', 'acc-none']), r)).toBe(false) // snow without scarf
    expect(satisfiesRules(new Set(['bg-sand', 'body-barn', 'eyes-gold', 'acc-none']), r)).toBe(false) // gold without ink
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-gold', 'acc-none']), r)).toBe(true)
  })

  it('applies an at-least-one constraint', () => {
    const constraints = constraintsOf(fixtureWithAtLeastOne().atLeastOne, 'owls')
    expect(constraintsOf(fixtureWithAtLeastOne().atLeastOne, 'owlets')).toEqual([])
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-wide', 'acc-none']), [], constraints)).toBe(
      false,
    )
    expect(satisfiesRules(new Set(['bg-ink', 'body-barn', 'eyes-wide', 'acc-hat']), [], constraints)).toBe(
      true,
    )
  })
})

describe('brokenRule', () => {
  it('words the first broken rule for the creator', () => {
    expect(brokenRule(['body-barn', 'eyes-sleepy', 'acc-hat'], project.rules, index)).toBe(
      "Hat doesn't mix with Sleepy.",
    )
    expect(brokenRule(['body-barn', 'eyes-wide', 'acc-scarf'], project.rules, index)).toBe(
      'Scarf always pairs with Snow.',
    )
    expect(brokenRule(['body-snow', 'eyes-wide', 'acc-none'], project.rules, index)).toBe(
      'Snow only appears with Scarf.',
    )
    expect(brokenRule(['bg-sand', 'eyes-gold'], project.rules, index)).toBe('Gold must pair with Ink.')
    expect(brokenRule(['bg-ink', 'body-barn', 'eyes-wide', 'acc-hat'], project.rules, index)).toBeNull()
    const constraints = constraintsOf(fixtureWithAtLeastOne().atLeastOne, 'owls')
    expect(brokenRule(['acc-none'], [], index, constraints)).toBe('Every token needs one of Hat or Scarf.')
  })
})

describe('duplicate rules', () => {
  it('catches the same two-way rule written from the other side, not a reversed one-way rule', () => {
    const existing = [rule('a', "doesn't mix with", 'body-barn', ['bg-ink'])]
    expect(findDuplicate(rule('b', "doesn't mix with", 'bg-ink', ['body-barn']), existing)?.id).toBe('a')
    expect(
      findDuplicate(rule('b', "doesn't mix with", 'body-barn', ['bg-ink', 'bg-sand']), existing, 'a'),
    ).toBeUndefined()
    const oneWay = [rule('m', 'must pair with', 'body-barn', ['bg-ink'])]
    expect(findDuplicate(rule('n', 'must pair with', 'bg-ink', ['body-barn']), oneWay)).toBeUndefined()
  })
})

describe('conflict analyser', () => {
  it('finds no conflict in the fixture', () => {
    expect(analyseRules(owls, project.rules, index)).toEqual([])
  })

  it('reports a pairing rule whose partners are all kept apart, once, and skips the blocker', () => {
    const rules = [
      rule('pair', 'always pairs with', 'acc-hat', ['eyes-sleepy']),
      rule('block', "doesn't mix with", 'eyes-sleepy', ['acc-hat']),
    ]
    const conflicts = analyseRules(owls, rules, index)
    expect(conflicts.map((c) => c.kind)).toEqual(['mixing'])
    expect(conflicts[0]!.ruleIds).toEqual(['pair', 'block'])
    expect(activeRules(rules, conflicts).map((r) => r.id)).toEqual(['pair'])
  })

  it('follows a chain of pairing rules and skips only the rule that keeps the ends apart', () => {
    const rules = [
      rule('a', 'must pair with', 'acc-hat', ['eyes-wide']),
      rule('b', 'always pairs with', 'eyes-wide', ['bg-ink']),
      rule('c', "doesn't mix with", 'acc-hat', ['bg-ink']),
    ]
    const conflicts = analyseRules(owls, rules, index)
    const chain = conflicts.find((c) => c.kind === 'mixing')
    expect([...chain!.ruleIds].sort()).toEqual(['a', 'b', 'c'])
    expect(activeRules(rules, conflicts).map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('finds a trait forced into two traits of one layer through a chain', () => {
    const rules = [
      rule('a', 'must pair with', 'acc-hat', ['eyes-wide']),
      rule('b', 'must pair with', 'eyes-wide', ['body-barn']),
      rule('c', 'must pair with', 'acc-hat', ['body-snow']),
    ]
    const conflicts = analyseRules(owls, rules, index)
    expect(conflicts.some((c) => c.kind === 'circular' && c.ruleIds.includes('b'))).toBe(true)
  })

  it('reports a trait that does not mix with any usable trait of a layer', () => {
    const bodies = ['body-barn', 'body-snow', 'body-gray']
    const conflicts = analyseRules(owls, [rule('x', "doesn't mix with", 'acc-hat', bodies)], index)
    expect(conflicts.map((c) => c.kind)).toEqual(['isolated'])
  })

  it('gives the active rules of a project in one call', () => {
    expect(activeProjectRules(project)).toEqual(project.rules)
    const conflicted = {
      ...project,
      rules: [...project.rules, rule('block', "doesn't mix with", 'body-snow', ['acc-scarf'])],
    }
    expect(activeProjectRules(conflicted).map((r) => r.id)).toEqual(project.rules.map((r) => r.id))
  })
})

describe('pruneRules', () => {
  it('drops a deleted trait from rules and removes rules left with nothing to pair', () => {
    const kept = new Set(project.layers.flatMap((l) => l.traits.map((t) => t.id)))
    kept.delete('eyes-sleepy')
    const pruned = pruneRules(project.rules, kept)
    expect(pruned.map((r) => r.id)).toEqual(['r-scarf-snow', 'r-gold-ink'])
    expect(rulesTouching(project.rules, new Set(['eyes-sleepy']))).toBe(1)
    const trimmed = pruneRules([rule('t', "doesn't mix with", 'acc-hat', ['eyes-sleepy', 'eyes-wide'])], kept)
    expect(trimmed[0]!.relatedTraitIds).toEqual(['eyes-wide'])
    expect(pruneRules(project.rules, new Set(kept).add('eyes-sleepy'))).toBe(project.rules)
  })
})

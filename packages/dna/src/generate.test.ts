import { describe, expect, it } from 'vitest'
import { countTraits, uniqueKey } from './curate'
import { deepFreeze, fixture, fixtureWithAtLeastOne } from './fixture'
import { fillTo, generateProject, generationProblems, regenerate } from './generate'
import { layersOf } from './index-of'
import { constraintsOf, satisfiesRules } from './rules'
import type { Project } from './types'

const project = fixture()
const owls = layersOf(project.layers, 'owls')
const sized = (p: Project, owlsSize: number): Project =>
  deepFreeze({
    ...p,
    collections: p.collections.map((c) => (c.id === 'owls' ? { ...c, size: owlsSize } : c)),
  })

describe('generateProject', () => {
  it('is deterministic and numbers tokens 1 to N across collections', () => {
    const a = generateProject(project, 1)
    const b = generateProject(project, 1)
    expect(a).toEqual(b)
    expect(a.tokens.map((t) => t.id)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1))
    expect(a.made).toEqual([
      { collectionId: 'owls', wanted: 12, made: 12 },
      { collectionId: 'owlets', wanted: 4, made: 4 },
    ])
    expect(a.tokens.slice(12).every((t) => t.collectionId === 'owlets' && t.dna.length === 2)).toBe(true)
    expect(generateProject(project, 2).tokens).not.toEqual(a.tokens)
  })

  it('keeps every token within the rules, unique under the key, and every cap', () => {
    const { tokens, shortfalls } = generateProject(project, 3)
    const owlTokens = tokens.filter((t) => t.collectionId === 'owls')
    expect(owlTokens.every((t) => satisfiesRules(new Set(t.dna), project.rules))).toBe(true)
    expect(new Set(owlTokens.map((t) => uniqueKey(t.dna, owls))).size).toBe(owlTokens.length)
    expect(countTraits(tokens)['eyes-gold'] ?? 0).toBeLessThanOrEqual(3)
    if ((countTraits(tokens)['eyes-gold'] ?? 0) === 3) expect(shortfalls).toEqual([])
  })

  it('stops short and says how far it got when the unique combinations run out', () => {
    // Background is bypassed and the rules bind, so owls have 19 unique keys (see the fixture).
    const { made, tokens } = generateProject(sized(project, 30), 4)
    expect(made[0]!.made).toBeLessThanOrEqual(19)
    expect(made[0]!.made).toBeLessThan(30)
    expect(made[0]!.wanted).toBe(30)
    // The owlets still follow, numbered after the owls that were made.
    expect(tokens.filter((t) => t.collectionId === 'owlets')).toHaveLength(4)
    expect(tokens[tokens.length - 1]!.id).toBe(tokens.length)
  })

  it('reports a capped trait that a rule starves (a cap is a cap)', () => {
    const starved: Project = deepFreeze({
      ...project,
      layers: project.layers.map((layer) =>
        layer.id === 'body'
          ? {
              ...layer,
              traits: [
                { ...layer.traits[0]!, weight: 100 },
                { ...layer.traits[1]!, weight: 0, constant: 1 },
              ],
            }
          : layer,
      ),
      rules: [
        {
          id: 'gold-snow',
          kind: 'must pair with',
          traitId: 'eyes-gold',
          relatedTraitIds: ['body-snow'],
          bidirectional: false,
        },
      ],
    })
    const { tokens, shortfalls } = generateProject(starved, 5)
    expect(
      tokens.every((t) => t.collectionId !== 'owls' || satisfiesRules(new Set(t.dna), starved.rules)),
    ).toBe(true)
    const gold = countTraits(tokens)['eyes-gold'] ?? 0
    expect(gold).toBeLessThanOrEqual(1)
    expect(shortfalls.map((s) => [s.trait.id, s.cap, s.actual])).toContainEqual(['eyes-gold', 3, gold])
  })

  it('honours an at-least-one constraint', () => {
    const { tokens } = generateProject(fixtureWithAtLeastOne(), 6)
    const constraints = constraintsOf(fixtureWithAtLeastOne().atLeastOne, 'owls')
    expect(
      tokens
        .filter((t) => t.collectionId === 'owls')
        .every((t) => satisfiesRules(new Set(t.dna), [], constraints)),
    ).toBe(true)
  })

  it('makes one token when every layer bypasses uniqueness, and returns quickly', () => {
    const allBypass: Project = deepFreeze({
      ...project,
      collections: [project.collections[0]!],
      layers: owls.map((layer) => ({ ...layer, bypassDna: true })),
      rules: [],
    })
    const started = Date.now()
    expect(generateProject(allBypass, 7).made).toEqual([{ collectionId: 'owls', wanted: 12, made: 1 }])
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

describe('generationProblems', () => {
  it('explains what stops a generation', () => {
    expect(generationProblems(project)).toEqual([])
    expect(generationProblems({ ...project, collections: [] })).toEqual([
      'Add a collection on the Layers step.',
    ])
    expect(generationProblems(sized(project, 10_001))[0]).toMatch(/at most 10,000 tokens/)
    const noTraits = {
      ...project,
      layers: project.layers.map((l) => (l.id === 'eyes' ? { ...l, traits: [] } : l)),
    }
    expect(generationProblems(noTraits)).toEqual(['Eyes in Owls has no traits yet.'])
    const bad = {
      ...project,
      layers: project.layers.map((l) =>
        l.id === 'body' ? { ...l, traits: l.traits.map((t) => ({ ...t, weight: 10 })) } : l,
      ),
    }
    expect(generationProblems(bad)).toEqual(['The weights in Body in Owls do not add up to 100%.'])
    expect(generationProblems(sized(project, 2))).toEqual([
      'The fixed quantities in Eyes in Owls add up to more than its size.',
    ])
  })
})

describe('regenerate and fillTo', () => {
  const start = generateProject(project, 8).tokens.map((t) => ({ ...t, name: `Owl #${t.id}` }))

  it('re-rolls only the chosen tokens, keeping their ids and extra fields, all or nothing', () => {
    const next = regenerate(start, new Set([1, 2]), project, 9)!
    expect(next).not.toBeNull()
    expect(next.map((t) => t.id)).toEqual(start.map((t) => t.id))
    expect(next.slice(2)).toEqual(start.slice(2))
    expect(next[0]!.name).toBe('Owl #1')
    const owlTokens = next.filter((t) => t.collectionId === 'owls')
    expect(new Set(owlTokens.map((t) => uniqueKey(t.dna, owls))).size).toBe(owlTokens.length)
    expect(owlTokens.every((t) => satisfiesRules(new Set(t.dna), project.rules))).toBe(true)
    expect(regenerate(start, new Set([1, 2]), project, 9)).toEqual(next)
  })

  it('fills a collection up to its size with ids after the last, or returns null when it cannot', () => {
    const ten = generateProject(sized(project, 10), 8).tokens.map((t) => ({ ...t, name: '' }))
    const filled = fillTo(ten, sized(project, 12), 10, (id, collectionId, dna) => ({
      id,
      collectionId,
      dna,
      name: 'new',
    }))!
    expect(filled).toHaveLength(16)
    expect(filled.slice(14).map((t) => [t.id, t.collectionId, t.name])).toEqual([
      [15, 'owls', 'new'],
      [16, 'owls', 'new'],
    ])
    const owlTokens = filled.filter((t) => t.collectionId === 'owls')
    expect(new Set(owlTokens.map((t) => uniqueKey(t.dna, owls))).size).toBe(12)
    const allBypass: Project = {
      ...project,
      collections: [{ ...project.collections[0]!, size: 2 }],
      layers: owls.map((l) => ({ ...l, bypassDna: true })),
      rules: [],
    }
    const one = generateProject(allBypass, 1).tokens
    expect(fillTo(one, allBypass, 2, (id, collectionId, dna) => ({ id, collectionId, dna }))).toBeNull()
  })
})

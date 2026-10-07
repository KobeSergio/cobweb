import { describe, expect, it } from 'vitest'
import { deepFreeze, fixture, fixtureWithAtLeastOne } from './fixture'
import { generateProject } from './generate'
import { canonicalTokenList, hashTokenList, validateTokenList, type LockProblem } from './lock'
import type { TokenCore } from './types'

const project = fixture()
const good = generateProject(project, 1).tokens
const codes = (result: ReturnType<typeof validateTokenList>) =>
  result.ok ? [] : result.problems.map((p) => p.code)
const problem = (result: ReturnType<typeof validateTokenList>, code: LockProblem['code']) =>
  result.ok ? undefined : result.problems.find((p) => p.code === code)
const strict = { allowDuplicates: false }

describe('validateTokenList', () => {
  it('accepts a generated set', () => {
    expect(validateTokenList(project, good, strict)).toEqual({ ok: true })
  })

  it('reports ids that are not 1 to N', () => {
    const result = validateTokenList(
      project,
      good.map((t) => (t.id === 3 ? { ...t, id: 99 } : t)),
      strict,
    )
    expect(codes(result)).toContain('ids')
    expect(problem(result, 'ids')!.message).toMatch(/1 to 16/)
  })

  it('reports a collection off its size', () => {
    const result = validateTokenList(project, good.slice(0, 15), strict)
    expect(codes(result)).toContain('size')
    expect(problem(result, 'size')!.message).toMatch(/Owlets has 3 tokens, not 4/)
  })

  it('reports an unknown collection, a wrong DNA length and a trait outside its layer', () => {
    const bad = good.map((t) =>
      t.id === 1
        ? { ...t, collectionId: 'ghosts' }
        : t.id === 2
          ? { ...t, dna: t.dna.slice(0, 2) }
          : t.id === 3
            ? { ...t, dna: ['body-barn', ...t.dna.slice(1)] }
            : t,
    )
    const result = validateTokenList(project, bad, strict)
    expect(codes(result)).toEqual(expect.arrayContaining(['collection', 'dna-length', 'trait']))
    expect(problem(result, 'collection')!.tokenIds).toEqual([1])
    expect(problem(result, 'dna-length')!.tokenIds).toEqual([2])
    expect(problem(result, 'trait')!.tokenIds).toEqual([3])
  })

  it("reports a trait from another collection's copy of the same layer as a wrong trait", () => {
    // Owlets have a Body layer too; its trait ids are not the owls' trait ids.
    const result = validateTokenList(
      project,
      good.map((t) => (t.id === 1 ? { ...t, dna: [t.dna[0]!, 'ob-1', t.dna[2]!, t.dna[3]!] } : t)),
      strict,
    )
    expect(codes(result)).toEqual(['trait'])
  })

  it('reports a token that breaks an active rule or a constraint', () => {
    const broken = good.map((t) =>
      t.id === 1 ? { ...t, dna: ['bg-ink', 'body-barn', 'eyes-sleepy', 'acc-hat'] } : t,
    )
    const result = validateTokenList(project, broken, strict)
    expect(codes(result)).toContain('rule')
    expect(problem(result, 'rule')!.message).toMatch(/Hat doesn't mix with Sleepy/)
    const constrained = fixtureWithAtLeastOne()
    const bare = generateProject(constrained, 1).tokens.map((t) =>
      t.id === 1 ? { ...t, dna: [...t.dna.slice(0, 3), 'acc-none'] } : t,
    )
    expect(codes(validateTokenList(constrained, bare, strict))).toContain('rule')
  })

  it('reports a cap exceeded', () => {
    const golden = good.map((t) =>
      t.collectionId === 'owls' ? { ...t, dna: ['bg-ink', t.dna[1]!, 'eyes-gold', t.dna[3]!] } : t,
    )
    const result = validateTokenList(project, golden, { allowDuplicates: true })
    expect(codes(result)).toContain('cap')
    expect(problem(result, 'cap')!.message).toMatch(/Gold is on \d+ tokens, more than its cap of 3/)
  })

  it('reports duplicates unless identical tokens are allowed (the key test in curate.test.ts covers bypass)', () => {
    // Copy one owl's DNA onto another, both without the capped Gold eyes, so only uniqueness breaks.
    const [source, target] = good.filter((t) => t.collectionId === 'owls' && !t.dna.includes('eyes-gold'))
    const twin = good.map((t) => (t.id === target!.id ? { ...t, dna: [...source!.dna] } : t))
    const result = validateTokenList(project, twin, strict)
    expect(codes(result)).toEqual(['duplicate'])
    expect(problem(result, 'duplicate')!.tokenIds).toEqual([source!.id, target!.id])
    expect(validateTokenList(project, twin, { allowDuplicates: true })).toEqual({ ok: true })
  })

  it('lists at most 20 ids and says how many more', () => {
    // Thirty tokens of a collection the project does not have, numbered on from the good set.
    const ghosts = Array.from({ length: 30 }, (_, i) => ({
      id: good.length + i + 1,
      collectionId: 'ghosts',
      dna: ['x'],
    }))
    const result = validateTokenList(project, [...good, ...ghosts], strict)
    const found = problem(result, 'collection')!
    expect(found.tokenIds).toHaveLength(20)
    expect(found.message).toMatch(/and 10 more/)
  })

  it('does not mutate its input', () => {
    const frozen = deepFreeze(good.map((t) => ({ ...t, dna: [...t.dna] })))
    expect(() => validateTokenList(project, frozen, strict)).not.toThrow()
  })
})

describe('canonicalTokenList and hashTokenList', () => {
  const list: TokenCore[] = [
    { id: 2, collectionId: 'a', dna: ['x', 'y'] },
    { id: 1, collectionId: 'a', dna: ['x', 'z'] },
  ]
  it('sorts by id, drops extra fields and ignores delimiters inside ids', () => {
    expect(canonicalTokenList(list)).toBe('[[1,"a",["x","z"]],[2,"a",["x","y"]]]')
    const extra = list.map((t) => ({ ...t, name: 'n', rank: 1 }))
    expect(canonicalTokenList(extra)).toBe(canonicalTokenList(list))
    expect(canonicalTokenList([])).toBe('[]')
    expect(canonicalTokenList([{ id: 1, collectionId: 'a|b', dna: ['x,"y'] }])).toBe('[[1,"a|b",["x,\\"y"]]]')
  })
  it('is SHA-256 of the canonical form as 0x hex, stable across order', async () => {
    const hash = await hashTokenList(list)
    expect(hash).toBe('0x4cbbf10c7093393a05d1ec49de09f8c9cf304ede5dc74e59f22c8357e01f8115')
    expect(await hashTokenList([...list].reverse())).toBe(hash)
    expect(await hashTokenList([])).toMatch(/^0x[0-9a-f]{64}$/)
  })
})

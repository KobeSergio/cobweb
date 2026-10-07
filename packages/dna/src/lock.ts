import { countTraits, uniqueKey } from './curate'
import { buildTraitIndex, layersOf, traitName } from './index-of'
import { activeProjectRules, brokenRule, constraintsOf } from './rules'
import type { Project, TokenCore } from './types'

export type LockProblem = {
  code: 'ids' | 'size' | 'collection' | 'dna-length' | 'trait' | 'rule' | 'cap' | 'duplicate'
  message: string
  tokenIds?: number[]
}

const LISTED = 20

/** "#3, #7 and 12 more" style, for problem messages. */
function listIds(ids: number[]): string {
  const shown = ids.slice(0, LISTED).map((id) => `#${id}`)
  const more = ids.length - shown.length
  return more > 0 ? `${shown.join(', ')} and ${more.toLocaleString('en-US')} more` : shown.join(', ')
}

/**
 * Checks a token list the browser submits at lock against the project: ids 1 to N, every collection
 * at its size, every DNA well formed, every token within the active rules and constraints, no cap
 * exceeded, and unique within its collection unless identical tokens are allowed. Returns every
 * problem found, so the creator sees the whole picture.
 */
export function validateTokenList(
  project: Project,
  tokens: TokenCore[],
  options: { allowDuplicates: boolean },
): { ok: true } | { ok: false; problems: LockProblem[] } {
  const problems: LockProblem[] = []
  const index = buildTraitIndex(project.layers)
  const rules = activeProjectRules(project, index)
  const layersFor = new Map(project.collections.map((c) => [c.id, layersOf(project.layers, c.id)]))

  const sortedIds = tokens.map((t) => t.id).sort((a, b) => a - b)
  const offIds = sortedIds.filter((id, i) => id !== i + 1)
  if (offIds.length > 0)
    problems.push({
      code: 'ids',
      message: `Token ids must run from 1 to ${tokens.length.toLocaleString('en-US')} with no gaps or repeats. Off: ${listIds(offIds)}.`,
      tokenIds: offIds.slice(0, LISTED),
    })

  for (const collection of project.collections) {
    const have = tokens.filter((t) => t.collectionId === collection.id).length
    if (have !== collection.size)
      problems.push({
        code: 'size',
        message: `${collection.name} has ${have.toLocaleString('en-US')} tokens, not ${collection.size.toLocaleString('en-US')}.`,
      })
  }

  const unknownCollection: number[] = []
  const wrongLength: number[] = []
  const wrongTrait: number[] = []
  const breaking: { id: number; why: string }[] = []
  const wellFormed: TokenCore[] = []
  for (const token of tokens) {
    const own = layersFor.get(token.collectionId)
    if (!own) {
      unknownCollection.push(token.id)
      continue
    }
    if (token.dna.length !== own.length) {
      wrongLength.push(token.id)
      continue
    }
    if (!token.dna.every((traitId, i) => own[i]!.traits.some((t) => t.id === traitId))) {
      wrongTrait.push(token.id)
      continue
    }
    wellFormed.push(token)
    const why = brokenRule(token.dna, rules, index, constraintsOf(project.atLeastOne, token.collectionId))
    if (why) breaking.push({ id: token.id, why })
  }
  if (unknownCollection.length)
    problems.push({
      code: 'collection',
      message: `${listIds(unknownCollection)} belong to a collection this project does not have.`,
      tokenIds: unknownCollection.slice(0, LISTED),
    })
  if (wrongLength.length)
    problems.push({
      code: 'dna-length',
      message: `${listIds(wrongLength)} do not have one trait per layer of their collection.`,
      tokenIds: wrongLength.slice(0, LISTED),
    })
  if (wrongTrait.length)
    problems.push({
      code: 'trait',
      message: `${listIds(wrongTrait)} name a trait that is not in the layer it stands for.`,
      tokenIds: wrongTrait.slice(0, LISTED),
    })
  if (breaking.length)
    problems.push({
      code: 'rule',
      message: `${listIds(breaking.map((b) => b.id))} break a rule. First: #${breaking[0]!.id}: ${breaking[0]!.why}`,
      tokenIds: breaking.map((b) => b.id).slice(0, LISTED),
    })

  const counts = countTraits(wellFormed)
  for (const layer of project.layers)
    for (const trait of layer.traits) {
      const actual = counts[trait.id] ?? 0
      if (trait.constant && actual > trait.constant)
        problems.push({
          code: 'cap',
          message: `${traitName(index, trait.id)} is on ${actual.toLocaleString('en-US')} tokens, more than its cap of ${trait.constant.toLocaleString('en-US')}.`,
        })
    }

  if (!options.allowDuplicates) {
    const seen = new Map<string, number>()
    const dupes: number[] = []
    for (const token of wellFormed) {
      const key = `${token.collectionId}:${uniqueKey(token.dna, layersFor.get(token.collectionId)!)}`
      const first = seen.get(key)
      if (first === undefined) seen.set(key, token.id)
      else dupes.push(first, token.id)
    }
    const ids = [...new Set(dupes)].sort((a, b) => a - b)
    if (ids.length)
      problems.push({
        code: 'duplicate',
        message: `${listIds(ids)} have the same traits as another token. Every token must be unique, or allow identical tokens at lock.`,
        tokenIds: ids.slice(0, LISTED),
      })
  }

  return problems.length ? { ok: false, problems } : { ok: true }
}

/** The form that is hashed: `[id, collection, dna]` triples sorted by id, as compact JSON. Names and ranks are not part of it. */
export function canonicalTokenList(tokens: TokenCore[]): string {
  const triples = [...tokens].sort((a, b) => a.id - b.id).map((t) => [t.id, t.collectionId, [...t.dna]])
  return JSON.stringify(triples)
}

/** SHA-256 of the canonical form, as `0x` plus 64 lowercase hex characters. Same list in any order, same hash. */
export async function hashTokenList(tokens: TokenCore[]): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(canonicalTokenList(tokens))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
  return `0x${hex}`
}

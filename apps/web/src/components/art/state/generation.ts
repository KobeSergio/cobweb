import {
  generateCollections,
  MAX_ATTEMPTS,
  rankTokens,
  repairPairs,
  satisfiesRules,
  seededRandom,
} from '@/lib/demo/art'
import type { ArtRule, Collection, GeneratedToken, Layer, Trait } from '@/lib/demo'
import {
  attributeKeyOf,
  constantTotal,
  weightedTraits,
  weightsValid,
  type TraitIndex,
} from '../lib/trait-index'
import { layersOf } from './layer-edits'

/**
 * Generating the set, on top of the seeded sample generator in `lib/demo/art.ts`, the way the
 * legacy auto-populate did: one size per collection, a token name and description, token ids
 * running on across collections, uniqueness within a collection, and a clear "can only generate
 * X" when the rules and traits run out.
 *
 * Seam: replaced by the trait engine in `packages/dna` (Phase 3). The browser still curates; at
 * lock the final list is validated and hashed on the server (MASTER_PLAN, Art: lock check).
 */

export type Draft = Omit<GeneratedToken, 'rank' | 'previewUrl'>

/** What names and ranks depend on: the token name chosen at Generate and the current layers. */
export type SetContext = { tokenName: string; index: TraitIndex }

/** Legacy limit on one collection's size (auto-populate capped each collection at 10,000). */
export const MAX_COLLECTION_SIZE = 10_000

/** Characters the legacy tool refused in a token name: `#` marks the id, quotes broke its metadata. */
const NAME_FORBIDDEN = /[#'"`]/

/** Why a token name cannot be used, worded for the creator, or null. */
export function tokenNameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a token name.'
  if (NAME_FORBIDDEN.test(name)) return 'A token name cannot contain #, quotes or backticks.'
  return null
}

/** Ranks the set (1 is rarest) and names every token "<token name> #<id>". */
export function finalise(tokens: Draft[], ctx: SetContext): GeneratedToken[] {
  const sorted = [...tokens].sort((a, b) => a.id - b.id)
  // Composites are always stacked from the current layers, so the sample previews are not used.
  return rankTokens(sorted, attributeKeyOf(ctx.index)).map((token) => ({
    ...token,
    name: `${ctx.tokenName.trim()} #${token.id}`,
    previewUrl: null,
  }))
}

/** Problems that stop a full generation, worded for the creator. */
export function generationProblems(layers: Layer[], collections: Collection[]): string[] {
  const problems: string[] = []
  const several = collections.length > 1
  if (collections.length === 0) problems.push('Add a collection on the Layers step.')
  // As in the legacy auto-populate, a collection left at 0 is skipped; at least one needs a size.
  else if (collections.every((collection) => collection.size < 1))
    problems.push(
      several ? 'Set a size for at least one collection.' : `Set a size for ${collections[0]!.name}.`,
    )
  for (const collection of collections) {
    const own = layersOf(layers, collection.id)
    const where = several ? ` in ${collection.name}` : ''
    if (collection.size < 1) continue
    if (collection.size > MAX_COLLECTION_SIZE)
      problems.push(
        `${collection.name} can have at most ${MAX_COLLECTION_SIZE.toLocaleString('en-US')} tokens.`,
      )
    if (own.length === 0) {
      problems.push(`Add at least one layer${where} on the Layers step.`)
      continue
    }
    const before = problems.length
    for (const layer of own) {
      if (layer.traits.length === 0) problems.push(`${layer.name}${where} has no traits yet.`)
      else if (!weightsValid(layer))
        problems.push(`The weights in ${layer.name}${where} do not add up to 100%.`)
      if (constantTotal(layer) > collection.size)
        problems.push(`The fixed quantities in ${layer.name}${where} add up to more than its size.`)
    }
    if (problems.length > before) continue
    const combinations = own.reduce(
      (product, layer) => product * layer.traits.filter((t) => t.constant || t.weight > 0).length,
      1,
    )
    if (combinations < collection.size)
      problems.push(
        `The layers${where} make at most ${combinations.toLocaleString('en-US')} different tokens, fewer than the size of ${collection.size.toLocaleString('en-US')}. Add traits or lower the size.`,
      )
  }
  return problems
}

export type GenerateOutcome = { ok: true; tokens: GeneratedToken[] } | { ok: false; problems: string[] }

/** The key a token's DNA is unique under: unique within its collection. */
export function dnaKey(token: Pick<GeneratedToken, 'collectionId' | 'dna'>): string {
  return `${token.collectionId}:${token.dna.join('|')}`
}

/**
 * Generates every collection to its size, ids running on from one collection to the next. A
 * collection that runs out of unique combinations within the rules stops, and the creator is told
 * how many it can make (legacy: "Cannot generate N tokens for the collection X! Can only generate
 * M tokens"). Nothing is replaced unless every collection is full.
 */
export function generateSet(
  layers: Layer[],
  rules: ArtRule[],
  collections: Collection[],
  seed: number,
  ctx: SetContext,
  description: string,
): GenerateOutcome {
  const problems = generationProblems(layers, collections)
  if (problems.length) return { ok: false, problems }
  const drafts = generateCollections(
    layers,
    rules,
    collections.filter((collection) => collection.size > 0),
    seed,
  )
  const short: string[] = []
  for (const collection of collections) {
    const own = drafts.filter((token) => token.collectionId === collection.id)
    const made = new Set(own.filter((t) => satisfiesRules(new Set(t.dna), rules)).map(dnaKey)).size
    if (made < collection.size)
      short.push(
        `${collections.length > 1 ? `${collection.name}: only` : 'Only'} ${made.toLocaleString('en-US')} of ${collection.size.toLocaleString('en-US')} tokens can be made unique within the rules (no new combination after ${MAX_ATTEMPTS.toLocaleString('en-US')} tries). Lower the size to ${made.toLocaleString('en-US')}, add traits, or loosen a rule.`,
      )
  }
  if (short.length) return { ok: false, problems: short }
  return {
    ok: true,
    tokens: finalise(
      drafts.map((token) => ({ ...token, description })),
      ctx,
    ),
  }
}

function pick(traits: Trait[], random: () => number): Trait | undefined {
  const total = traits.reduce((sum, trait) => sum + trait.weight, 0)
  let roll = random() * total
  for (const trait of traits) {
    roll -= trait.weight
    if (roll < 0) return trait
  }
  return traits[traits.length - 1]
}

/** A new DNA for one token: constants stay where they are, the rest is rolled until valid and unique. */
function roll(
  current: string[] | null,
  layers: Layer[],
  rules: ArtRule[],
  isTaken: (dna: string) => boolean,
  random: () => number,
): string[] | null {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let dna = layers.map((layer, i) => {
      const kept = layer.traits.find((trait) => trait.id === current?.[i] && trait.constant)
      return (kept ?? pick(weightedTraits(layer), random))?.id ?? ''
    })
    if (dna.includes('')) return null
    dna = repairPairs(dna, layers, rules, random)
    if (!isTaken(dna.join('|')) && satisfiesRules(new Set(dna), rules)) return dna
  }
  return null
}

export function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

/** Whether a DNA is taken within one collection, from the project-wide set of `dnaKey`s. */
function keyedTaken(taken: ReadonlySet<string>, collectionId: string) {
  return (dna: string) => taken.has(`${collectionId}:${dna}`)
}

/**
 * Re-rolls the chosen tokens, keeping their ids, names, descriptions and collections. All or
 * nothing, like the legacy tool: if one cannot be made, none changes.
 */
export function regenerate(
  tokens: GeneratedToken[],
  ids: ReadonlySet<number>,
  layers: Layer[],
  rules: ArtRule[],
  ctx: SetContext,
): GeneratedToken[] | null {
  const random = seededRandom(newSeed())
  const taken = new Set(tokens.filter((t) => !ids.has(t.id)).map(dnaKey))
  const next: Draft[] = []
  for (const token of tokens) {
    if (!ids.has(token.id)) {
      next.push(token)
      continue
    }
    const keyed = keyedTaken(taken, token.collectionId)
    const dna = roll(token.dna, layersOf(layers, token.collectionId), rules, keyed, random)
    if (!dna) return null
    taken.add(`${token.collectionId}:${dna.join('|')}`)
    next.push({ ...token, dna })
  }
  return finalise(next, ctx)
}

/**
 * Brings every collection up to its size. New tokens go after the last id, so ids stay 1 to N; a
 * collection over its size is left as it is (delete tokens to bring it down).
 */
export function fillTo(
  tokens: GeneratedToken[],
  collections: Collection[],
  layers: Layer[],
  rules: ArtRule[],
  ctx: SetContext,
  description: string,
): GeneratedToken[] | null {
  const random = seededRandom(newSeed())
  const taken = new Set(tokens.map(dnaKey))
  const next: Draft[] = [...tokens]
  let id = tokens.reduce((max, t) => Math.max(max, t.id), 0)
  for (const collection of collections) {
    const own = layersOf(layers, collection.id)
    const have = tokens.filter((t) => t.collectionId === collection.id).length
    for (let i = have; i < collection.size; i++) {
      const dna = roll(null, own, rules, keyedTaken(taken, collection.id), random)
      if (!dna) return null
      taken.add(`${collection.id}:${dna.join('|')}`)
      next.push({ id: ++id, name: '', description, collectionId: collection.id, dna })
    }
  }
  return finalise(next, ctx)
}

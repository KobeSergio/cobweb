import {
  fillTo as fillToWith,
  generateProject,
  generationProblems as projectProblems,
  MAX_ATTEMPTS,
  newSeed,
  rankTokens,
  regenerate as regenerateWith,
  type Project,
} from '@cobweb/dna'
import type { ArtRule, AtLeastOne, Collection, GeneratedToken, Layer } from '@/lib/demo'
import { attributeKeyOf, type TraitIndex } from '../lib/trait-index'

/**
 * Generating the set the way the legacy auto-populate did, on the engine in `@cobweb/dna`: one size
 * per collection, a token name and description, ids running on across collections, and a clear
 * "can only generate X" when the rules and traits run out. This module adds the naming and ranking
 * the screens expect; the engine does the rolling.
 */

export { dnaKey, MAX_COLLECTION_SIZE, newSeed } from '@cobweb/dna'

export type Draft = Omit<GeneratedToken, 'rank' | 'previewUrl'>

/** What names and ranks depend on: the token name chosen at Generate and the current layers; generation also honours `atLeastOne`. */
export type SetContext = { tokenName: string; index: TraitIndex; layers?: Layer[]; atLeastOne?: AtLeastOne[] }

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
  return rankTokens(sorted, attributeKeyOf(ctx.index)).map((token) => ({
    ...token,
    name: `${ctx.tokenName.trim()} #${token.id}`,
    previewUrl: null,
  }))
}

/** Problems that stop a full generation, worded for the creator. */
export function generationProblems(layers: Layer[], collections: Collection[]): string[] {
  return projectProblems({ layers, rules: [], collections })
}

export type GenerateOutcome = { ok: true; tokens: GeneratedToken[] } | { ok: false; problems: string[] }

/**
 * Generates every collection to its size. A collection that runs out of unique combinations within
 * the rules stops, and the creator is told how many it can make. Nothing is replaced unless every
 * collection is full.
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
  const project: Project = { layers, rules, collections, atLeastOne: ctx.atLeastOne }
  const { tokens, made } = generateProject(project, seed)
  const short = made
    .filter((m) => m.made < m.wanted)
    .map((m) => {
      const name = collections.find((c) => c.id === m.collectionId)?.name ?? m.collectionId
      return `${collections.length > 1 ? `${name}: only` : 'Only'} ${m.made.toLocaleString('en-US')} of ${m.wanted.toLocaleString('en-US')} tokens can be made unique within the rules (no new combination after ${MAX_ATTEMPTS.toLocaleString('en-US')} tries). Lower the size to ${m.made.toLocaleString('en-US')}, add traits, or loosen a rule.`
    })
  if (short.length) return { ok: false, problems: short }
  return {
    ok: true,
    tokens: finalise(
      tokens.map((token) => ({ ...token, name: '', description })),
      ctx,
    ),
  }
}

/** Re-rolls the chosen tokens, keeping ids, names, descriptions and collections. All or nothing. */
export function regenerate(
  tokens: GeneratedToken[],
  ids: ReadonlySet<number>,
  layers: Layer[],
  rules: ArtRule[],
  ctx: SetContext,
): GeneratedToken[] | null {
  const next = regenerateWith(tokens, ids, { layers, rules, atLeastOne: ctx.atLeastOne }, newSeed())
  return next && finalise(next, ctx)
}

/** Brings every collection up to its size; new tokens go after the last id. */
export function fillTo(
  tokens: GeneratedToken[],
  collections: Collection[],
  layers: Layer[],
  rules: ArtRule[],
  ctx: SetContext,
  description: string,
): GeneratedToken[] | null {
  const next = fillToWith(
    tokens,
    { layers, rules, collections, atLeastOne: ctx.atLeastOne },
    newSeed(),
    (id, collectionId, dna) => ({
      id,
      collectionId,
      dna,
      name: '',
      description,
      rank: 0,
      previewUrl: null,
    }),
  )
  return next && finalise(next, ctx)
}

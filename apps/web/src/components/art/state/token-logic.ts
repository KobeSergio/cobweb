import {
  changeTrait as changeTraitWith,
  deleteTokens as deleteTokensWith,
  newSeed,
  shuffleIds as shuffleIdsWith,
  swapIds as swapIdsWith,
  tokenAttributes as attributesWith,
  type Layer as EngineLayer,
} from '@cobweb/dna'
import type { ArtRule, GeneratedToken, Layer } from '@/lib/demo'
import { finalise, type SetContext } from './generation'

/**
 * Curation of the generated set on the engine in `@cobweb/dna`: changing a token's trait, its
 * description, swapping, deleting and shuffling ids, and a token's metadata attributes. This module
 * re-ranks and renames after each change; the engine does the checks.
 */

export { finalise, newSeed, type SetContext }
export {
  countByCollection,
  countTraits,
  rarityTier,
  TIER_RANGES,
  tokensBreakingRules,
  type RarityTier,
} from '@cobweb/dna'

export type ChangeOutcome = { ok: true; tokens: GeneratedToken[] } | { ok: false; reason: string }

/** The layers behind an index, in list order. */
function layersOfIndex(index: SetContext['index']): EngineLayer[] {
  const byId = new Map<string, { layer: EngineLayer; at: number }>()
  for (const entry of index.values()) byId.set(entry.layer.id, { layer: entry.layer, at: entry.layerIndex })
  return [...byId.values()].sort((a, b) => a.at - b.at).map((e) => e.layer)
}

/**
 * Sets one layer of one token to another trait, if the result is allowed: within its maximum count,
 * within the rules and unique in its collection. `layerIndex` is in the token's collection.
 */
export function changeTrait(
  tokens: GeneratedToken[],
  tokenId: number,
  layerIndex: number,
  traitId: string,
  rules: ArtRule[],
  ctx: SetContext,
): ChangeOutcome {
  const layers = ctx.layers ?? layersOfIndex(ctx.index)
  const result = changeTraitWith(tokens, tokenId, layerIndex, traitId, { layers, rules }, ctx.index)
  return result.ok ? { ok: true, tokens: finalise(result.tokens, ctx) } : result
}

/** Sets one token's metadata description. Ranks and names do not change. */
export function setDescription(tokens: GeneratedToken[], tokenId: number, description: string) {
  return tokens.map((t) => (t.id === tokenId ? { ...t, description } : t))
}

/** Renames every token "<token name> #<id>" and re-ranks against the current layers. */
export function renameTokens(tokens: GeneratedToken[], ctx: SetContext) {
  return finalise(tokens, ctx)
}

/** Swaps the ids of two tokens. Their traits stay with them. */
export function swapIds(tokens: GeneratedToken[], a: number, b: number, ctx: SetContext) {
  return finalise(swapIdsWith(tokens, a, b), ctx)
}

/** Deletes tokens and closes the gaps, so ids stay 1 to N. */
export function deleteTokens(tokens: GeneratedToken[], ids: ReadonlySet<number>, ctx: SetContext) {
  return finalise(deleteTokensWith(tokens, ids), ctx)
}

/** Shuffles the ids among the chosen tokens. */
export function shuffleIds(tokens: GeneratedToken[], ids: ReadonlySet<number>, ctx: SetContext) {
  return finalise(shuffleIdsWith(tokens, ids, newSeed()), ctx)
}

/** A token's metadata attributes, bottom layer first; blanks only when the project option is on. */
export function tokenAttributes(
  token: Pick<GeneratedToken, 'dna'>,
  layers: Layer[],
  index: SetContext['index'],
  showBlankTraits: boolean,
): { trait_type: string; value: string }[] {
  return attributesWith(token, layers, index, { showBlankTraits })
}

/**
 * Whether a token matches the gallery search: a number matches ids that start with it, and text
 * matches a layer or trait name of the token, ignoring case.
 */
export function matchesSearch(token: GeneratedToken, search: string, index: SetContext['index']): boolean {
  const query = search.trim().toLowerCase()
  if (!query) return true
  if (/^#?\d+$/.test(query)) return String(token.id).startsWith(query.replace('#', ''))
  return token.dna.some((traitId) => {
    const entry = index.get(traitId)
    return (
      !!entry &&
      (entry.trait.name.toLowerCase().includes(query) || entry.layer.name.toLowerCase().includes(query))
    )
  })
}

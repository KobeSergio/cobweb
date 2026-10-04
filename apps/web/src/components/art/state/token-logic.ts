import { countTraits, satisfiesRules, seededRandom } from '@/lib/demo/art'
import type { ArtRule, GeneratedToken, Layer } from '@/lib/demo'
import { brokenRule } from './rule-logic'
import { finalise, newSeed, type SetContext } from './generation'

/**
 * Curation of the generated set: changing a token's trait, its description, swapping, deleting
 * and shuffling ids, and reading a token's metadata attributes. Generation itself is in
 * `generation.ts`. A project can hold several collections: token ids run on across them (1 to
 * N), a token's DNA follows its own collection's layers, and uniqueness is checked within a
 * collection.
 *
 * Seam: replaced by the trait engine in `packages/dna` (Phase 3). The browser still curates; at
 * lock the final list is validated and hashed on the server (MASTER_PLAN, Art: lock check).
 */

export { finalise, newSeed, type SetContext }

/** How many tokens each collection has, by collection id. */
export function countByCollection(tokens: GeneratedToken[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token.collectionId, (counts.get(token.collectionId) ?? 0) + 1)
  return counts
}

export type ChangeOutcome = { ok: true; tokens: GeneratedToken[] } | { ok: false; reason: string }

/**
 * Sets one layer of one token to another trait, if the result is allowed: within its maximum
 * count, within the rules (the legacy tool checked uniqueness only) and unique in its collection.
 * `layerIndex` is in the token's collection.
 */
export function changeTrait(
  tokens: GeneratedToken[],
  tokenId: number,
  layerIndex: number,
  traitId: string,
  rules: ArtRule[],
  ctx: SetContext,
): ChangeOutcome {
  const { index } = ctx
  const token = tokens.find((t) => t.id === tokenId)
  if (!token) return { ok: false, reason: 'This token no longer exists.' }
  const from = index.get(token.dna[layerIndex] ?? '')?.trait
  const to = index.get(traitId)?.trait
  if (!to) return { ok: false, reason: 'That trait no longer exists.' }
  // A maximum count is a cap (MASTER_PLAN, Art: maximum counts): moving a token off it is fine, adding past it is not.
  if (to.constant && from?.id !== to.id) {
    const carrying = tokens.filter((t) => t.dna.includes(to.id)).length
    if (carrying >= to.constant)
      return {
        ok: false,
        reason: `${to.name} can appear on up to ${to.constant.toLocaleString('en-US')} tokens, and ${carrying.toLocaleString('en-US')} already have it.`,
      }
  }
  const dna = token.dna.map((id, i) => (i === layerIndex ? traitId : id))
  const broken = brokenRule(dna, rules, index)
  if (broken) return { ok: false, reason: `That breaks a rule: ${broken}` }
  // Unique within the collection: another collection may hold the same combination of names.
  const twin = tokens.find(
    (t) => t.id !== tokenId && t.collectionId === token.collectionId && t.dna.join('|') === dna.join('|'),
  )
  if (twin)
    return {
      ok: false,
      reason: `Token #${twin.id} already has exactly these traits. Every token must be unique.`,
    }
  return {
    ok: true,
    tokens: finalise(
      tokens.map((t) => (t.id === tokenId ? { ...t, dna } : t)),
      ctx,
    ),
  }
}

/** Sets one token's metadata description (legacy token details). Ranks and names do not change. */
export function setDescription(tokens: GeneratedToken[], tokenId: number, description: string) {
  return tokens.map((t) => (t.id === tokenId ? { ...t, description } : t))
}

/** Renames every token "<token name> #<id>" and re-ranks against the current layers. */
export function renameTokens(tokens: GeneratedToken[], ctx: SetContext) {
  return finalise(tokens, ctx)
}

/** Swaps the ids (positions) of two tokens. Their traits stay with them. */
export function swapIds(tokens: GeneratedToken[], a: number, b: number, ctx: SetContext) {
  return finalise(
    tokens.map((t) => (t.id === a ? { ...t, id: b } : t.id === b ? { ...t, id: a } : t)),
    ctx,
  )
}

/** Deletes tokens and closes the gaps, so ids stay 1 to N (legacy renumbering). */
export function deleteTokens(tokens: GeneratedToken[], ids: ReadonlySet<number>, ctx: SetContext) {
  return finalise(
    tokens
      .filter((t) => !ids.has(t.id))
      .sort((a, b) => a.id - b.id)
      .map((t, i) => ({ ...t, id: i + 1 })),
    ctx,
  )
}

/** Shuffles the ids among the chosen tokens (Fisher-Yates, seeded). */
export function shuffleIds(tokens: GeneratedToken[], ids: ReadonlySet<number>, ctx: SetContext) {
  const random = seededRandom(newSeed())
  const slots = tokens.filter((t) => ids.has(t.id)).map((t) => t.id)
  const order = [...slots]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[order[i], order[j]] = [order[j]!, order[i]!]
  }
  const moved = new Map(slots.map((id, i) => [id, order[i]!]))
  return finalise(
    tokens.map((t) => ({ ...t, id: moved.get(t.id) ?? t.id })),
    ctx,
  )
}

export function tokensBreakingRules(tokens: GeneratedToken[], rules: ArtRule[]): number[] {
  return tokens.filter((t) => !satisfiesRules(new Set(t.dna), rules)).map((t) => t.id)
}

export { countTraits }

/**
 * A token's metadata attributes, bottom layer first, as the render pipeline writes them. A blank
 * is left out unless the project's "blank traits in metadata" option is on, as in the legacy
 * project flag `show_blank_traits`; then it is written with the blank's name.
 *
 * Seam: the render Lambda builds the same list from the locked token list and the project flag.
 */
export function tokenAttributes(
  token: Pick<GeneratedToken, 'dna'>,
  layers: Layer[],
  index: SetContext['index'],
  showBlankTraits: boolean,
): { trait_type: string; value: string }[] {
  return layers.flatMap((layer, i) => {
    const trait = index.get(token.dna[i] ?? '')?.trait
    if (!trait || (trait.blank && !showBlankTraits)) return []
    return [{ trait_type: layer.name, value: trait.name }]
  })
}

/**
 * Whether a token matches the gallery search: a number matches ids that start with it (legacy
 * searched by name too), and text matches a layer or trait name of the token, ignoring case.
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

export type RarityTier = { key: 'legendary' | 'epic' | 'rare' | 'uncommon' | 'common'; label: string }

/** The legacy tiers by rank: top 5%, 15%, 30%, 50%, then the rest. */
export function rarityTier(rank: number, total: number): RarityTier {
  const share = rank / Math.max(1, total)
  if (share <= 0.05) return { key: 'legendary', label: 'Legendary' }
  if (share <= 0.15) return { key: 'epic', label: 'Epic' }
  if (share <= 0.3) return { key: 'rare', label: 'Rare' }
  if (share <= 0.5) return { key: 'uncommon', label: 'Uncommon' }
  return { key: 'common', label: 'Common' }
}

export const TIER_RANGES: Record<RarityTier['key'], string> = {
  legendary: 'Top 5%',
  epic: 'Top 15%',
  rare: 'Top 30%',
  uncommon: 'Top 50%',
  common: 'The rest',
}

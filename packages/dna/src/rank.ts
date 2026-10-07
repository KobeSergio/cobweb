import type { Ranked, TokenCore } from './types'

/**
 * Ranks tokens by rarity, 1 the rarest: a token's score is the sum over its DNA of
 * (tokens / tokens with that attribute), attributes counted by `keyOf` (layer and trait name, so
 * the same attribute in two collections is one). Blanks and unknown ids count as attributes of their
 * own. No division by layer count, so it ranks like marketplaces do. Ties go to the lower id. The
 * result keeps the input order and every extra field.
 */
export function rankTokens<T extends TokenCore>(
  tokens: T[],
  keyOf: (traitId: string) => string,
): Ranked<T>[] {
  const counts = new Map<string, number>()
  for (const token of tokens)
    for (const traitId of token.dna) counts.set(keyOf(traitId), (counts.get(keyOf(traitId)) ?? 0) + 1)
  const total = tokens.length
  const scored = tokens.map((token) => ({
    token,
    score: token.dna.reduce((sum, traitId) => sum + total / (counts.get(keyOf(traitId)) ?? 1), 0),
  }))
  const order = [...scored].sort((a, b) => b.score - a.score || a.token.id - b.token.id)
  const rankById = new Map(order.map((entry, i) => [entry.token.id, i + 1]))
  return tokens.map((token) => ({ ...token, rank: rankById.get(token.id)! }))
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

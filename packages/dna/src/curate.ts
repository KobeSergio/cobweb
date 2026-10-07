import { satisfiesRules } from './rules'
import type { ArtRule, AtLeastOne, Layer, Shortfall, TokenCore, TraitCounts } from './types'

/** The full DNA within its collection: finds a token with exactly these traits. */
export function dnaKey(token: Pick<TokenCore, 'collectionId' | 'dna'>): string {
  return `${token.collectionId}:${token.dna.join('|')}`
}

/** The key a token is unique under: its DNA with every `bypassDna` layer's entry replaced by `*`. */
export function uniqueKey(dna: readonly string[], layers: Layer[]): string {
  return dna.map((traitId, i) => (layers[i]?.bypassDna ? '*' : traitId)).join('|')
}

export function countTraits(tokens: Pick<TokenCore, 'dna'>[]): TraitCounts {
  const counts: TraitCounts = {}
  for (const token of tokens) for (const traitId of token.dna) counts[traitId] = (counts[traitId] ?? 0) + 1
  return counts
}

/** Fixed-quantity traits that came out below their cap, with the count reached. */
export function cappedShortfalls(layers: Layer[], counts: TraitCounts): Shortfall[] {
  return layers.flatMap((layer) =>
    layer.traits.flatMap((trait) => {
      const actual = counts[trait.id] ?? 0
      return trait.constant && actual < trait.constant ? [{ trait, cap: trait.constant, actual }] : []
    }),
  )
}

export function tokensBreakingRules(
  tokens: TokenCore[],
  rules: ArtRule[],
  atLeastOne: AtLeastOne[] = [],
): number[] {
  return tokens
    .filter(
      (t) =>
        !satisfiesRules(
          new Set(t.dna),
          rules,
          atLeastOne.filter((c) => c.collectionId === t.collectionId),
        ),
    )
    .map((t) => t.id)
}

/** How many tokens each collection has, by collection id, in first-seen order. */
export function countByCollection(tokens: TokenCore[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token.collectionId, (counts.get(token.collectionId) ?? 0) + 1)
  return counts
}

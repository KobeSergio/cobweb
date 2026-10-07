import { buildTraitIndex, layersOf, type TraitIndex } from './index-of'
import { seededRandom, shuffle } from './random'
import { activeProjectRules, brokenRule, constraintsOf, satisfiesRules } from './rules'
import type { ArtRule, AtLeastOne, Layer, Project, Shortfall, TokenCore, TraitCounts } from './types'

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

export type ChangeOutcome<T extends TokenCore> = { ok: true; tokens: T[] } | { ok: false; reason: string }

/**
 * Sets one layer of one token to another trait, if the result is allowed: within the trait's cap,
 * within the active rules and constraints, and unique in its collection. `layerIndex` is in the
 * token's collection. Ranks and names are not touched; the caller re-ranks.
 */
export function changeTrait<T extends TokenCore>(
  tokens: T[],
  tokenId: number,
  layerIndex: number,
  traitId: string,
  project: Pick<Project, 'layers' | 'rules' | 'atLeastOne'>,
  index: TraitIndex = buildTraitIndex(project.layers),
): ChangeOutcome<T> {
  const token = tokens.find((t) => t.id === tokenId)
  if (!token) return { ok: false, reason: 'This token no longer exists.' }
  const from = index.get(token.dna[layerIndex] ?? '')?.trait
  const to = index.get(traitId)?.trait
  if (!to) return { ok: false, reason: 'That trait no longer exists.' }
  if (to.constant && from?.id !== to.id) {
    const carrying = tokens.filter((t) => t.dna.includes(to.id)).length
    if (carrying >= to.constant)
      return {
        ok: false,
        reason: `${to.name} can appear on up to ${to.constant.toLocaleString('en-US')} tokens, and ${carrying.toLocaleString('en-US')} already have it.`,
      }
  }
  const dna = token.dna.map((id, i) => (i === layerIndex ? traitId : id))
  const broken = brokenRule(
    dna,
    activeProjectRules(project, index),
    index,
    constraintsOf(project.atLeastOne, token.collectionId),
  )
  if (broken) return { ok: false, reason: `That breaks a rule: ${broken}` }
  const own = layersOf(project.layers, token.collectionId)
  const key = uniqueKey(dna, own)
  const twin = tokens.find(
    (t) => t.id !== tokenId && t.collectionId === token.collectionId && uniqueKey(t.dna, own) === key,
  )
  if (twin)
    return {
      ok: false,
      reason: `Token #${twin.id} already has exactly these traits. Every token must be unique.`,
    }
  return { ok: true, tokens: tokens.map((t) => (t.id === tokenId ? { ...t, dna } : t)) }
}

/** Swaps the ids of two tokens. Their traits stay with them. */
export function swapIds<T extends TokenCore>(tokens: T[], a: number, b: number): T[] {
  return tokens.map((t) => (t.id === a ? { ...t, id: b } : t.id === b ? { ...t, id: a } : t))
}

/** Deletes tokens and closes the gaps, so ids stay 1 to N. */
export function deleteTokens<T extends TokenCore>(tokens: T[], ids: ReadonlySet<number>): T[] {
  return tokens
    .filter((t) => !ids.has(t.id))
    .sort((a, b) => a.id - b.id)
    .map((t, i) => ({ ...t, id: i + 1 }))
}

/** Shuffles the ids among the chosen tokens, deterministically from the seed. */
export function shuffleIds<T extends TokenCore>(tokens: T[], ids: ReadonlySet<number>, seed: number): T[] {
  const slots = tokens.filter((t) => ids.has(t.id)).map((t) => t.id)
  const order = shuffle(slots, seededRandom(seed))
  const moved = new Map(slots.map((id, i) => [id, order[i]!]))
  return tokens.map((t) => ({ ...t, id: moved.get(t.id) ?? t.id }))
}

import { countTraits, generateTokens, rankTokens, satisfiesRules, seededRandom } from '@/lib/demo/art'
import type { ArtRule, GeneratedToken, Layer, Trait } from '@/lib/demo'
import { brokenRule } from './rule-logic'
import { constantTotal, weightedTraits, weightsValid, type TraitIndex } from '../lib/trait-index'

/**
 * Generation and curation of the token set, on top of the seeded sample generator in
 * `lib/demo/art.ts`.
 *
 * Seam: replaced by the trait engine in `packages/dna` (Phase 3). The browser still curates; at
 * lock the final list is validated and hashed on the server (MASTER_PLAN, Art: lock check).
 */

type Draft = Omit<GeneratedToken, 'rank' | 'previewUrl'>

/** Ranks the set (1 is rarest) and names every token after the collection. */
export function finalise(tokens: Draft[], collectionName: string): GeneratedToken[] {
  const sorted = [...tokens].sort((a, b) => a.id - b.id)
  // Composites are always stacked from the current layers, so the sample previews are not used.
  return rankTokens(sorted).map((token) => ({
    ...token,
    name: `${collectionName} #${token.id}`,
    previewUrl: null,
  }))
}

/** Problems that stop a full generation, worded for the creator. */
export function generationProblems(layers: Layer[], supply: number): string[] {
  const problems: string[] = []
  if (layers.length === 0) problems.push('Add at least one layer on the Layers step.')
  for (const layer of layers) {
    if (layer.traits.length === 0) problems.push(`${layer.name} has no traits yet.`)
    else if (!weightsValid(layer)) problems.push(`The weights in ${layer.name} do not add up to 100%.`)
    if (constantTotal(layer) > supply)
      problems.push(`The fixed quantities in ${layer.name} add up to more than the supply.`)
  }
  if (problems.length === 0) {
    const combinations = layers.reduce(
      (product, layer) => product * layer.traits.filter((t) => t.constant || t.weight > 0).length,
      1,
    )
    if (combinations < supply)
      problems.push(
        `These layers make at most ${combinations.toLocaleString('en-US')} different tokens, fewer than the supply of ${supply.toLocaleString('en-US')}. Add traits or lower the supply.`,
      )
  }
  return problems
}

export type GenerateOutcome = { ok: true; tokens: GeneratedToken[] } | { ok: false; problems: string[] }

export function generateSet(
  layers: Layer[],
  rules: ArtRule[],
  supply: number,
  seed: number,
  collectionName: string,
): GenerateOutcome {
  const problems = generationProblems(layers, supply)
  if (problems.length) return { ok: false, problems }
  const drafts = generateTokens(layers, rules, supply, seed)
  const unique = new Set(drafts.map((token) => token.dna.join('|'))).size
  const breaking = drafts.filter((token) => !satisfiesRules(new Set(token.dna), rules)).length
  if (unique < supply || breaking > 0) {
    return {
      ok: false,
      problems: [
        `With these rules only ${(unique - breaking).toLocaleString('en-US')} of ${supply.toLocaleString('en-US')} tokens could be made unique and within the rules. Loosen a rule, add traits, or lower the supply.`,
      ],
    }
  }
  return { ok: true, tokens: finalise(drafts, collectionName) }
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
  taken: ReadonlySet<string>,
  random: () => number,
): string[] | null {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const dna = layers.map((layer, i) => {
      const kept = layer.traits.find((trait) => trait.id === current?.[i] && trait.constant)
      return (kept ?? pick(weightedTraits(layer), random))?.id ?? ''
    })
    if (dna.includes('')) return null
    if (!taken.has(dna.join('|')) && satisfiesRules(new Set(dna), rules)) return dna
  }
  return null
}

export function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

/** Re-rolls the chosen tokens, keeping their ids. All or nothing, like the legacy tool. */
export function regenerate(
  tokens: GeneratedToken[],
  ids: ReadonlySet<number>,
  layers: Layer[],
  rules: ArtRule[],
  collectionName: string,
): GeneratedToken[] | null {
  const random = seededRandom(newSeed())
  const taken = new Set(tokens.filter((t) => !ids.has(t.id)).map((t) => t.dna.join('|')))
  const next: Draft[] = []
  for (const token of tokens) {
    if (!ids.has(token.id)) {
      next.push(token)
      continue
    }
    const dna = roll(token.dna, layers, rules, taken, random)
    if (!dna) return null
    taken.add(dna.join('|'))
    next.push({ id: token.id, name: token.name, dna })
  }
  return finalise(next, collectionName)
}

/** Adds new tokens after the last id until the set reaches `supply`. */
export function fillTo(
  tokens: GeneratedToken[],
  supply: number,
  layers: Layer[],
  rules: ArtRule[],
  collectionName: string,
): GeneratedToken[] | null {
  const random = seededRandom(newSeed())
  const taken = new Set(tokens.map((t) => t.dna.join('|')))
  const next: Draft[] = [...tokens]
  for (let id = tokens.length + 1; id <= supply; id++) {
    const dna = roll(null, layers, rules, taken, random)
    if (!dna) return null
    taken.add(dna.join('|'))
    next.push({ id, name: '', dna })
  }
  return finalise(next, collectionName)
}

export type ChangeOutcome = { ok: true; tokens: GeneratedToken[] } | { ok: false; reason: string }

/** Sets one layer of one token to another trait, if the result is allowed. */
export function changeTrait(
  tokens: GeneratedToken[],
  tokenId: number,
  layerIndex: number,
  traitId: string,
  rules: ArtRule[],
  index: TraitIndex,
  collectionName: string,
): ChangeOutcome {
  const token = tokens.find((t) => t.id === tokenId)
  if (!token) return { ok: false, reason: 'This token no longer exists.' }
  const from = index.get(token.dna[layerIndex] ?? '')?.trait
  const to = index.get(traitId)?.trait
  if (!to) return { ok: false, reason: 'That trait no longer exists.' }
  // A maximum count is a cap (MASTER_PLAN, Art: maximum counts): moving a token off it is fine, adding past it is not.
  if (to.constant && from?.id !== to.id) {
    const carrying = tokens.filter((t) => t.dna[layerIndex] === to.id).length
    if (carrying >= to.constant)
      return {
        ok: false,
        reason: `${to.name} can appear on up to ${to.constant.toLocaleString('en-US')} tokens, and ${carrying.toLocaleString('en-US')} already have it.`,
      }
  }
  const dna = token.dna.map((id, i) => (i === layerIndex ? traitId : id))
  const broken = brokenRule(dna, rules, index)
  if (broken) return { ok: false, reason: `That breaks a rule: ${broken}` }
  const twin = tokens.find((t) => t.id !== tokenId && t.dna.join('|') === dna.join('|'))
  if (twin)
    return {
      ok: false,
      reason: `Token #${twin.id} already has exactly these traits. Every token must be unique.`,
    }
  return {
    ok: true,
    tokens: finalise(
      tokens.map((t) => (t.id === tokenId ? { ...t, dna } : t)),
      collectionName,
    ),
  }
}

/** Swaps the ids (positions) of two tokens. Their traits stay with them. */
export function swapIds(tokens: GeneratedToken[], a: number, b: number, collectionName: string) {
  return finalise(
    tokens.map((t) => (t.id === a ? { ...t, id: b } : t.id === b ? { ...t, id: a } : t)),
    collectionName,
  )
}

/** Deletes tokens and closes the gaps, so ids stay 1 to N. */
export function deleteTokens(tokens: GeneratedToken[], ids: ReadonlySet<number>, collectionName: string) {
  return finalise(
    tokens
      .filter((t) => !ids.has(t.id))
      .sort((a, b) => a.id - b.id)
      .map((t, i) => ({ ...t, id: i + 1 })),
    collectionName,
  )
}

/** Shuffles the ids among the chosen tokens (Fisher-Yates, seeded). */
export function shuffleIds(tokens: GeneratedToken[], ids: ReadonlySet<number>, collectionName: string) {
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
    collectionName,
  )
}

export function tokensBreakingRules(tokens: GeneratedToken[], rules: ArtRule[]): number[] {
  return tokens.filter((t) => !satisfiesRules(new Set(t.dna), rules)).map((t) => t.id)
}

export { countTraits }

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

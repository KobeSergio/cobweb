import { countTraits, generateCollections, rankTokens, satisfiesRules, seededRandom } from '@/lib/demo/art'
import type { ArtRule, Collection, GeneratedToken, Layer, Trait } from '@/lib/demo'
import { layersOf } from './layer-edits'
import { brokenRule } from './rule-logic'
import { constantTotal, weightedTraits, weightsValid, type TraitIndex } from '../lib/trait-index'

/**
 * Generation and curation of the token set, on top of the seeded sample generator in
 * `lib/demo/art.ts`. A project can hold several collections: token ids run on across them (1 to N),
 * a token's DNA follows its own collection's layers, and uniqueness is checked within a collection.
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
export function generationProblems(layers: Layer[], collections: Collection[]): string[] {
  const problems: string[] = []
  const several = collections.length > 1
  if (collections.length === 0) problems.push('Add a collection on the Layers step.')
  for (const collection of collections) {
    const own = layersOf(layers, collection.id)
    const where = several ? ` in ${collection.name}` : ''
    if (collection.size < 1) {
      problems.push(`Set a size for ${collection.name}.`)
      continue
    }
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
function dnaKey(token: Pick<GeneratedToken, 'collectionId' | 'dna'>): string {
  return `${token.collectionId}:${token.dna.join('|')}`
}

/** Generates every collection to its size, ids running on from one collection to the next. */
export function generateSet(
  layers: Layer[],
  rules: ArtRule[],
  collections: Collection[],
  seed: number,
  collectionName: string,
): GenerateOutcome {
  const problems = generationProblems(layers, collections)
  if (problems.length) return { ok: false, problems }
  const drafts = generateCollections(layers, rules, collections, seed)
  const supply = drafts.length
  const unique = new Set(drafts.map(dnaKey)).size
  const breaking = drafts.filter((token) => !satisfiesRules(new Set(token.dna), rules)).length
  if (unique < supply || breaking > 0) {
    return {
      ok: false,
      problems: [
        `With these rules only ${(unique - breaking).toLocaleString('en-US')} of ${supply.toLocaleString('en-US')} tokens could be made unique and within the rules. Loosen a rule, add traits, or lower a size.`,
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
  isTaken: (dna: string) => boolean,
  random: () => number,
): string[] | null {
  for (let attempt = 0; attempt < 2000; attempt++) {
    const dna = layers.map((layer, i) => {
      const kept = layer.traits.find((trait) => trait.id === current?.[i] && trait.constant)
      return (kept ?? pick(weightedTraits(layer), random))?.id ?? ''
    })
    if (dna.includes('')) return null
    if (!isTaken(dna.join('|')) && satisfiesRules(new Set(dna), rules)) return dna
  }
  return null
}

export function newSeed(): number {
  return Math.floor(Math.random() * 0xffffffff)
}

/** Re-rolls the chosen tokens, keeping their ids and collections. All or nothing, like the legacy tool. */
export function regenerate(
  tokens: GeneratedToken[],
  ids: ReadonlySet<number>,
  layers: Layer[],
  rules: ArtRule[],
  collectionName: string,
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
    next.push({ id: token.id, name: token.name, collectionId: token.collectionId, dna })
  }
  return finalise(next, collectionName)
}

/** Whether a DNA is taken within one collection, from the project-wide set of `dnaKey`s. */
function keyedTaken(taken: ReadonlySet<string>, collectionId: string) {
  return (dna: string) => taken.has(`${collectionId}:${dna}`)
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
  collectionName: string,
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
      next.push({ id: ++id, name: '', collectionId: collection.id, dna })
    }
  }
  return finalise(next, collectionName)
}

/** How many tokens each collection has, by collection id. */
export function countByCollection(tokens: GeneratedToken[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const token of tokens) counts.set(token.collectionId, (counts.get(token.collectionId) ?? 0) + 1)
  return counts
}

export type ChangeOutcome = { ok: true; tokens: GeneratedToken[] } | { ok: false; reason: string }

/** Sets one layer of one token to another trait, if the result is allowed. `layerIndex` is in the token's collection. */
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

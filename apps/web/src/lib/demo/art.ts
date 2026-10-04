/**
 * The "Night Owls" sample project: its two collections, their layers and rules, and a seeded generator.
 *
 * This file has no runtime imports (type imports only), so `scripts/make-demo-art.mjs` can load it
 * with plain node and draw exactly the tokens the app lists. Keep it that way.
 */
import type { ArtRule, Collection, GeneratedToken, Layer, RuleConflict, Trait, TraitCounts } from './types'

/**
 * The project holds two collections, as a legacy project could (for example male and female):
 * grown owls and a smaller set of owlets drawn from a subset of the same art. Token ids run on
 * across them, 1 to 600 then 601 to 777.
 */
export const DEMO_COLLECTIONS: Collection[] = [
  { id: 'owls', name: 'Owls', size: 600 },
  { id: 'owlets', name: 'Owlets', size: 177 },
]
export const DEMO_TOKEN_COUNT = DEMO_COLLECTIONS.reduce((sum, collection) => sum + collection.size, 0)
/** Tokens 1 to this have a pre-rendered composite at `/demo/tokens/<id>.svg`. */
export const DEMO_PREVIEW_COUNT = 24
const SEED = 0x0a7115

type TraitSpec = { name: string; weight: number; constant?: number; blank?: boolean }
type LayerSpec = { name: string; traits: TraitSpec[] }

/** Layers bottom first. Weights of the non-constant traits sum to 100 in each layer. */
const OWLS_SPEC: LayerSpec[] = [
  {
    name: 'Background',
    traits: [
      { name: 'Dusk', weight: 20 },
      { name: 'Moss', weight: 18 },
      { name: 'Clay', weight: 16 },
      { name: 'Slate', weight: 16 },
      { name: 'Plum', weight: 14 },
      { name: 'Ink', weight: 10 },
      { name: 'Sand', weight: 6 },
    ],
  },
  {
    name: 'Body',
    traits: [
      { name: 'Barn', weight: 26 },
      { name: 'Tawny', weight: 22 },
      { name: 'Ash', weight: 18 },
      { name: 'Snowy', weight: 14 },
      { name: 'Ember', weight: 12 },
      { name: 'Midnight', weight: 8 },
      { name: 'Golden', weight: 0, constant: 7 },
    ],
  },
  {
    name: 'Belly',
    traits: [
      { name: 'Plain', weight: 34 },
      { name: 'Speckled', weight: 24 },
      { name: 'Chevron', weight: 20 },
      { name: 'Scalloped', weight: 16 },
      { name: 'Heart', weight: 6 },
    ],
  },
  {
    name: 'Eyes',
    traits: [
      { name: 'Wide', weight: 24 },
      { name: 'Sleepy', weight: 16 },
      { name: 'Glance', weight: 15 },
      { name: 'Wink', weight: 12 },
      { name: 'Squint', weight: 11 },
      { name: 'Jade', weight: 10 },
      { name: 'Hypno', weight: 6 },
      { name: 'Starry', weight: 6 },
    ],
  },
  {
    name: 'Beak',
    traits: [
      { name: 'Classic', weight: 36 },
      { name: 'Ivory', weight: 22 },
      { name: 'Tiny', weight: 18 },
      { name: 'Rose', weight: 14 },
      { name: 'Charcoal', weight: 10 },
    ],
  },
  {
    name: 'Headwear',
    traits: [
      { name: 'None', weight: 34, blank: true },
      { name: 'Beanie', weight: 16 },
      { name: 'Sprout', weight: 14 },
      { name: 'Headphones', weight: 12 },
      { name: 'Crown', weight: 8 },
      { name: 'Wizard Hat', weight: 9 },
      { name: 'Halo', weight: 7 },
    ],
  },
  {
    name: 'Accessory',
    traits: [
      { name: 'None', weight: 38, blank: true },
      { name: 'Scarf', weight: 18 },
      { name: 'Bow Tie', weight: 14 },
      { name: 'Pendant', weight: 11 },
      { name: 'Monocle', weight: 9 },
      { name: 'Lantern', weight: 6 },
      { name: 'Book', weight: 4 },
    ],
  },
]

/** The owlets: the same seven layers with fewer traits, so they read as a set of their own. */
const OWLETS_SPEC: LayerSpec[] = [
  {
    name: 'Background',
    traits: [
      { name: 'Dusk', weight: 40 },
      { name: 'Moss', weight: 35 },
      { name: 'Sand', weight: 25 },
    ],
  },
  {
    name: 'Body',
    traits: [
      { name: 'Snowy', weight: 40 },
      { name: 'Ash', weight: 35 },
      { name: 'Tawny', weight: 25 },
    ],
  },
  {
    name: 'Belly',
    traits: [
      { name: 'Plain', weight: 60 },
      { name: 'Speckled', weight: 40 },
    ],
  },
  {
    name: 'Eyes',
    traits: [
      { name: 'Wide', weight: 45 },
      { name: 'Sleepy', weight: 35 },
      { name: 'Wink', weight: 20 },
    ],
  },
  {
    name: 'Beak',
    traits: [
      { name: 'Tiny', weight: 60 },
      { name: 'Rose', weight: 40 },
    ],
  },
  {
    name: 'Headwear',
    traits: [
      { name: 'None', weight: 50, blank: true },
      { name: 'Beanie', weight: 25 },
      { name: 'Sprout', weight: 25 },
    ],
  },
  {
    name: 'Accessory',
    traits: [
      { name: 'None', weight: 55, blank: true },
      { name: 'Scarf', weight: 25 },
      { name: 'Bow Tie', weight: 20 },
    ],
  },
]

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Builds a collection's layers. Ids carry the collection's prefix so trait ids stay unique in the
 * project (the first collection has none, so its ids read `eyes-starry`); images are shared by name.
 */
function buildLayers(collectionId: string, prefix: string, spec: LayerSpec[]): Layer[] {
  return spec.map((layer, position) => {
    const art = slugify(layer.name)
    const layerId = `${prefix}${art}`
    return {
      id: layerId,
      collectionId,
      name: layer.name,
      position,
      traits: layer.traits.map((trait): Trait => ({
        id: `${layerId}-${slugify(trait.name)}`,
        layerId,
        name: trait.name,
        weight: trait.weight,
        ...(trait.constant ? { constant: trait.constant } : {}),
        blank: trait.blank ?? false,
        imageUrl: trait.blank ? null : `/demo/layers/${art}/${slugify(trait.name)}.svg`,
      })),
    }
  })
}

/** Every layer of the project, grouped by collection in collection order, each group bottom first. */
export const DEMO_LAYERS: Layer[] = [
  ...buildLayers('owls', '', OWLS_SPEC),
  ...buildLayers('owlets', 'owlets-', OWLETS_SPEC),
]

/**
 * Rules of all three kinds. `rule-starry-wizard` deliberately contradicts `rule-wizard-starry`. The
 * last one belongs to the owlets: a rule applies within the collection of the traits it names.
 */
export const DEMO_RULES: ArtRule[] = [
  {
    id: 'rule-monocle-eyes',
    kind: "doesn't mix with",
    traitId: 'accessory-monocle',
    relatedTraitIds: ['eyes-sleepy', 'eyes-wink', 'eyes-squint'],
    bidirectional: true,
  },
  {
    id: 'rule-wizard-starry',
    kind: 'always pairs with',
    traitId: 'headwear-wizard-hat',
    relatedTraitIds: ['eyes-starry'],
    bidirectional: true,
  },
  {
    id: 'rule-lantern-night',
    kind: 'must pair with',
    traitId: 'accessory-lantern',
    relatedTraitIds: ['background-ink', 'background-plum', 'background-dusk'],
    bidirectional: false,
  },
  {
    id: 'rule-ember-clay',
    kind: "doesn't mix with",
    traitId: 'body-ember',
    relatedTraitIds: ['background-clay'],
    bidirectional: true,
  },
  {
    id: 'rule-midnight-dark',
    kind: "doesn't mix with",
    traitId: 'body-midnight',
    relatedTraitIds: ['background-ink', 'background-slate'],
    bidirectional: true,
  },
  {
    id: 'rule-starry-wizard',
    kind: "doesn't mix with",
    traitId: 'eyes-starry',
    relatedTraitIds: ['headwear-wizard-hat'],
    bidirectional: true,
  },
  {
    id: 'rule-owlets-sprout-moss',
    kind: 'must pair with',
    traitId: 'owlets-headwear-sprout',
    relatedTraitIds: ['owlets-background-moss'],
    bidirectional: false,
  },
]

/** What the Rules screen's analyser reports for `DEMO_RULES`. */
export const DEMO_RULE_CONFLICTS: RuleConflict[] = [
  {
    kind: 'mixing',
    ruleIds: ['rule-wizard-starry', 'rule-starry-wizard'],
    message:
      'Wizard Hat always pairs with Starry eyes, but Starry eyes do not mix with Wizard Hat. Neither trait can appear in any token. Remove one of the two rules.',
  },
]

/** A small seeded PRNG (mulberry32). Same seed, same sequence, on the server and in the browser. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pickWeighted(traits: Trait[], random: () => number): Trait {
  const weighted = traits.filter((trait) => !trait.constant && trait.weight > 0)
  let roll = random() * 100
  for (const trait of weighted) {
    roll -= trait.weight
    if (roll < 0) return trait
  }
  return weighted[weighted.length - 1]!
}

/** Whether a set of trait ids satisfies the rules. */
export function satisfiesRules(traitIds: ReadonlySet<string>, rules: ArtRule[]): boolean {
  for (const rule of rules) {
    const hasTrait = traitIds.has(rule.traitId)
    const hasRelated = rule.relatedTraitIds.some((id) => traitIds.has(id))
    if (rule.kind === "doesn't mix with" && hasTrait && hasRelated) return false
    if (rule.kind === 'must pair with' && hasTrait && !hasRelated) return false
    if (rule.kind === 'always pairs with' && hasTrait !== hasRelated) return false
  }
  return true
}

/**
 * How many rolls one token gets before the generator gives up on it, as in the legacy generator
 * (10,000 failed attempts in a row). A collection stops at the first token it cannot make, and
 * the creator is told how many it could make ("can only generate X").
 */
export const MAX_ATTEMPTS = 10_000

/**
 * Pairing rules would reject most rolls if left to chance, so a trait that needs a partner gets
 * one: the partner's layer is switched to one of the related traits (and, for "always pairs
 * with", a related trait that appears alone pulls in its source trait).
 */
export function repairPairs(
  dna: string[],
  layers: Layer[],
  rules: ArtRule[],
  random: () => number,
): string[] {
  const next = [...dna]
  const layerIndex = (traitId: string) =>
    layers.findIndex((layer) => layer.traits.some((t) => t.id === traitId))
  // A fixed-quantity trait is never pulled in by a rule: its count is capped, and only the
  // up-front placement in `generateTokens` hands it out.
  const isCapped = (traitId: string) =>
    layers.some((layer) => layer.traits.some((t) => t.id === traitId && t.constant))
  const place = (traitId: string) => {
    const index = layerIndex(traitId)
    if (index !== -1 && !isCapped(traitId)) next[index] = traitId
  }
  for (const rule of rules) {
    if (rule.kind === "doesn't mix with") continue
    const hasTrait = next.includes(rule.traitId)
    const hasRelated = rule.relatedTraitIds.some((id) => next.includes(id))
    if (hasTrait && !hasRelated) {
      place(rule.relatedTraitIds[Math.floor(random() * rule.relatedTraitIds.length)]!)
    } else if (rule.kind === 'always pairs with' && hasRelated && !hasTrait) {
      place(rule.traitId)
    }
  }
  return next
}

/**
 * Generates `count` unique tokens of one collection that satisfy the rules, deterministically from
 * the seed. `layers` are that collection's layers; ids start at `firstId`.
 * A fixed quantity is a cap (MASTER_PLAN, Art: maximum counts): the trait lands on at most its count of tokens. Each
 * one is offered to a token up front; when no unique token within the rules can carry it, that
 * token is rolled without it and the trait ends below its cap (`cappedShortfalls` reports it).
 * Rules named in a conflict are skipped, as the generator would refuse them.
 * When a token cannot be made unique and within the rules in `MAX_ATTEMPTS` rolls, the collection
 * stops there and returns fewer than `count` tokens, as the legacy generator did.
 */
export function generateTokens(
  layers: Layer[],
  rules: ArtRule[],
  count: number,
  seed: number = SEED,
  firstId = 1,
): Omit<GeneratedToken, 'rank' | 'previewUrl'>[] {
  const random = seededRandom(seed)
  const collectionId = layers[0]?.collectionId ?? ''
  const conflicted = new Set(DEMO_RULE_CONFLICTS.flatMap((conflict) => conflict.ruleIds.slice(1)))
  const activeRules = rules.filter((rule) => !conflicted.has(rule.id))

  // Constant traits: choose which token indices carry them up front.
  const forced = new Map<number, Trait[]>()
  for (const layer of layers) {
    for (const trait of layer.traits) {
      if (!trait.constant) continue
      let placed = 0
      while (placed < trait.constant) {
        const index = Math.floor(random() * count)
        const existing = forced.get(index) ?? []
        if (existing.some((other) => other.layerId === trait.layerId)) continue
        forced.set(index, [...existing, trait])
        placed++
      }
    }
  }

  const seen = new Set<string>()
  const tokens: Omit<GeneratedToken, 'rank' | 'previewUrl'>[] = []
  const roll = (fixed: Trait[]): string[] | null => {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      let dna = layers.map(
        (layer) =>
          (fixed.find((trait) => trait.layerId === layer.id) ?? pickWeighted(layer.traits, random)).id,
      )
      dna = repairPairs(dna, layers, activeRules, random)
      if (!seen.has(dna.join('|')) && satisfiesRules(new Set(dna), activeRules)) return dna
    }
    return null
  }
  for (let index = 0; index < count; index++) {
    const fixed = forced.get(index) ?? []
    // With its capped traits if possible; else without them, so the trait ends below its cap.
    const dna = roll(fixed) ?? (fixed.length ? roll([]) : null)
    if (!dna) break
    seen.add(dna.join('|'))
    const id = firstId + index
    tokens.push({ id, name: `Night Owls #${id}`, collectionId, dna })
  }
  return tokens
}

/** The seed for the collection at `position`. The first collection uses the project seed itself. */
export function collectionSeed(seed: number, position: number): number {
  return (seed + position * 0x9e3779b9) >>> 0
}

/**
 * Generates every collection in order, each to its size. Token ids run on across collections (the
 * second starts after the last id of the first), uniqueness is checked within each collection, and
 * a rule only ever touches the collection its traits belong to.
 */
export function generateCollections(
  layers: Layer[],
  rules: ArtRule[],
  collections: Pick<Collection, 'id' | 'size'>[],
  seed: number = SEED,
): Omit<GeneratedToken, 'rank' | 'previewUrl'>[] {
  const tokens: Omit<GeneratedToken, 'rank' | 'previewUrl'>[] = []
  collections.forEach((collection, position) => {
    const own = layers.filter((layer) => layer.collectionId === collection.id)
    tokens.push(
      ...generateTokens(own, rules, collection.size, collectionSeed(seed, position), tokens.length + 1),
    )
  })
  return tokens
}

export function countTraits(tokens: Pick<GeneratedToken, 'dna'>[]): TraitCounts {
  const counts: TraitCounts = {}
  for (const token of tokens) for (const traitId of token.dna) counts[traitId] = (counts[traitId] ?? 0) + 1
  return counts
}

/** Fixed-quantity traits that came out below their cap in a set, with the count reached. */
export function cappedShortfalls(
  layers: Layer[],
  counts: TraitCounts,
): { trait: Trait; cap: number; actual: number }[] {
  return layers.flatMap((layer) =>
    layer.traits.flatMap((trait) => {
      const actual = counts[trait.id] ?? 0
      return trait.constant && actual < trait.constant ? [{ trait, cap: trait.constant, actual }] : []
    }),
  )
}

/**
 * The key a trait is counted under for rarity: its layer name and its own name, as they appear in
 * the metadata (`trait_type`, `value`). The same pair in two collections is one attribute.
 */
export function attributeKey(layerName: string, traitName: string): string {
  return JSON.stringify([layerName, traitName])
}

/**
 * Ranks tokens by rarity, 1 the rarest, with the legacy formula: for each token, the sum over its
 * traits of (tokens / tokens with that attribute), divided by its layer count. Ranked across the
 * whole project. Attributes are counted by `keyOf` (layer and trait name), summed across
 * collections; the legacy generator meant to do the same but an operator precedence slip kept the
 * first collection's count only. Blanks count as an attribute. Ties go to the lower id.
 */
export function rankTokens(
  tokens: Omit<GeneratedToken, 'rank' | 'previewUrl'>[],
  keyOf: (traitId: string) => string = demoAttributeKey,
): GeneratedToken[] {
  const counts = new Map<string, number>()
  for (const token of tokens)
    for (const traitId of token.dna) counts.set(keyOf(traitId), (counts.get(keyOf(traitId)) ?? 0) + 1)
  const total = tokens.length
  const scored = tokens.map((token) => ({
    token,
    score:
      token.dna.reduce((sum, traitId) => sum + total / (counts.get(keyOf(traitId)) ?? 1), 0) /
      Math.max(1, token.dna.length),
  }))
  const order = [...scored].sort((a, b) => b.score - a.score || a.token.id - b.token.id)
  const rankById = new Map(order.map((entry, index) => [entry.token.id, index + 1]))
  return tokens.map((token) => ({
    ...token,
    rank: rankById.get(token.id)!,
    previewUrl: token.id <= DEMO_PREVIEW_COUNT ? `/demo/tokens/${token.id}.svg` : null,
  }))
}

const TRAITS_BY_ID = new Map(DEMO_LAYERS.flatMap((layer) => layer.traits).map((trait) => [trait.id, trait]))
const LAYER_NAMES = new Map(DEMO_LAYERS.map((layer) => [layer.id, layer.name]))

/** `attributeKey` for the sample layers; an unknown id counts as an attribute of its own. */
function demoAttributeKey(traitId: string): string {
  const trait = TRAITS_BY_ID.get(traitId)
  return trait ? attributeKey(LAYER_NAMES.get(trait.layerId) ?? '', trait.name) : traitId
}

export function getTrait(traitId: string): Trait | undefined {
  return TRAITS_BY_ID.get(traitId)
}

/**
 * The layer images to stack, bottom first, for a token's DNA: render each as an absolutely
 * positioned `<img>` in one square box. Blanks are left out.
 */
export function tokenLayerUrls(dna: string[]): string[] {
  return dna.flatMap((traitId) => {
    const url = TRAITS_BY_ID.get(traitId)?.imageUrl
    return url ? [url] : []
  })
}

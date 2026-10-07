/**
 * The "Night Owls" sample project: its two collections, their layers and rules, and a seeded generator.
 *
 * This file has no runtime imports (type imports only), so `scripts/make-demo-art.mjs` can load it
 * with plain node and draw exactly the tokens the app lists. Keep it that way.
 */
import type { ArtRule, Collection, Layer, RuleConflict, Trait } from './types'

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
export const DEMO_SEED = 0x0a7115

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

const TRAITS_BY_ID = new Map(DEMO_LAYERS.flatMap((layer) => layer.traits).map((trait) => [trait.id, trait]))
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

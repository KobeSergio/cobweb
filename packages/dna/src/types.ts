/**
 * The shapes the trait engine works on. The web app re-exports them from `@/lib/demo`, so the
 * creator screens render these same types. Weights are percents; ids are strings unique within a
 * project; token ids are numbers from 1.
 */

/** One trait of a layer. */
export type Trait = {
  /** Unique within the project, e.g. `eyes-starry`. DNA and rules refer to traits by this id. */
  id: string
  layerId: string
  name: string
  /** Chance in percent among the layer's weighted traits. 0 for a constant. Weights sum to 100 per layer. */
  weight: number
  /** A fixed-quantity trait: on at most this many tokens. A cap, not an exact count. */
  constant?: number
  /** The empty trait: the layer is left out of a token. Has no image. */
  blank: boolean
  /** Full-size layer image, or null for a blank. */
  imageUrl: string | null
  /** The `uploads` row behind `imageUrl`, once the image is stored. Sample traits have none. */
  uploadId?: string
  /** A small preview of `imageUrl` for grids and chips, once the image is stored. The full image is the fallback. */
  thumbnailUrl?: string
  /** `false` leaves this trait out of the token's metadata attributes. */
  metadata?: false
}

/** One collection of a project (for example male and female). Each has its own layers and size. */
export type Collection = {
  id: string
  name: string
  /** Tokens to generate for this collection. The supply is the sum of the sizes. */
  size: number
}

/** A layer, bottom first. */
export type Layer = {
  id: string
  collectionId: string
  name: string
  /** 0 is the bottom of the collection's stack. */
  position: number
  traits: Trait[]
  /** The `trait_type` written to metadata instead of `name`. */
  displayName?: string
  /** Left out of the uniqueness key, so two tokens that differ only here count as the same (HashLips bypassDNA). */
  bypassDna?: boolean
}

/** The three rule kinds, worded as the creator sees them. */
export type RuleKind = "doesn't mix with" | 'always pairs with' | 'must pair with'

/**
 * A trait-pairing rule, stored on its source trait.
 *  - doesn't mix with: never in the same token as any related trait (both directions).
 *  - always pairs with: appears only with one of the related traits, and they only with it (both directions).
 *  - must pair with: whenever this trait appears, one of the related traits does too (one direction).
 */
export type ArtRule = {
  id: string
  kind: RuleKind
  traitId: string
  relatedTraitIds: string[]
  bidirectional: boolean
}

/** Every token of the collection carries at least one of these traits. */
export type AtLeastOne = { id: string; collectionId: string; traitIds: string[] }

/** Everything generation and validation need to know about a project's art. */
export type Project = {
  layers: Layer[]
  rules: ArtRule[]
  collections: Collection[]
  atLeastOne?: AtLeastOne[]
}

/** A contradiction between rules that the Rules screen surfaces and generation works around. */
export type RuleConflict = {
  kind: 'isolated' | 'mixing' | 'circular'
  ruleIds: string[]
  message: string
  /** The rules generation skips to get round the conflict. Unset: every rule but the first. */
  skip?: string[]
}

/** What the engine needs of a token. Callers keep their extra fields (name, description). */
export type TokenCore = {
  /** From 1, running on across collections. */
  id: number
  collectionId: string
  /** The chosen trait id for each of its collection's layers, in layer order. */
  dna: string[]
}

export type Ranked<T extends TokenCore> = T & { rank: number }

/** How often each trait occurs in a set, by trait id. */
export type TraitCounts = Record<string, number>

/** A fixed-quantity trait that came out below its cap. */
export type Shortfall = { trait: Trait; cap: number; actual: number }

/** How far a collection's generation got. */
export type Made = { collectionId: string; wanted: number; made: number }

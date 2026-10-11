/**
 * The render input: plain data, no classes, mirroring what the database stores so the worker's
 * mapping is a projection (spec section 5).
 */

export type ProjectKind = 'generative' | 'one_of_one' | 'single_asset'

/** Where an image lives, as the worker's loader understands it: the `uploads.storage_key`. */
export type ImageRef = { key: string; ext: 'png' | 'jpg' | 'webp' | 'gif' | 'mp4' }

export type RenderTrait = {
  id: string
  name: string
  blank: boolean
  /** `false` leaves the trait out of metadata (traits.in_metadata). */
  inMetadata: boolean
  /** null only for a blank. */
  image: ImageRef | null
}

export type RenderLayer = {
  id: string
  name: string
  displayName: string | null
  /** 0 to 1; 1 until the follow-up adds a column. */
  opacity: number
  traits: RenderTrait[]
}

/** One art collection of a generative project, layers bottom first. */
export type RenderArtCollection = { id: string; layers: RenderLayer[] }

export type GenerativeToken = { id: number; collectionId: string; dna: string[]; description: string | null }
export type AssetToken = { id: number; image: ImageRef; attributes: { trait_type: string; value: string }[] }

export type MetadataText = {
  /** Written as `<tokenName> #<id>`; the collection name when `collections.token_name` is null. */
  tokenName: string
  /** The project default; a generative token's own description wins when set. */
  tokenDescription: string
  showBlankTraits: boolean
  /** Extra top-level keys; the four reserved keys are refused (section 7). */
  extraFields: Record<string, string | number | boolean>
}

export type GenerativeSpec = {
  kind: 'generative'
  canvas: number
  collections: RenderArtCollection[]
  text: MetadataText
  batchSize: number
}

export type AssetSpec = {
  kind: 'one_of_one' | 'single_asset'
  text: MetadataText
  batchSize: number
}

export type PlaceholderSpec = {
  kind: 'placeholder'
  image: ImageRef
  /** The collection name and description, not per token. */
  name: string
  description: string
}

export type RenderSpec = GenerativeSpec | AssetSpec | PlaceholderSpec

/** The worker's loader: bytes for a storage key. Throws when the object is missing. */
export type LoadImage = (ref: ImageRef) => Promise<Uint8Array>

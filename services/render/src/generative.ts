import { buildTraitIndex, tokenAttributes } from '@cobweb/dna'
import type { Layer, TraitIndex } from '@cobweb/dna'
import { RenderProblem } from './problems'
import type {
  AssetToken,
  GenerativeSpec,
  GenerativeToken,
  RenderArtCollection,
  RenderLayer,
  RenderTrait,
} from './types'

/** A generative token carries DNA; an asset token carries its image. */
export function isGenerativeToken(token: GenerativeToken | AssetToken): token is GenerativeToken {
  return 'dna' in token
}

/** The batch a token id falls in: 0-based, `batchSize` ids per batch, ids from 1. */
export function batchOf(id: number, batchSize: number): number {
  return Math.floor((id - 1) / batchSize)
}

/**
 * The token's collection and, for each of its layers bottom first, the trait its DNA names there.
 * Refuses an unknown collection, a DNA of the wrong length and a trait id the layer does not have.
 */
export function resolveTraits(
  spec: GenerativeSpec,
  token: GenerativeToken,
): { collection: RenderArtCollection; picks: { layer: RenderLayer; trait: RenderTrait }[] } {
  const collection = spec.collections.find((c) => c.id === token.collectionId)
  if (!collection)
    throw new RenderProblem(
      'bad-dna',
      `Token ${token.id} belongs to collection ${token.collectionId}, which the job does not have.`,
      {
        tokenId: token.id,
        detail: { collection: token.collectionId },
      },
    )
  if (token.dna.length !== collection.layers.length)
    throw new RenderProblem(
      'bad-dna',
      `Token ${token.id} has ${token.dna.length} traits for ${collection.layers.length} layers.`,
      { tokenId: token.id },
    )
  const picks = collection.layers.map((layer, i) => {
    const traitId = token.dna[i] ?? ''
    const trait = layer.traits.find((t) => t.id === traitId)
    if (!trait)
      throw new RenderProblem(
        'bad-dna',
        `Token ${token.id} names trait ${traitId}, which layer ${layer.name} does not have.`,
        {
          tokenId: token.id,
          detail: { layer: layer.id, trait: traitId },
        },
      )
    return { layer, trait }
  })
  return { collection, picks }
}

/** A render collection in the shape `@cobweb/dna` reads, so its `tokenAttributes` writes the attributes. */
function dnaLayers(collection: RenderArtCollection): Layer[] {
  return collection.layers.map((layer, position) => ({
    id: layer.id,
    collectionId: collection.id,
    name: layer.name,
    position,
    displayName: layer.displayName ?? undefined,
    traits: layer.traits.map((trait) => ({
      id: trait.id,
      layerId: layer.id,
      name: trait.name,
      weight: 0,
      blank: trait.blank,
      imageUrl: null,
      metadata: trait.inMetadata ? undefined : (false as const),
    })),
  }))
}

/**
 * The attribute writer for a generative spec: blank left out unless `showBlankTraits`, `inMetadata`
 * false left out, `displayName` over `name` (all by `tokenAttributes`). Checks the DNA first.
 */
export function attributesFor(
  spec: GenerativeSpec,
): (token: GenerativeToken) => { trait_type: string; value: string }[] {
  const byCollection = new Map<string, { layers: Layer[]; index: TraitIndex }>()
  for (const collection of spec.collections) {
    const layers = dnaLayers(collection)
    byCollection.set(collection.id, { layers, index: buildTraitIndex(layers) })
  }
  return (token) => {
    const { collection } = resolveTraits(spec, token)
    const { layers, index } = byCollection.get(collection.id)!
    return tokenAttributes(token, layers, index, { showBlankTraits: spec.text.showBlankTraits })
  }
}

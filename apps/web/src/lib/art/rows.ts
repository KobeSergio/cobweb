import type { ArtProject } from '@/components/art/state/art-store'
import { finalise, type Draft } from '@/components/art/state/generation'
import { buildTraitIndex } from '@/components/art/lib/trait-index'
import type { Enums, Tables } from '@/lib/database.types'
import type { ArtRule, AtLeastOne, Layer, RuleKind, Trait } from '@/lib/demo'
import { servedUrl } from '@/lib/storage/uploads-service'

/**
 * The art rows and the browser store's project, both ways (docs/specs/2026-10-08-art-wiring.md,
 * section 4). Pure: the pages map rows on the server, the hooks build action inputs in the browser.
 * Ids are the database uuids; names and ranks are computed here, never stored.
 *
 * Only types come from art-store.ts (a client module); a value import from it into a server
 * component would arrive as a client reference.
 */
export type ArtRows = {
  collection: Pick<
    Tables<'collections'>,
    | 'name'
    | 'token_name'
    | 'token_description'
    | 'show_blank_traits'
    | 'generation_seed'
    | 'canvas_width'
    | 'canvas_height'
  >
  artCollections: Pick<Tables<'art_collections'>, 'id' | 'name' | 'size' | 'position'>[]
  layers: Pick<
    Tables<'layers'>,
    'id' | 'art_collection_id' | 'name' | 'display_name' | 'position' | 'bypass_dna'
  >[]
  traits: Pick<
    Tables<'traits'>,
    'id' | 'layer_id' | 'name' | 'weight' | 'constant' | 'blank' | 'in_metadata' | 'upload_id' | 'position'
  >[]
  rules: Pick<Tables<'rules'>, 'id' | 'kind' | 'trait_id' | 'related_trait_ids' | 'bidirectional'>[]
  atLeastOne: Pick<Tables<'at_least_one'>, 'id' | 'art_collection_id' | 'trait_ids'>[]
  tokens: Pick<Tables<'tokens'>, 'token_id' | 'art_collection_id' | 'dna' | 'description'>[]
}

/** The store's seed before the first generation (`fromSeed` in art-store.ts). */
const UNSET_SEED = 0x0a7115

const KIND_FROM_DB: Record<Enums<'rule_kind'>, RuleKind> = {
  doesnt_mix_with: "doesn't mix with",
  always_pairs_with: 'always pairs with',
  must_pair_with: 'must pair with',
}

const KIND_TO_DB: Record<RuleKind, Enums<'rule_kind'>> = {
  "doesn't mix with": 'doesnt_mix_with',
  'always pairs with': 'always_pairs_with',
  'must pair with': 'must_pair_with',
}

export function ruleKindFromDb(kind: Enums<'rule_kind'>): RuleKind {
  return KIND_FROM_DB[kind]
}

export function ruleKindToDb(kind: RuleKind): Enums<'rule_kind'> {
  return KIND_TO_DB[kind]
}

/** A trait row as the screens show it: images served through the app, the thumbnail for grids. */
export function toTrait(row: ArtRows['traits'][number]): Trait {
  return {
    id: row.id,
    layerId: row.layer_id,
    name: row.name,
    weight: Number(row.weight),
    ...(row.constant === null ? {} : { constant: row.constant }),
    blank: row.blank,
    imageUrl: row.upload_id ? servedUrl(row.upload_id) : null,
    ...(row.upload_id ? { thumbnailUrl: servedUrl(row.upload_id, 'thumb'), uploadId: row.upload_id } : {}),
    ...(row.in_metadata ? {} : { metadata: false as const }),
  }
}

export function toProject(rows: ArtRows): ArtProject {
  const { collection } = rows
  const artCollections = [...rows.artCollections].sort((a, b) => a.position - b.position)
  const order = new Map(artCollections.map((art, index) => [art.id, index]))

  const traitsByLayer = new Map<string, ArtRows['traits']>()
  for (const trait of rows.traits) {
    const list = traitsByLayer.get(trait.layer_id)
    if (list) list.push(trait)
    else traitsByLayer.set(trait.layer_id, [trait])
  }

  const next = new Map<string, number>()
  const layers: Layer[] = rows.layers
    .filter((row) => order.has(row.art_collection_id))
    .sort(
      (a, b) => order.get(a.art_collection_id)! - order.get(b.art_collection_id)! || a.position - b.position,
    )
    .map((row) => {
      const position = next.get(row.art_collection_id) ?? 0
      next.set(row.art_collection_id, position + 1)
      const traits = [...(traitsByLayer.get(row.id) ?? [])]
        // The blank goes first, where the Layers screen adds it.
        .sort((a, b) => Number(b.blank) - Number(a.blank) || a.position - b.position)
        .map(toTrait)
      return {
        id: row.id,
        collectionId: row.art_collection_id,
        name: row.name,
        position,
        traits,
        ...(row.display_name ? { displayName: row.display_name } : {}),
        ...(row.bypass_dna ? { bypassDna: true } : {}),
      }
    })

  const rules: ArtRule[] = rows.rules.map((row) => ({
    id: row.id,
    kind: ruleKindFromDb(row.kind),
    traitId: row.trait_id,
    relatedTraitIds: row.related_trait_ids,
    bidirectional: row.bidirectional,
  }))
  const atLeastOne: AtLeastOne[] = rows.atLeastOne.map((row) => ({
    id: row.id,
    collectionId: row.art_collection_id,
    traitIds: row.trait_ids,
  }))

  const drafts: Draft[] = [...rows.tokens]
    .sort((a, b) => a.token_id - b.token_id)
    .map((row) => ({
      id: row.token_id,
      collectionId: row.art_collection_id,
      dna: row.dna,
      name: '',
      description: row.description ?? collection.token_description,
    }))
  const tokens = drafts.length
    ? finalise(drafts, {
        tokenName: collection.token_name ?? collection.name,
        index: buildTraitIndex(layers),
      })
    : null

  // Nothing saved yet: Generate offers the project's own name and description.
  const untouched = collection.token_name === null && collection.token_description === ''
  return {
    collections: artCollections.map((art) => ({ id: art.id, name: art.name, size: art.size })),
    activeCollectionId: artCollections[0]?.id,
    layers,
    rules,
    atLeastOne,
    tokens,
    canvas:
      collection.canvas_width && collection.canvas_height
        ? { width: collection.canvas_width, height: collection.canvas_height }
        : null,
    seed: collection.generation_seed ?? UNSET_SEED,
    staleNote: null,
    ...(collection.token_name === null ? {} : { tokenName: collection.token_name }),
    ...(untouched ? {} : { tokenDescription: collection.token_description }),
    showBlankTraits: collection.show_blank_traits,
  }
}

/** One row of a layer's weight table, as `setLayerWeights` takes it. */
export type WeightRow = { traitId: string; weight: number; constant: number | null }

/** The layer's whole weight table, the blank included; a constant always carries weight 0. */
export function weightRows(layer: Layer): WeightRow[] {
  return layer.traits.map((trait) => ({
    traitId: trait.id,
    weight: trait.constant ? 0 : trait.weight,
    constant: trait.constant ?? null,
  }))
}

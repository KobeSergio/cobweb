import type { ArtRule, Collection, Layer } from '@/lib/demo'
import { layersOf, slug, uniqueId } from './layer-edits'

/**
 * Pure edits on the project's collections (legacy "multi-collection": for example male and female).
 * Each collection has its own layers, rules and size; token ids run on across collections.
 *
 * Seam: in Phase 3 each becomes a server action on the project's collection rows.
 */

/** Size a new collection starts at; the creator sets the real one on Generate. */
export const NEW_COLLECTION_SIZE = 100

/** The supply: every collection's size added up. */
export function supplyOf(collections: Collection[]): number {
  return collections.reduce((sum, collection) => sum + collection.size, 0)
}

export function addCollection(
  collections: Collection[],
  name: string,
): { collections: Collection[]; id: string } {
  const id = uniqueId(slug(name), new Set(collections.map((collection) => collection.id)))
  return { collections: [...collections, { id, name, size: NEW_COLLECTION_SIZE }], id }
}

export function renameCollection(collections: Collection[], id: string, name: string): Collection[] {
  return collections.map((collection) => (collection.id === id ? { ...collection, name } : collection))
}

export function setCollectionSize(collections: Collection[], id: string, size: number): Collection[] {
  const clean = Math.max(0, Math.min(100_000, Math.round(size) || 0))
  return collections.map((collection) => (collection.id === id ? { ...collection, size: clean } : collection))
}

/** The trait ids of one collection. */
export function traitIdsOf(layers: Layer[], collectionId: string): Set<string> {
  return new Set(layersOf(layers, collectionId).flatMap((layer) => layer.traits.map((trait) => trait.id)))
}

/** The rules of one collection: a rule belongs to the collection of the trait it is stored on. */
export function rulesOf(rules: ArtRule[], layers: Layer[], collectionId: string): ArtRule[] {
  const ids = traitIdsOf(layers, collectionId)
  return rules.filter((rule) => ids.has(rule.traitId))
}

/** The collection a trait belongs to, or undefined for an unknown trait. */
export function collectionOfTrait(layers: Layer[], traitId: string): string | undefined {
  return layers.find((layer) => layer.traits.some((trait) => trait.id === traitId))?.collectionId
}

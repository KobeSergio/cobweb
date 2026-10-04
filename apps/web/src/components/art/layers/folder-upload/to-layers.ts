import type { Collection, Layer, Trait } from '@/lib/demo'
import type { ArtProject } from '../../state/art-store'
import type { DetectedProject } from './folder-tree'

/** What the upload produced for one trait: where the image is now. */
export type UploadedImage = { url: string; name: string }

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'item'
  )
}

function unique(base: string, taken: Set<string>): string {
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  taken.add(id)
  return id
}

/** Whole-number weights that sum to 100, as the legacy upload did (100 / n each). */
function evenWeights(count: number): number[] {
  if (count === 0) return []
  const base = Math.floor(100 / count)
  let remainder = 100 - base * count
  return Array.from({ length: count }, () => base + (remainder-- > 0 ? 1 : 0))
}

/**
 * Turns the uploaded folder into the Art screens' collections and layers, merged into the project:
 *   - a project with no layers yet takes the uploaded collections as they are;
 *   - one uploaded collection fills the active collection (which has no layers, or the upload
 *     would not be showing);
 *   - several are added after the existing ones.
 * Only traits whose image uploaded are included (`images`, keyed by trait key).
 */
export function mergeUpload(
  project: ArtProject,
  detected: DetectedProject,
  images: ReadonlyMap<string, UploadedImage>,
  activeCollectionId?: string,
): Pick<ArtProject, 'collections' | 'activeCollectionId' | 'layers'> {
  const existingLayers = project.layers ?? []
  const fresh = existingLayers.length === 0
  const existing = fresh ? [] : (project.collections ?? [])
  const takenCollections = new Set(existing.map((collection) => collection.id))
  const takenLayers = new Set(fresh ? [] : existingLayers.map((layer) => layer.id))
  const takenTraits = new Set(fresh ? [] : existingLayers.flatMap((layer) => layer.traits.map((t) => t.id)))

  const fillActive =
    !fresh && detected.collections.length === 1 && existing.some((c) => c.id === activeCollectionId)

  const added: Collection[] = []
  const layers: Layer[] = []
  for (const source of detected.collections) {
    const id = fillActive ? activeCollectionId! : unique(slug(source.name), takenCollections)
    if (!fillActive) added.push({ id, name: source.name, size: 0 })
    let position = 0
    for (const sourceLayer of source.layers) {
      const layerId = unique(`${id}-${slug(sourceLayer.name)}`, takenLayers)
      const kept = sourceLayer.traits.filter((trait) => images.has(trait.key))
      const weights = evenWeights(kept.length)
      const traits = kept.map((trait, index): Trait => ({
        id: unique(`${layerId}-${slug(images.get(trait.key)!.name)}`, takenTraits),
        layerId,
        name: images.get(trait.key)!.name,
        weight: weights[index]!,
        blank: false,
        imageUrl: images.get(trait.key)!.url,
      }))
      if (traits.length > 0)
        layers.push({ id: layerId, collectionId: id, name: sourceLayer.name, position: position++, traits })
    }
  }

  const collections = [...existing, ...added]
  return {
    collections,
    activeCollectionId: fillActive ? activeCollectionId : (added[0]?.id ?? activeCollectionId),
    layers: [...(fresh ? [] : existingLayers), ...layers],
  }
}

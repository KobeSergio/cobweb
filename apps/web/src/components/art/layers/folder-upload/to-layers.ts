import type { Collection, Layer, Trait } from '@/lib/demo'
import type { ImportPayload, ImportResult } from '@/lib/art/schemas'
import { servedUrl } from '@/lib/storage/uploads-service'
import type { ArtProject } from '../../state/art-store'
// Every layer starts evenly split, as the legacy upload did (100 / n each), to two decimals.
import { evenWeights } from '../../state/layer-edits'
import type { DetectedProject } from './folder-tree'

/** What the upload produced for one trait: where the image is now. */
export type UploadedImage = { url: string; name: string; uploadId: string }

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
        uploadId: images.get(trait.key)!.uploadId,
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

/** Names longer than the columns allow are clipped, so a long folder name never blocks an import. */
const clip = (name: string, max: number) => name.trim().slice(0, max).trim() || 'Untitled'

/**
 * The folder as `importLayers` takes it: only traits whose image is stored, no empty layers, names
 * within the column limits (48 for collections and layers, 64 for traits). `activeCollectionId` is
 * passed only when the project already has layers (see `mergeUpload`).
 */
export function importPayload(
  detected: DetectedProject,
  images: ReadonlyMap<string, UploadedImage>,
  activeCollectionId?: string,
): ImportPayload {
  return {
    collections: detected.collections.map((collection) => ({
      name: clip(collection.name, 48),
      layers: collection.layers
        .map((layer) => ({
          name: clip(layer.name, 48),
          traits: layer.traits.flatMap((trait) => {
            const image = images.get(trait.key)
            return image ? [{ name: clip(image.name, 64), uploadId: image.uploadId }] : []
          }),
        }))
        .filter((layer) => layer.traits.length > 0),
    })),
    activeCollectionId: activeCollectionId ?? null,
  }
}

/**
 * The imported folder in the store, with the ids `art_import_layers` returned, merged the way the
 * database merged it: one collection fills the active one; otherwise new collections follow the
 * existing ones, and a project without layers keeps only the imported collections.
 */
export function applyImport(
  project: ArtProject,
  payload: ImportPayload,
  result: ImportResult,
): Pick<ArtProject, 'collections' | 'activeCollectionId' | 'layers'> {
  const existingLayers = project.layers ?? []
  const fill = payload.activeCollectionId !== null && payload.collections.length === 1
  const existing = existingLayers.length === 0 && !fill ? [] : (project.collections ?? [])
  const added: Collection[] = []
  const layers: Layer[] = []
  payload.collections.forEach((source, c) => {
    const ids = result.collections[c]
    if (!ids) return
    if (!fill) added.push({ id: ids.id, name: source.name, size: 0 })
    source.layers.forEach((sourceLayer, l) => {
      const layerIds = ids.layers[l]
      if (!layerIds) return
      const weights = evenWeights(sourceLayer.traits.length)
      layers.push({
        id: layerIds.id,
        collectionId: ids.id,
        name: sourceLayer.name,
        position: l,
        traits: sourceLayer.traits.map((trait, t): Trait => ({
          id: layerIds.traits[t]!.id,
          layerId: layerIds.id,
          name: trait.name,
          weight: weights[t]!,
          blank: false,
          imageUrl: servedUrl(trait.uploadId),
          thumbnailUrl: servedUrl(trait.uploadId, 'thumb'),
          uploadId: trait.uploadId,
        })),
      })
    })
  })
  return {
    collections: [...existing, ...added],
    activeCollectionId: fill
      ? (payload.activeCollectionId ?? undefined)
      : (added[0]?.id ?? project.activeCollectionId),
    layers: [...existingLayers, ...layers],
  }
}

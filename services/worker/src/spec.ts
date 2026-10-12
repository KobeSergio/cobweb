/**
 * The spec mapper (docs/specs/2026-10-12-render-worker.md, section 6): pure functions from the rows
 * the worker reads to the render library's input. A row that cannot be mapped throws a
 * `RenderProblem`, so it fails the job like any other art problem.
 */
import { RenderProblem } from '@cobweb/render'
import type {
  AssetSpec,
  AssetToken,
  GenerativeSpec,
  GenerativeToken,
  ImageRef,
  MetadataText,
  PlaceholderSpec,
  RenderArtCollection,
} from '@cobweb/render'
import type { RenderData, TokenRows } from './ports.ts'

const EXTENSIONS: readonly ImageRef['ext'][] = ['png', 'jpg', 'webp', 'gif', 'mp4']

/** The image reference for a storage key: the key, and the extension taken from it. Null for any other ending. */
export function imageRef(key: string): ImageRef | null {
  const ext = EXTENSIONS.find((known) => key.endsWith(`.${known}`))
  return ext ? { key, ext } : null
}

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position

// One lookup per data object, so a batch of tokens does not rebuild it for every token.
const uploadIndexes = new WeakMap<RenderData, Map<string, string>>()

function uploadKeys(data: RenderData): Map<string, string> {
  let index = uploadIndexes.get(data)
  if (!index) {
    index = new Map(data.uploads.map((upload) => [upload.id, upload.storageKey]))
    uploadIndexes.set(data, index)
  }
  return index
}

function refOf(data: RenderData, uploadId: string | null): ImageRef | null {
  const key = uploadId === null ? undefined : uploadKeys(data).get(uploadId)
  return key === undefined ? null : imageRef(key)
}

function textOf(data: RenderData): MetadataText {
  return {
    tokenName: data.collection.tokenName ?? data.collection.name,
    tokenDescription: data.collection.tokenDescription,
    showBlankTraits: data.collection.showBlankTraits,
    extraFields: {},
  }
}

function placeholderSpec(data: RenderData): PlaceholderSpec {
  const image = refOf(data, data.job.placeholderUploadId)
  if (!image) throw new RenderProblem('missing-image', 'The placeholder file is missing from the project.')
  return {
    kind: 'placeholder',
    image,
    name: data.collection.name,
    description: data.collection.description,
  }
}

function generativeSpec(data: RenderData): GenerativeSpec {
  const canvas = data.collection.canvasWidth
  if (canvas === null)
    throw new RenderProblem('missing-image', 'The project has no canvas size, so it has no layer images.')
  const collections: RenderArtCollection[] = [...data.artCollections].sort(byPosition).map((art) => ({
    id: art.id,
    layers: data.layers
      .filter((layer) => layer.artCollectionId === art.id)
      .sort(byPosition)
      .map((layer) => ({
        id: layer.id,
        name: layer.name,
        displayName: layer.displayName,
        opacity: 1,
        traits: data.traits
          .filter((trait) => trait.layerId === layer.id)
          .sort(byPosition)
          .map((trait) => {
            const image = trait.blank ? null : refOf(data, trait.uploadId)
            if (!trait.blank && !image)
              throw new RenderProblem(
                'missing-image',
                `Trait ${trait.name} in layer ${layer.name} has no image.`,
                { detail: { trait: trait.id, layer: layer.id } },
              )
            return { id: trait.id, name: trait.name, blank: trait.blank, inMetadata: trait.inMetadata, image }
          }),
      })),
  }))
  return { kind: 'generative', canvas, collections, text: textOf(data), batchSize: data.job.batchSize }
}

/** The render library's spec for a job: the placeholder's for a placeholder job, else by project type. */
export function renderSpec(data: RenderData): GenerativeSpec | AssetSpec | PlaceholderSpec {
  if (data.job.kind === 'placeholder') return placeholderSpec(data)
  if (data.collection.projectType === 'generative') return generativeSpec(data)
  return { kind: data.collection.projectType, text: textOf(data), batchSize: data.job.batchSize }
}

/** The attribute list stored at lock, kept as it is: entries with a text `trait_type` and a text or number `value`. */
function attributesOf(value: unknown): { trait_type: string; value: string }[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return []
    const { trait_type: type, value: text } = entry as { trait_type?: unknown; value?: unknown }
    if (typeof type !== 'string') return []
    if (typeof text === 'string') return [{ trait_type: type, value: text }]
    return typeof text === 'number' ? [{ trait_type: type, value: String(text) }] : []
  })
}

/** One batch's stored rows as the render library's tokens. */
export function tokenSlice(data: RenderData, rows: TokenRows): (GenerativeToken | AssetToken)[] {
  const generative = data.collection.projectType === 'generative'
  if (rows.kind === 'generative') {
    if (!generative)
      throw new RenderProblem(
        'missing-image',
        'The job has generated tokens, but the project is not generative.',
      )
    return rows.rows.map((row) => ({
      id: row.tokenId,
      collectionId: row.artCollectionId,
      dna: row.dna,
      description: row.description,
    }))
  }
  if (generative)
    throw new RenderProblem('bad-dna', 'The job has a file list, but the project is generative.')
  return rows.rows.map((row) => {
    const image = refOf(data, row.uploadId)
    if (!image)
      throw new RenderProblem('missing-image', `Token ${row.id} names a file the project does not have.`, {
        tokenId: row.id,
        detail: { upload: row.uploadId },
      })
    return { id: row.id, image, attributes: attributesOf(row.attributes) }
  })
}

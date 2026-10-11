import { packDirectory } from './car'
import type { PackedDirectory } from './car'
import { placeholderMetadataJson, SHARED_METADATA_FILE } from './metadata'
import type { RenderedMetadata } from './metadata-set'
import { reasonOf, RenderProblem } from './problems'
import { sniffExt } from './sniff'
import type { LoadImage, PlaceholderSpec } from './types'

/**
 * The pre-reveal placeholder: its image passed through as `placeholder.<ext>` in its own directory,
 * and one `metadata.json` pointing at it, with a slash-less base URI so every token returns it.
 */
export async function renderPlaceholder(
  spec: PlaceholderSpec,
  loadImage: LoadImage,
): Promise<{ image: PackedDirectory; metadata: RenderedMetadata }> {
  let bytes: Uint8Array
  try {
    bytes = await loadImage(spec.image)
  } catch (error) {
    throw new RenderProblem('missing-image', `The placeholder image ${spec.image.key} could not be loaded.`, {
      detail: { key: spec.image.key, reason: reasonOf(error) },
    })
  }
  const found = sniffExt(bytes)
  if (found !== spec.image.ext)
    throw new RenderProblem('decode', `The placeholder file is not a ${spec.image.ext}.`, {
      detail: { expected: spec.image.ext, found: found ?? 'unknown' },
    })
  const fileName = `placeholder.${spec.image.ext}`
  const image = await packDirectory([{ name: fileName, bytes }])
  const json = placeholderMetadataJson({
    name: spec.name,
    description: spec.description,
    image: `ipfs://${image.cid}/${fileName}`,
  })
  const packed = await packDirectory([{ name: SHARED_METADATA_FILE, bytes: json }])
  return { image, metadata: { ...packed, baseUri: `ipfs://${packed.cid}/${SHARED_METADATA_FILE}` } }
}

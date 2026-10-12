import { reasonOf, RenderProblem } from './problems'
import { PNG_OPTIONS, TRANSPARENT, bytesOf, sharp } from './png'

/**
 * Assets are admitted up to 8192 pixels a side (2048 is only the limit for layer images), and the
 * collage may be handed a rendered token of any of them, so an input with more pixels than a square
 * of 8192 is refused undecoded.
 */
export const MAX_INPUT_PIXELS = 8192 * 8192

/**
 * A preview grid of the images given (the worker passes the first 16 rendered tokens, PNG batch files only: it filters GIF and MP4 files out first, since the collage cannot read them): `columns`
 * across (4), as many rows as needed, each image fitted inside a `cell` (256) pixel square on
 * transparency. Cells past the last image stay transparent.
 */
export async function previewCollage(
  images: Uint8Array[],
  options: { columns?: number; cell?: number } = {},
): Promise<Uint8Array> {
  if (images.length === 0)
    throw new RenderProblem('empty-collage', 'A preview collage needs at least one image.')
  const columns = Math.max(1, Math.floor(options.columns ?? 4))
  const cell = Math.max(1, Math.floor(options.cell ?? 256))
  const rows = Math.ceil(images.length / columns)
  const tiles: {
    input: Buffer
    raw: { width: number; height: number; channels: 4 }
    left: number
    top: number
  }[] = []
  for (const [index, bytes] of images.entries()) {
    let input: Buffer
    try {
      input = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
        .resize(cell, cell, { fit: 'contain', background: TRANSPARENT })
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer()
    } catch (error) {
      throw new RenderProblem('decode', `Collage image ${index + 1} could not be read as an image.`, {
        detail: { index, reason: reasonOf(error) },
      })
    }
    tiles.push({
      input,
      raw: { width: cell, height: cell, channels: 4 },
      left: (index % columns) * cell,
      top: Math.floor(index / columns) * cell,
    })
  }
  const png = await sharp({
    create: { width: columns * cell, height: rows * cell, channels: 4, background: TRANSPARENT },
  })
    .composite(tiles)
    .png(PNG_OPTIONS)
    .toBuffer()
  return bytesOf(png)
}

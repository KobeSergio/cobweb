import { reasonOf, RenderProblem } from './problems'
import { PNG_OPTIONS, TRANSPARENT, bytesOf, sharp } from './png'

type RawInput = { input: Buffer; raw: { width: number; height: number; channels: 4 } }

/** Opacity as stored is 0 to 1. Out of range values are clamped; NaN counts as fully opaque. */
export function alphaOf(opacity: number): number {
  const clamped = Number.isNaN(opacity) ? 1 : Math.min(1, Math.max(0, opacity))
  return Math.round(clamped * 255)
}

/**
 * Decode limits for every sharp call that reads pixels: nothing larger than the canvas is allocated,
 * so a crafted or oversized image is refused before its pixels are decoded.
 */
export function decodeOptions(canvas: number): { limitInputPixels: number } {
  return { limitInputPixels: canvas * canvas }
}

/** Positions count within the bytes given (blanks are already removed by the caller), 0-based in detail. */
function decodeProblem(position: number, total: number, error: unknown): RenderProblem {
  return new RenderProblem(
    'decode',
    `Image ${position + 1} of ${total} in the stack could not be read as an image.`,
    { detail: { position, reason: reasonOf(error) } },
  )
}

async function dimensionsOf(
  bytes: Uint8Array,
  position: number,
  total: number,
): Promise<{ width: number; height: number }> {
  // Metadata reads the header only and allocates no pixels, so it is not bounded: an oversized image
  // must reach the size check below and be refused as layer-size, not decode.
  try {
    const { width, height } = await sharp(bytes).metadata()
    return { width, height }
  } catch (error) {
    throw decodeProblem(position, total, error)
  }
}

/** One image as raw sRGBA at canvas size, its alpha multiplied by the opacity. */
async function prepareLayer(
  canvas: number,
  bytes: Uint8Array,
  opacity: number,
  position: number,
  total: number,
): Promise<RawInput> {
  const { width, height } = await dimensionsOf(bytes, position, total)
  if (width !== canvas || height !== canvas)
    throw new RenderProblem(
      'layer-size',
      `Image ${position + 1} of ${total} in the stack is ${width} by ${height} pixels; the canvas is ${canvas} by ${canvas}.`,
      { detail: { position, width, height } },
    )
  const alpha = alphaOf(opacity)
  let image = sharp(bytes, decodeOptions(canvas)).toColourspace('srgb').ensureAlpha()
  if (alpha < 255)
    image = image.composite([
      {
        input: Buffer.from([0, 0, 0, alpha]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: 'dest-in',
      },
    ])
  try {
    return { input: await image.raw().toBuffer(), raw: { width: canvas, height: canvas, channels: 4 } }
  } catch (error) {
    throw decodeProblem(position, total, error)
  }
}

/**
 * Stacks layer images bottom first on a transparent `canvas` by `canvas` RGBA base and returns the
 * PNG. Every image must be exactly canvas sized; nothing is resized. A blank trait is simply not
 * passed in.
 */
export async function compositeToken(
  canvas: number,
  layers: { bytes: Uint8Array; opacity: number }[],
): Promise<Uint8Array> {
  const inputs: RawInput[] = []
  for (const [position, layer] of layers.entries())
    inputs.push(await prepareLayer(canvas, layer.bytes, layer.opacity, position, layers.length))
  try {
    const png = await sharp({
      create: { width: canvas, height: canvas, channels: 4, background: TRANSPARENT },
    })
      .composite(inputs)
      .png(PNG_OPTIONS)
      .toBuffer()
    return bytesOf(png)
  } catch (error) {
    throw new RenderProblem('decode', 'The composited image could not be written as a PNG.', {
      detail: { reason: reasonOf(error) },
    })
  }
}

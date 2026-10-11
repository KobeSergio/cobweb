import { reasonOf, RenderProblem } from './problems'
import { alphaOf, blendOver } from './blend'
import { PNG_OPTIONS, bytesOf, sharp } from './png'

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

/** One image as raw sRGBA at canvas size. */
async function decodeLayer(
  canvas: number,
  bytes: Uint8Array,
  position: number,
  total: number,
): Promise<Uint8Array> {
  const { width, height } = await dimensionsOf(bytes, position, total)
  if (width !== canvas || height !== canvas)
    throw new RenderProblem(
      'layer-size',
      `Image ${position + 1} of ${total} in the stack is ${width} by ${height} pixels; the canvas is ${canvas} by ${canvas}.`,
      { detail: { position, width, height } },
    )
  try {
    const raw = await sharp(bytes, decodeOptions(canvas)).toColourspace('srgb').ensureAlpha().raw().toBuffer()
    return bytesOf(raw)
  } catch (error) {
    throw decodeProblem(position, total, error)
  }
}

/**
 * Stacks layer images bottom first on a transparent `canvas` by `canvas` RGBA base and returns the
 * PNG. Every image must be exactly canvas sized; nothing is resized. A blank trait is simply not
 * passed in. Sharp only decodes each layer to raw sRGBA and encodes the result; the blend itself is
 * integer arithmetic (see `blendOver`), so the bytes do not depend on the CPU.
 */
export async function compositeToken(
  canvas: number,
  layers: { bytes: Uint8Array; opacity: number }[],
): Promise<Uint8Array> {
  return encode(canvas, await compositeRaw(canvas, layers))
}

/** The blended raw sRGBA buffer of a stack, before PNG encoding. */
export async function compositeRaw(
  canvas: number,
  layers: { bytes: Uint8Array; opacity: number }[],
): Promise<Uint8Array> {
  let pixels: Uint8Array
  try {
    pixels = new Uint8Array(canvas * canvas * 4)
  } catch (error) {
    throw new RenderProblem('decode', 'The composited image could not be written as a PNG.', {
      detail: { reason: reasonOf(error) },
    })
  }
  for (const [position, layer] of layers.entries())
    blendOver(pixels, await decodeLayer(canvas, layer.bytes, position, layers.length), alphaOf(layer.opacity))
  return pixels
}

async function encode(canvas: number, pixels: Uint8Array): Promise<Uint8Array> {
  try {
    const png = await sharp(pixels, { raw: { width: canvas, height: canvas, channels: 4 } })
      .png(PNG_OPTIONS)
      .toBuffer()
    return bytesOf(png)
  } catch (error) {
    throw new RenderProblem('decode', 'The composited image could not be written as a PNG.', {
      detail: { reason: reasonOf(error) },
    })
  }
}

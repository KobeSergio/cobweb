/**
 * Test helpers: images drawn with sharp (no binary fixtures are committed), an in-memory loader, a
 * PNG chunk reader and a CAR reader. Not exported from the package.
 */
import { sharp, TRANSPARENT } from './png'

export type Rgba = { r: number; g: number; b: number; alpha: number }

/** A flat colour PNG, `width` by `height` (square by default). */
export async function flatPng(colour: Rgba, width = 64, height = width): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 4, background: colour } })
      .png()
      .toBuffer(),
  )
}

/** A transparent PNG with a centred square of `colour`, half the size, at half alpha. */
export async function halfAlphaSquarePng(colour: Omit<Rgba, 'alpha'>, size = 64): Promise<Uint8Array> {
  const square = await flatPng({ ...colour, alpha: 0.5 }, size / 2)
  return new Uint8Array(
    await sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
      .composite([{ input: Buffer.from(square), left: size / 4, top: size / 4 }])
      .png()
      .toBuffer(),
  )
}

/** The RGBA of one pixel. */
export async function pixel(png: Uint8Array, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(png)
    .toColourspace('srgb')
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const at = (y * info.width + x) * 4
  return [...data.subarray(at, at + 4)]
}

export async function sizeOf(png: Uint8Array): Promise<{ width: number; height: number; format: string }> {
  const { width, height, format } = await sharp(png).metadata()
  return { width, height, format }
}

/** Chunk types of a PNG, in file order. */
export function pngChunks(png: Uint8Array): string[] {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  const types: string[] = []
  for (let at = 8; at < png.byteLength;) {
    const length = view.getUint32(at)
    types.push(String.fromCharCode(...png.subarray(at + 4, at + 8)))
    at += 12 + length
  }
  return types
}

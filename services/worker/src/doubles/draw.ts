import sharp from 'sharp'

export type Rgba = { r: number; g: number; b: number; alpha: number }

/** A flat colour PNG, `size` by `size`. For fixtures only: tests, verify:render and the benchmark. */
export async function flatPng(colour: Rgba, size = 64): Promise<Uint8Array> {
  const png = await sharp({ create: { width: size, height: size, channels: 4, background: colour } })
    .png()
    .toBuffer()
  return new Uint8Array(png)
}

/** The width and height of an image. */
export async function sizeOf(image: Uint8Array): Promise<{ width: number; height: number }> {
  const { width, height } = await sharp(image).metadata()
  return { width, height }
}

/** One pixel (x across, y down) as red, green, blue and alpha bytes, and the image size. For verify:render. */
export async function rgbaAt(
  image: Uint8Array,
  x: number,
  y: number,
): Promise<{ width: number; height: number; pixel: [number, number, number, number] }> {
  const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (x < 0 || y < 0 || x >= info.width || y >= info.height)
    throw new Error('The pixel is outside the image.')
  const at = (y * info.width + x) * 4
  return {
    width: info.width,
    height: info.height,
    pixel: [data[at]!, data[at + 1]!, data[at + 2]!, data[at + 3]!],
  }
}

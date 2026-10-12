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

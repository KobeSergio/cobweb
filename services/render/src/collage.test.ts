import { describe, expect, it } from 'vitest'
import { MAX_INPUT_PIXELS, previewCollage } from './collage'
import { flatPng, pixel, sizeOf } from './fixtures'
import { sharp } from './png'

const colours = (count: number) =>
  Promise.all(Array.from({ length: count }, (_, i) => flatPng({ r: i * 15, g: 100, b: 200, alpha: 1 })))

describe('previewCollage', () => {
  it('lays 16 images out as a 1024 by 1024 PNG, 4 across', async () => {
    const png = await previewCollage(await colours(16))
    expect(await sizeOf(png)).toEqual({ width: 1024, height: 1024, format: 'png' })
    expect(await pixel(png, 128, 128)).toEqual([0, 100, 200, 255])
    expect(await pixel(png, 3 * 256 + 128, 3 * 256 + 128)).toEqual([225, 100, 200, 255])
  })

  it('leaves the cells past the last image transparent', async () => {
    const png = await previewCollage(await colours(3))
    expect(await sizeOf(png)).toEqual({ width: 1024, height: 256, format: 'png' })
    expect(await pixel(png, 2 * 256 + 128, 128)).toEqual([30, 100, 200, 255])
    expect((await pixel(png, 3 * 256 + 128, 128))[3]).toBe(0)
  })

  it('fits a non-square image inside its cell on transparency', async () => {
    const wide = await flatPng({ r: 255, g: 0, b: 0, alpha: 1 }, 128, 64)
    const png = await previewCollage([wide], { columns: 1, cell: 256 })
    expect((await pixel(png, 128, 10))[3]).toBe(0)
    expect(await pixel(png, 128, 128)).toEqual([255, 0, 0, 255])
  })

  it('returns identical bytes for two calls on the same images', async () => {
    const images = await colours(5)
    expect(await previewCollage(images)).toEqual(await previewCollage(images))
  })

  it('refuses an empty list', async () => {
    await expect(previewCollage([])).rejects.toMatchObject({ code: 'empty-collage' })
  })

  it('wraps bytes that are not an image as decode, naming the position', async () => {
    await expect(previewCollage([new Uint8Array([1, 2, 3])])).rejects.toMatchObject({
      code: 'decode',
      detail: { index: 0 },
    })
  })

  it('accepts an image of the product maximum, 2048 by 2048', async () => {
    const big = await flatPng({ r: 1, g: 2, b: 3, alpha: 1 }, 2048)
    const png = await previewCollage([big], { columns: 1, cell: 64 })
    expect(await sizeOf(png)).toEqual({ width: 64, height: 64, format: 'png' })
  })

  it('bounds the input at the asset size limit, 8192 by 8192', async () => {
    expect(MAX_INPUT_PIXELS).toBe(8192 * 8192)
    const wide = await flatPng({ r: 1, g: 2, b: 3, alpha: 1 }, 8192)
    const png = await previewCollage([wide], { columns: 1, cell: 64 })
    expect(await sizeOf(png)).toEqual({ width: 64, height: 64, format: 'png' })
  })

  it('refuses an image with more pixels than the maximum before it is decoded, as decode', async () => {
    const huge = await flatPng({ r: 1, g: 2, b: 3, alpha: 1 }, 8193)
    expect((await sharp(huge).metadata()).width).toBe(8193)
    await expect(previewCollage([huge])).rejects.toMatchObject({ code: 'decode', detail: { index: 0 } })
  })
})

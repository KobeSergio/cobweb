import { describe, expect, it } from 'vitest'
import { compositeToken } from './composite'
import { flatPng, halfAlphaSquarePng, pixel, pngChunks, sizeOf } from './fixtures'
import { setConcurrency, sharp } from './png'
import { forToken, RenderProblem } from './problems'

const RED = { r: 255, g: 0, b: 0, alpha: 1 }
const BLUE = { r: 0, g: 0, b: 255, alpha: 1 }

describe('compositeToken', () => {
  it('stacks bottom first, so the top layer wins where it is opaque', async () => {
    const png = await compositeToken(64, [
      { bytes: await flatPng(RED), opacity: 1 },
      { bytes: await halfAlphaSquarePng({ r: 0, g: 255, b: 0 }), opacity: 1 },
      { bytes: await flatPng(BLUE), opacity: 1 },
    ])
    expect(await sizeOf(png)).toEqual({ width: 64, height: 64, format: 'png' })
    expect(await pixel(png, 32, 32)).toEqual([0, 0, 255, 255])
  })

  it('blends a half alpha layer over the one below', async () => {
    const png = await compositeToken(64, [
      { bytes: await flatPng(RED), opacity: 1 },
      { bytes: await halfAlphaSquarePng({ r: 0, g: 0, b: 255 }), opacity: 1 },
    ])
    expect(await pixel(png, 2, 2)).toEqual([255, 0, 0, 255])
    const [r, g, b, a] = await pixel(png, 32, 32)
    expect(a).toBe(255)
    expect(g).toBe(0)
    expect(Math.abs(r! - 128)).toBeLessThanOrEqual(2)
    expect(Math.abs(b! - 128)).toBeLessThanOrEqual(2)
  })

  it('halves alpha at opacity 0.5, within 1 unit', async () => {
    const png = await compositeToken(64, [{ bytes: await flatPng(RED), opacity: 0.5 }])
    const [r, , , a] = await pixel(png, 10, 10)
    expect(r).toBe(255)
    expect(Math.abs(a! - 127.5)).toBeLessThanOrEqual(1)
  })

  it('treats no layers (every trait blank) as a transparent canvas', async () => {
    const png = await compositeToken(64, [])
    expect(await sizeOf(png)).toEqual({ width: 64, height: 64, format: 'png' })
    expect(await pixel(png, 0, 0)).toEqual([0, 0, 0, 0])
  })

  it('refuses an image of another size, naming the size found and its place in the stack', async () => {
    const small = await flatPng(RED, 32)
    const error = await compositeToken(64, [
      { bytes: await flatPng(BLUE), opacity: 1 },
      { bytes: small, opacity: 1 },
      { bytes: await flatPng(BLUE), opacity: 1 },
    ]).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RenderProblem)
    expect(error).toMatchObject({ code: 'layer-size', detail: { position: 1, width: 32, height: 32 } })
    expect((error as RenderProblem).message).toBe(
      'Image 2 of 3 in the stack is 32 by 32 pixels; the canvas is 64 by 64.',
    )
  })

  it('wraps bytes that are not an image as decode', async () => {
    const error = await compositeToken(64, [{ bytes: new Uint8Array([1, 2, 3]), opacity: 1 }]).catch(
      (e: unknown) => e,
    )
    expect(error).toBeInstanceOf(RenderProblem)
    expect(error).toMatchObject({ code: 'decode', detail: { position: 0 } })
    expect((error as RenderProblem).message).toBe('Image 1 of 1 in the stack could not be read as an image.')
  })

  it('writes a PNG with no EXIF, ICC, text or time chunk', async () => {
    const png = await compositeToken(64, [{ bytes: await flatPng(RED), opacity: 1 }])
    const chunks = pngChunks(png)
    expect(chunks[0]).toBe('IHDR')
    expect(chunks.at(-1)).toBe('IEND')
    for (const banned of ['tIME', 'eXIf', 'iCCP', 'tEXt', 'zTXt', 'iTXt'])
      expect(chunks).not.toContain(banned)
  })

  it('gives identical bytes on two runs', async () => {
    const layers = [
      { bytes: await flatPng(RED), opacity: 1 },
      { bytes: await halfAlphaSquarePng({ r: 0, g: 255, b: 0 }), opacity: 0.5 },
    ]
    expect(await compositeToken(64, layers)).toEqual(await compositeToken(64, layers))
  })

  it('clamps an opacity outside 0 to 1 and reads NaN as fully opaque', async () => {
    const red = await flatPng(RED)
    const at = async (opacity: number) => pixel(await compositeToken(64, [{ bytes: red, opacity }]), 10, 10)
    expect(await at(1.5)).toEqual([255, 0, 0, 255])
    expect(await at(50)).toEqual([255, 0, 0, 255])
    expect((await at(-0.2))[3]).toBe(0)
    expect(await at(Number.NaN)).toEqual([255, 0, 0, 255])
  })

  it('composites greyscale, 16-bit and palette PNG layers like any other', async () => {
    const grey = new Uint8Array(
      await sharp(await flatPng({ r: 128, g: 128, b: 128, alpha: 1 }))
        .toColourspace('b-w')
        .png()
        .toBuffer(),
    )
    const deep = new Uint8Array(
      await sharp(await flatPng({ r: 10, g: 200, b: 30, alpha: 1 }))
        .toColourspace('rgb16')
        .png()
        .toBuffer(),
    )
    const indexed = new Uint8Array(
      await sharp(await flatPng({ r: 0, g: 0, b: 255, alpha: 1 }))
        .png({ palette: true })
        .toBuffer(),
    )
    expect(await pixel(await compositeToken(64, [{ bytes: grey, opacity: 1 }]), 5, 5)).toEqual([
      128, 128, 128, 255,
    ])
    expect(await pixel(await compositeToken(64, [{ bytes: deep, opacity: 1 }]), 5, 5)).toEqual([
      10, 200, 30, 255,
    ])
    expect(await pixel(await compositeToken(64, [{ bytes: indexed, opacity: 1 }]), 5, 5)).toEqual([
      0, 0, 255, 255,
    ])
  })
})

describe('setConcurrency', () => {
  it('sets the libvips thread count, flooring and never going below 1', () => {
    try {
      setConcurrency(2)
      expect(sharp.concurrency()).toBe(2)
      setConcurrency(2.9)
      expect(sharp.concurrency()).toBe(2)
      setConcurrency(0)
      expect(sharp.concurrency()).toBe(1)
    } finally {
      setConcurrency(1)
    }
  })
})

describe('forToken', () => {
  it('does not add a detail key to a problem that has none', () => {
    expect('detail' in forToken(new RenderProblem('decode', 'x'), 1)).toBe(false)
  })
})

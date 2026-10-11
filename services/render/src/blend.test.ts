import { describe, expect, it } from 'vitest'
import { alphaOf, blendOver } from './blend'

const px = (r: number, g: number, b: number, a: number) => new Uint8Array([r, g, b, a])

describe('alphaOf', () => {
  it('reads NaN as 255, clamps out of range values and rounds', () => {
    expect(alphaOf(Number.NaN)).toBe(255)
    expect(alphaOf(1.5)).toBe(255)
    expect(alphaOf(-1)).toBe(0)
    expect(alphaOf(0.5)).toBe(128)
  })
})

describe('blendOver', () => {
  it('gives the source where it is opaque at full alpha', () => {
    const dst = px(10, 20, 30, 200)
    blendOver(dst, px(1, 2, 3, 255), 255)
    expect([...dst]).toEqual([1, 2, 3, 255])
  })

  it('leaves the destination unchanged at alpha 0', () => {
    const dst = px(10, 20, 30, 200)
    blendOver(dst, px(1, 2, 3, 255), 0)
    expect([...dst]).toEqual([10, 20, 30, 200])
  })

  it('leaves the destination unchanged under a transparent source', () => {
    const dst = px(10, 20, 30, 200)
    blendOver(dst, px(99, 99, 99, 0), 255)
    expect([...dst]).toEqual([10, 20, 30, 200])
  })

  it('blends red at alpha 128 over opaque blue as (128, 0, 127, 255)', () => {
    // as = 128; wd = div255(255 * 127) = 127; red: (255 * 128 * 2 + 255) / 510 = 128; blue: 127.
    const dst = px(0, 0, 255, 255)
    blendOver(dst, px(255, 0, 0, 255), 128)
    expect([...dst]).toEqual([128, 0, 127, 255])
  })

  it('takes the source colour and alpha over a transparent destination', () => {
    const dst = px(0, 0, 0, 0)
    blendOver(dst, px(200, 100, 50, 255), 128)
    expect([...dst]).toEqual([200, 100, 50, 128])
  })

  it('blends two layers in sequence as computed by hand', () => {
    // Layer 1: red at alpha 128 over nothing: (255, 0, 0, 128).
    // Layer 2: blue at alpha 128 over that: as = 128; wd = div255(128 * 127) = 64; oa = 192;
    // red: (255 * 64 * 2 + 192) / 384 = 85; blue: (255 * 128 * 2 + 192) / 384 = 170.
    const dst = px(0, 0, 0, 0)
    blendOver(dst, px(255, 0, 0, 255), 128)
    expect([...dst]).toEqual([255, 0, 0, 128])
    blendOver(dst, px(0, 0, 255, 255), 128)
    expect([...dst]).toEqual([85, 0, 170, 192])
  })

  it('works over many pixels in place', () => {
    const dst = new Uint8Array([0, 0, 255, 255, 0, 0, 0, 0])
    blendOver(dst, new Uint8Array([255, 0, 0, 255, 7, 8, 9, 255]), 255)
    expect([...dst]).toEqual([255, 0, 0, 255, 7, 8, 9, 255])
  })
})

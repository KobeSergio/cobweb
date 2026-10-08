import { describe, expect, it } from 'vitest'
import { fitWithin, THUMBNAIL_SIDE } from './thumbnail'

describe('fitWithin', () => {
  it('scales the long side to 256 and keeps the ratio', () => {
    expect(fitWithin(2048, 2048, THUMBNAIL_SIDE)).toEqual({ width: 256, height: 256 })
    expect(fitWithin(1000, 500, THUMBNAIL_SIDE)).toEqual({ width: 256, height: 128 })
    expect(fitWithin(300, 900, THUMBNAIL_SIDE)).toEqual({ width: 85, height: 256 })
  })
  it('never enlarges a small image and never returns 0', () => {
    expect(fitWithin(100, 40, THUMBNAIL_SIDE)).toEqual({ width: 100, height: 40 })
    expect(fitWithin(5000, 1, THUMBNAIL_SIDE)).toEqual({ width: 256, height: 1 })
  })
})

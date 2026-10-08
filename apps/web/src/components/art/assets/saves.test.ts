import { describe, expect, it } from 'vitest'
import { addedOrder, inAddedOrder, needsDetails, orderRows, shuffledOrder } from './saves'
import type { AssetItem } from './types'

const item = (key: string, addedAt: number, uploadId: string | null = `u-${key}`): AssetItem => ({
  key,
  fileName: `${key}.png`,
  url: `/api/uploads/u-${key}`,
  mediaType: 'image',
  quantity: 1,
  attributes: [],
  bytes: 10,
  owned: false,
  uploadId,
  addedAt,
})

describe('asset saves', () => {
  it('writes an edit made while the file was uploading once its row exists', () => {
    expect(needsDetails({ quantity: 1, attributes: [] })).toBe(false)
    expect(needsDetails({ quantity: 3, attributes: [] })).toBe(true)
    expect(needsDetails({ quantity: 1, attributes: [{ traitType: 'Name', value: 'Moon' }] })).toBe(true)
  })

  it('numbers stored items in list order and skips the ones still uploading', () => {
    expect(orderRows([item('a', 1), item('b', 2, null), item('c', 3)])).toEqual([
      { uploadId: 'u-a', position: 0 },
      { uploadId: 'u-c', position: 2 },
    ])
  })

  it('shuffles the same way for the same seed, and sorts back by when files were added', () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`f${i}`, i))
    const once = shuffledOrder(items, 42)
    expect(shuffledOrder(items, 42)).toEqual(once)
    expect(once.map((x) => x.key).sort()).toEqual(items.map((x) => x.key).sort())
    expect(once.map((x) => x.key)).not.toEqual(items.map((x) => x.key))
    expect(inAddedOrder(once)).toBe(false)
    expect(addedOrder(once)).toEqual(items)
    expect(inAddedOrder(items)).toBe(true)
  })
})

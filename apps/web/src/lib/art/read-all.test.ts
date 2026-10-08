import { describe, expect, it } from 'vitest'
import { readAll } from './read-all'

describe('readAll', () => {
  it('reads past the 1,000-row page limit, one range at a time', async () => {
    const rows = Array.from({ length: 2_500 }, (_, i) => i)
    const ranges: [number, number][] = []
    const all = await readAll(async (from, to) => {
      ranges.push([from, to])
      return { data: rows.slice(from, to + 1), error: null }
    })
    expect(all).toEqual(rows)
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('stops after an exact multiple with one empty page, and throws on an error', async () => {
    const rows = Array.from({ length: 1_000 }, (_, i) => i)
    let calls = 0
    const all = await readAll(async (from, to) => {
      calls++
      return { data: rows.slice(from, to + 1), error: null }
    })
    expect(all).toHaveLength(1_000)
    expect(calls).toBe(2)
    await expect(readAll(async () => ({ data: null, error: { message: 'boom' } }))).rejects.toThrow(
      'The art could not be loaded',
    )
  })
})

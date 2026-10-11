import { describe, expect, it } from 'vitest'
import { mapLimit } from './pool'

const tick = () => new Promise((resolve) => setTimeout(resolve, 1))

describe('mapLimit', () => {
  it('keeps input order and never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      running++
      peak = Math.max(peak, running)
      await tick()
      running--
      return n * 10
    })
    expect(out).toEqual([50, 10, 40, 20, 30])
    expect(peak).toBe(2)
  })

  it('rejects with the first failure after the work in flight settles, and starts nothing new', async () => {
    const started: number[] = []
    let settled = 0
    const error = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      started.push(n)
      await tick()
      settled++
      if (n === 2) throw new Error('two failed')
      return n
    }).catch((e: unknown) => e)
    expect((error as Error).message).toBe('two failed')
    expect(settled).toBe(started.length)
    expect(started.length).toBeLessThan(6)
  })

  it('rejects with the lowest failing index even when a higher one settles first', async () => {
    const error = await mapLimit([1, 2], 2, async (n) => {
      if (n === 1) {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      }
      throw new Error(`item ${n} failed`)
    }).catch((e: unknown) => e)
    expect((error as Error).message).toBe('item 1 failed')
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async (n: number) => n)).toEqual([])
  })
})

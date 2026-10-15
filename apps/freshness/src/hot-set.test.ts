import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import { HOT_TTL_MS, hotSet } from './hot-set.ts'

const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

describe('hotSet (docs/specs/2026-10-16-freshness-server.md, section 6.3)', () => {
  it('answers joined once per chain and address, whatever the case, with a new entry marked and unread', () => {
    const hot = hotSet()
    const first = hot.join(31337, A.toLowerCase() as Address, 1_000)
    expect(first.joined).toBe(true)
    expect(first.entry).toMatchObject({
      chainId: 31337,
      address: A,
      joinedAt: 1_000,
      requestedAt: 1_000,
      read: null,
      readAt: null,
      extrasReadAt: null,
      marked: true,
    })
    const again = hot.join(31337, A, 2_000)
    expect(again.joined).toBe(false)
    expect(again.entry).toBe(first.entry)
    expect(hot.join(1, A, 3_000).joined).toBe(true)
    expect(hot.size()).toBe(2)
    expect(hot.size(31337)).toBe(1)
  })

  it('refreshes requestedAt on each request and keeps the join time', () => {
    const hot = hotSet()
    hot.join(31337, A, 1_000)
    const { entry } = hot.join(31337, A, 9_000)
    expect([entry.joinedAt, entry.requestedAt]).toEqual([1_000, 9_000])
  })

  it('lets an entry go after 10 minutes without a request and keeps one requested 9 minutes 59 seconds ago', () => {
    const hot = hotSet()
    hot.join(31337, A, 0)
    hot.join(31337, B, 1_000)
    const gone = hot.expire(HOT_TTL_MS)
    expect(gone.map((entry) => entry.address)).toEqual([A])
    expect(hot.onChain(31337).map((entry) => entry.address)).toEqual([B])
  })

  it('counts the 10 minutes from the last request, not from the join', () => {
    const hot = hotSet()
    hot.join(31337, A, 0)
    hot.join(31337, A, 500_000)
    expect(hot.expire(HOT_TTL_MS)).toEqual([])
    expect(hot.expire(500_000 + HOT_TTL_MS).map((entry) => entry.address)).toEqual([A])
  })

  it("empties a chain's list when its last entry leaves, and leaves the other chains", () => {
    const hot = hotSet()
    hot.join(31337, A, 0)
    hot.join(1, A, 500_000)
    hot.expire(600_000)
    expect(hot.onChain(31337)).toEqual([])
    expect(hot.size(31337)).toBe(0)
    expect(hot.onChain(1).map((entry) => entry.chainId)).toEqual([1])
  })
})

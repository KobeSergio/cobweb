import type { ChainGroup, ChainState } from '@cobweb/shared'
import { describe, expect, it } from 'vitest'
import { chainTier, degradedAfterMs, isDegraded, nextDelayMs, tierOf } from './tiers.ts'

/** The chain's time at the read. */
const NOW_S = 1_800_000_000

const group = (overrides: Partial<ChainGroup>): ChainGroup => ({
  id: 0,
  priceWei: '0',
  maxSupply: 3,
  minted: 0,
  startTimestamp: 0,
  flag: false,
  active: false,
  ...overrides,
})

const state = (groups: ChainGroup[], overrides: Partial<ChainState> = {}): ChainState => ({
  block: 100n,
  blockTimestamp: NOW_S,
  maxSupply: 5,
  totalMinted: 0,
  publicMaxMintPerWallet: 2,
  mintOnBehalfActive: false,
  groups,
  ...overrides,
})

/** A collection whose only group is scheduled `offset` seconds from the read. */
const scheduled = (offset: number) => state([group({ startTimestamp: NOW_S + offset })])

describe('tierOf (docs/specs/2026-10-16-freshness-server.md, section 6.6)', () => {
  it('reads fast from 15 s before a scheduled start to 30 s after it, both ends included', () => {
    expect(tierOf(scheduled(16))).toBe('idle')
    expect(tierOf(scheduled(15))).toBe('fast')
    expect(tierOf(scheduled(-30))).toBe('fast')
    expect(tierOf(scheduled(-31))).toBe('idle')
  })

  it('never reads a start of 0 as fast', () => {
    expect(tierOf(state([group({ startTimestamp: 0 })], { blockTimestamp: 10 }))).toBe('idle')
  })

  it('reads live while a group is active with allocation left, and idle once it is sold out either way', () => {
    expect(tierOf(state([group({ flag: true, active: true, minted: 2 })]))).toBe('live')
    expect(tierOf(state([group({ flag: true, active: true, minted: 3 })]))).toBe('idle')
    expect(tierOf(state([group({ flag: true, active: true, minted: 1 })], { totalMinted: 5 }))).toBe('idle')
    expect(tierOf(state([group({ flag: true, active: false })]))).toBe('idle')
  })

  it('reads a collection with no read as live', () => {
    expect(tierOf(null)).toBe('live')
  })
})

describe('chainTier', () => {
  it('takes the fastest of its collections, and is idle with none', () => {
    const live = state([group({ active: true })])
    expect(chainTier([state([]), live])).toBe('live')
    expect(chainTier([live, scheduled(0), null])).toBe('fast')
    expect(chainTier([state([]), null])).toBe('live')
    expect(chainTier([])).toBe('idle')
  })
})

describe('degraded', () => {
  it('is 10 s at the fast and live tiers and 60 s at idle', () => {
    expect([degradedAfterMs('fast'), degradedAfterMs('live'), degradedAfterMs('idle')]).toEqual([
      10_000, 10_000, 60_000,
    ])
  })

  it('is false at exactly the limit and true 1 ms later', () => {
    expect(isDegraded(1_000, 11_000, 'live')).toBe(false)
    expect(isDegraded(1_000, 11_001, 'live')).toBe(true)
    expect(isDegraded(1_000, 61_000, 'idle')).toBe(false)
    expect(isDegraded(1_000, 61_001, 'idle')).toBe(true)
  })
})

describe('nextDelayMs', () => {
  it("counts the tier's interval from the tick's start, and runs at once after a tick that ran longer", () => {
    expect(nextDelayMs('live', [], 10_000, 10_500)).toBe(1_500)
    expect(nextDelayMs('fast', [], 10_000, 12_000)).toBe(0)
    expect(nextDelayMs('idle', [], 10_000, 10_000)).toBe(20_000)
  })

  it("wakes an idle chain when the nearest start's window opens, estimated from the read's block time", () => {
    // Read at 10 s (server time) with the chain at NOW_S: a start 23 s ahead opens its window 8 s later.
    const reads = [
      { state: scheduled(40), readAt: 10_000 },
      { state: scheduled(23), readAt: 10_000 },
    ]
    expect(nextDelayMs('idle', reads, 10_000, 10_000)).toBe(8_000)
    expect(nextDelayMs('idle', reads, 10_000, 12_000)).toBe(6_000)
  })

  it('does not shorten a fast tick for an open window', () => {
    expect(nextDelayMs('fast', [{ state: scheduled(-5), readAt: 10_000 }], 10_000, 10_000)).toBe(1_000)
    expect(nextDelayMs('fast', [{ state: scheduled(15.5), readAt: 10_000 }], 10_000, 10_000)).toBe(1_000)
  })

  it('never wakes sooner than one fast tick after the tick starts while a stale read says the window has opened', () => {
    // Read at 0 s, 23 s before a start: its window opened at 8 s, before this tick began at 10 s.
    expect(nextDelayMs('idle', [{ state: scheduled(23), readAt: 0 }], 10_000, 10_000)).toBe(1_000)
    // The floor counts from the tick's start, not from when the tick ended.
    expect(nextDelayMs('idle', [{ state: scheduled(23), readAt: 0 }], 10_000, 10_400)).toBe(600)
  })
})

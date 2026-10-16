import { chainById } from '@cobweb/shared'
import type { Address } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  MAX_LOGS_PER_WRITE,
  MAX_RANGE,
  PASS_MS,
  passDelayMs,
  safeBlockOf,
  scansOf,
  segmentsOf,
  type Cursor,
  type Scan,
} from './indexer-plan.ts'

/** The n-th cursor of a test, scanned to a block, with its own contract. */
const cursorAt = (n: number, scanned: bigint, range: bigint = MAX_RANGE): Cursor => ({
  collectionId: `collection-${n}`,
  contract: `0x${n.toString(16).padStart(40, '0')}` as Address,
  scanned,
  written: scanned,
  range,
  syncedAt: null,
  writtenAt: 0,
})
const many = (from: number, count: number, scanned: bigint) =>
  Array.from({ length: count }, (_, index) => cursorAt(from + index, scanned))
/** Each scan as `<from>-<to> x<cursors>`. */
const shape = (scans: Scan[]) =>
  scans.map((scan) => `${scan.fromBlock}-${scan.toBlock} x${scan.cursors.length}`)

describe('safeBlockOf (docs/specs/2026-10-16-indexer-overview.md, section 6.3)', () => {
  it("is the head on Anvil, two below it on Arbitrum's 3 confirmations and four below on Ethereum's 5", () => {
    const depth = (id: number) => chainById(id, false)!.confirmations
    expect(safeBlockOf(100n, depth(31337))).toBe(100n)
    expect(safeBlockOf(100n, depth(42161))).toBe(98n)
    expect(safeBlockOf(100n, depth(1))).toBe(96n)
  })

  it('is never below 0', () => {
    expect(safeBlockOf(2n, 5)).toBe(0n)
    expect(safeBlockOf(0n, 1)).toBe(0n)
  })
})

describe('scansOf', () => {
  it('groups the cursors by scanned block in chunks of 100 addresses', () => {
    const scans = scansOf([...many(1, 250, 999n)], 2_000n)
    expect(shape(scans)).toEqual(['1000-1499 x100', '1000-1499 x100', '1000-1499 x50'])
    expect(scans[2]!.cursors[0]!.collectionId).toBe('collection-201')
  })

  it('reads at most 500 blocks a scan, ends at the safe block, and takes the group smallest range', () => {
    expect(shape(scansOf([cursorAt(1, 999n)], 1_200n))).toEqual(['1000-1200 x1'])
    expect(shape(scansOf([cursorAt(1, 999n)], 5_000n))).toEqual(['1000-1499 x1'])
    expect(shape(scansOf([cursorAt(1, 999n), cursorAt(2, 999n, 125n)], 5_000n))).toEqual(['1000-1124 x2'])
  })

  it('takes a range halved down to 1 block', () => {
    expect(shape(scansOf([cursorAt(1, 999n, 1n)], 5_000n))).toEqual(['1000-1000 x1'])
    expect(shape(scansOf([cursorAt(1, 999n, 250n)], 5_000n))).toEqual(['1000-1249 x1'])
  })

  it('plans the front group in full and at most 10 lagging scans, the closest to the front first', () => {
    const cursors = [
      ...many(1, 3, 4_000n),
      ...many(100, 1_050, 3_000n),
      ...many(2_000, 150, 5_000n),
      cursorAt(3_000, 100n),
    ]
    expect(shape(scansOf(cursors, 9_000n))).toEqual([
      '5001-5500 x100',
      '5001-5500 x50',
      '4001-4500 x3',
      ...Array.from({ length: 9 }, () => '3001-3500 x100'),
    ])
  })

  it('plans nothing for a cursor at or above the safe block', () => {
    expect(scansOf([cursorAt(1, 1_200n), cursorAt(2, 1_300n)], 1_200n)).toEqual([])
    expect(shape(scansOf([cursorAt(1, 1_199n), cursorAt(2, 1_200n)], 1_200n))).toEqual(['1200-1200 x1'])
  })
})

describe('segmentsOf', () => {
  const scan: Scan = { cursors: [cursorAt(1, 4n)], fromBlock: 5n, toBlock: 20n }
  const logsAt = (block: bigint, count: number) =>
    Array.from({ length: count }, () => ({ blockNumber: block }))
  const cut = (logs: { blockNumber: bigint }[]) =>
    segmentsOf(logs, scan).map((segment) => `${segment.fromBlock}-${segment.toBlock} x${segment.logs.length}`)

  it('cuts at block boundaries into writes of at most 2,000 logs, the last ending at the scan end', () => {
    expect(MAX_LOGS_PER_WRITE).toBe(2_000)
    expect(cut([...logsAt(12n, 100), ...logsAt(10n, 1_500), ...logsAt(11n, 600)])).toEqual([
      '5-10 x1500',
      '11-20 x700',
    ])
    expect(
      cut([...logsAt(10n, 1_500), ...logsAt(11n, 600), ...logsAt(12n, 100), ...logsAt(13n, 1_500)]),
    ).toEqual(['5-10 x1500', '11-12 x700', '13-20 x1500'])
  })

  it('keeps one block of more than 2,000 logs whole', () => {
    expect(cut([...logsAt(9n, 10), ...logsAt(10n, 2_500), ...logsAt(11n, 10)])).toEqual([
      '5-9 x10',
      '10-10 x2500',
      '11-20 x10',
    ])
  })

  it('covers the scan with one segment when it found no log', () => {
    expect(segmentsOf([], scan)).toEqual([{ fromBlock: 5n, toBlock: 20n, logs: [] }])
  })
})

describe('passDelayMs', () => {
  it('waits 1 s during a backfill, 5 s after a pass that recorded or on a fast or live chain, 20 s otherwise', () => {
    expect(PASS_MS).toEqual({ behind: 1_000, fast: 5_000, idle: 20_000 })
    expect(passDelayMs({ behind: true, recorded: false, tier: 'idle' })).toBe(1_000)
    expect(passDelayMs({ behind: false, recorded: true, tier: null })).toBe(5_000)
    expect(passDelayMs({ behind: false, recorded: false, tier: 'fast' })).toBe(5_000)
    expect(passDelayMs({ behind: false, recorded: false, tier: 'live' })).toBe(5_000)
    expect(passDelayMs({ behind: false, recorded: false, tier: 'idle' })).toBe(20_000)
    expect(passDelayMs({ behind: false, recorded: false, tier: null })).toBe(20_000)
  })

  it('takes the delays it is given', () => {
    const delays = { behind: 200, fast: 500, idle: 700 }
    expect(passDelayMs({ behind: true, recorded: true, tier: 'live' }, delays)).toBe(200)
    expect(passDelayMs({ behind: false, recorded: false, tier: 'live' }, delays)).toBe(500)
    expect(passDelayMs({ behind: false, recorded: false, tier: null }, delays)).toBe(700)
  })
})

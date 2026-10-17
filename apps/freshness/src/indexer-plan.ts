import type { Address } from 'viem'
import type { Tier } from './tiers.ts'

/**
 * The indexer's plan (docs/specs/2026-10-16-indexer-overview.md, section 6.3), pure: the safe block, which
 * logs each pass asks for, how a scan's logs are cut into writes, and when the next pass runs.
 */

/** The most blocks one scan reads, the blocks it reads again included. */
export const MAX_RANGE = 500n
/**
 * The most blocks at and below a cursor's scanned block that a scan reads again. The head comes from one
 * request and the logs from another, so behind a load balancer the node answering `getLogs` can be a few
 * blocks behind and answer up to its own head without an error; the next pass reads those blocks again and
 * writes what the short answer left out. 32 blocks is about 8 s on Arbitrum and a minute on Base. The window
 * shrinks with the range, to one block fewer than it, so a scan at 1 block reads that block alone and no scan
 * reads more than its range.
 */
export const REREAD_BLOCKS = 32n
/** The most collections one scan asks for, and a cursor's chunk until a block it cannot read halves it. */
export const ADDRESSES_PER_SCAN = 100
/** The most scans the groups behind the front take in one pass. */
export const LAGGING_SCANS_PER_PASS = 10
/** The most logs one write carries, unless one block alone holds more. */
export const MAX_LOGS_PER_WRITE = 2_000
/** The wait from one pass's start to the next: during a backfill, while a chain is busy, otherwise. */
export const PASS_MS = { behind: 1_000, fast: 5_000, idle: 20_000 } as const
/** How often the deployed collections are read again. */
export const TARGETS_EVERY_MS = 60_000
/** How often a cursor with nothing to record is written anyway. */
export const CURSOR_WRITE_EVERY_MS = 60_000
/**
 * How long after a cursor's last failed scan its range may double again: a provider that caps a scan below
 * 500 blocks keeps the range one halving under its cap and is probed once a minute.
 */
export const RANGE_GROW_AFTER_MS = 60_000

/**
 * A collection as a pass reads it. `fromBlock` is its deploy block, below which no scan of it starts;
 * `scanned` is how far this process has read and `written` how far the database's cursor has moved, both
 * blocks; `range` is the most blocks its next scan may read, those it reads again included; `chunk` the most
 * collections a scan of it asks for, halved by a scan that fails at a range of 1 block; `syncedAt` the chain's
 * time when a pass last read it to the safe block (Unix seconds); `writtenAt` when its cursor was last
 * written; `failedAt` when its last scan failed, undefined until one does.
 */
export type Cursor = {
  collectionId: string
  contract: Address
  fromBlock: bigint
  scanned: bigint
  written: bigint
  range: bigint
  chunk: number
  syncedAt: number | null
  writtenAt: number
  failedAt?: number
}

/** One `getLogs` call: the cursors whose contracts it asks for, and its blocks, both ends included. */
export type Scan = { cursors: Cursor[]; fromBlock: bigint; toBlock: bigint }

/** Two blocks in ascending order, for a sort. */
export const byBlock = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * The highest block buried under the chain's confirmations (the head counted): `head - confirmations + 1`,
 * never below 0.
 */
export function safeBlockOf(head: bigint, confirmations: number): bigint {
  const safe = head - BigInt(confirmations) + 1n
  return safe > 0n ? safe : 0n
}

/**
 * The scans of a pass: the cursors below the safe block grouped by `scanned`. The front group (the highest
 * `scanned`) is planned in full, one scan per chunk of addresses (100, or the group's smallest chunk); the
 * groups behind it take at most 10 scans in all, the closest to the front first, so they reach it and merge.
 * The group's smallest range (at least 1 block, at most 500) bounds each of its scans, the blocks read again
 * included: a scan starts the window (32 blocks, or one fewer than the range when that is smaller) below
 * `scanned + 1`, never below the lowest deploy block of its cursors, so the blocks near the head are read by
 * at least two passes; and the group's scans end together, at the lower of the safe block and the range's last
 * block from the group's lowest start. At 500 blocks a backfill reads 468 new blocks a scan.
 */
export function scansOf(cursors: readonly Cursor[], safe: bigint): Scan[] {
  const groups = new Map<bigint, Cursor[]>()
  for (const cursor of cursors) {
    if (cursor.scanned >= safe) continue
    const group = groups.get(cursor.scanned)
    if (group) group.push(cursor)
    else groups.set(cursor.scanned, [cursor])
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => byBlock(b, a))
  const scans: Scan[] = []
  let lagging = 0
  for (const [index, [scanned, group]] of ordered.entries()) {
    const range = group.reduce((least, cursor) => {
      const own = cursor.range < 1n ? 1n : cursor.range
      return own < least ? own : least
    }, MAX_RANGE)
    const chunk = group.reduce(
      (least, cursor) => Math.max(1, Math.min(least, cursor.chunk)),
      ADDRESSES_PER_SCAN,
    )
    const window = range - 1n < REREAD_BLOCKS ? range - 1n : REREAD_BLOCKS
    const reread = scanned + 1n - window
    /** Where a scan of these cursors starts: the window, never below their lowest deploy block. */
    const startOf = (some: readonly Cursor[]) => {
      const deployed = some.reduce(
        (least, cursor) => (cursor.fromBlock < least ? cursor.fromBlock : least),
        some[0]!.fromBlock,
      )
      return deployed > reread ? deployed : reread
    }
    // From the group's lowest start, so no scan of the group spans more than the range.
    const end = startOf(group) + range - 1n
    const toBlock = end < safe ? end : safe
    for (let start = 0; start < group.length; start += chunk) {
      if (index > 0) {
        if (lagging === LAGGING_SCANS_PER_PASS) return scans
        lagging++
      }
      const slice = group.slice(start, start + chunk)
      scans.push({ cursors: slice, fromBlock: startOf(slice), toBlock })
    }
  }
  return scans
}

/**
 * A scan's logs cut at block boundaries into writes of at most `max` logs each, unless one block alone holds
 * more, which is written whole. The segments cover the scan's blocks without a gap: the first starts at its
 * `fromBlock` and the last ends at its `toBlock`, logs or not.
 */
export function segmentsOf<T extends { blockNumber: bigint }>(
  logs: readonly T[],
  scan: Scan,
  max: number = MAX_LOGS_PER_WRITE,
): { fromBlock: bigint; toBlock: bigint; logs: T[] }[] {
  // A stable sort: the logs of one block keep the order the node answered them in.
  const sorted = [...logs].sort((a, b) => byBlock(a.blockNumber, b.blockNumber))
  const segments: { fromBlock: bigint; toBlock: bigint; logs: T[] }[] = []
  let current: T[] = []
  let from = scan.fromBlock
  for (let index = 0; index < sorted.length;) {
    const block = sorted[index]!.blockNumber
    let end = index
    while (end < sorted.length && sorted[end]!.blockNumber === block) end++
    if (current.length > 0 && current.length + (end - index) > max) {
      segments.push({ fromBlock: from, toBlock: block - 1n, logs: current })
      from = block
      current = []
    }
    current = current.concat(sorted.slice(index, end))
    index = end
  }
  segments.push({ fromBlock: from, toBlock: scan.toBlock, logs: current })
  return segments
}

/**
 * The wait from a pass's start to the next: `behind` while a cursor is still below the safe block after it (a
 * backfill), else `fast` when it recorded anything or the chain's reader is at its fast or live tier, else
 * `idle`.
 */
export function passDelayMs(
  pass: { behind: boolean; recorded: boolean; tier: Tier | null },
  delays: { behind: number; fast: number; idle: number } = PASS_MS,
): number {
  if (pass.behind) return delays.behind
  return pass.recorded || pass.tier === 'fast' || pass.tier === 'live' ? delays.fast : delays.idle
}

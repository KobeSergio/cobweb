import type { Address } from 'viem'
import type { Tier } from './tiers.ts'

/**
 * The indexer's plan (docs/specs/2026-10-16-indexer-overview.md, section 6.3), pure: the safe block, which
 * logs each pass asks for, how a scan's logs are cut into writes, and when the next pass runs.
 */

/** The most blocks one scan reads. */
export const MAX_RANGE = 500n
/** The most collections one scan asks for. */
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
 * A collection as a pass reads it. `scanned` is how far this process has read and `written` how far the
 * database's cursor has moved, both blocks; `range` is the blocks its next scan may read; `syncedAt` the
 * chain's time when a pass last read it to the safe block (Unix seconds); `writtenAt` when its cursor was
 * last written.
 */
export type Cursor = {
  collectionId: string
  contract: Address
  scanned: bigint
  written: bigint
  range: bigint
  syncedAt: number | null
  writtenAt: number
}

/** One `getLogs` call: the cursors whose contracts it asks for, and its blocks, both ends included. */
export type Scan = { cursors: Cursor[]; fromBlock: bigint; toBlock: bigint }

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
 * `scanned`) is planned in full, one scan per 100 addresses; the groups behind it take at most 10 scans in
 * all, the closest to the front first, so they reach it and merge. Each scan runs from `scanned + 1` to the
 * lower of the safe block and `scanned` plus the group's smallest range.
 */
export function scansOf(cursors: readonly Cursor[], safe: bigint): Scan[] {
  const groups = new Map<bigint, Cursor[]>()
  for (const cursor of cursors) {
    if (cursor.scanned >= safe) continue
    const group = groups.get(cursor.scanned)
    if (group) group.push(cursor)
    else groups.set(cursor.scanned, [cursor])
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a > b ? -1 : a < b ? 1 : 0))
  const scans: Scan[] = []
  let lagging = 0
  for (const [index, [scanned, group]] of ordered.entries()) {
    const range = group.reduce((least, cursor) => (cursor.range < least ? cursor.range : least), MAX_RANGE)
    const end = scanned + range
    const toBlock = end < safe ? end : safe
    for (let start = 0; start < group.length; start += ADDRESSES_PER_SCAN) {
      if (index > 0) {
        if (lagging === LAGGING_SCANS_PER_PASS) return scans
        lagging++
      }
      scans.push({
        cursors: group.slice(start, start + ADDRESSES_PER_SCAN),
        fromBlock: scanned + 1n,
        toBlock,
      })
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
  const sorted = [...logs].sort((a, b) =>
    a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0,
  )
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

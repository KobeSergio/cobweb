import type { ChainConfig, StateActivity } from '@cobweb/shared'
import type { Address, PublicClient } from 'viem'
import { ACTIVITY_LAG_MAX_S, activityOf as activityFrom, type Summary } from './activity.ts'
import type { IndexerOptions } from './config.ts'
import { errorName, failureLine, type IndexerHealth } from './health.ts'
import { IndexerWriteError, type IndexerDb, type Target } from './indexer-db.ts'
import {
  CURSOR_WRITE_EVERY_MS,
  MAX_RANGE,
  PASS_MS,
  passDelayMs,
  safeBlockOf,
  scansOf,
  segmentsOf,
  TARGETS_EVERY_MS,
  type Cursor,
  type Scan,
} from './indexer-plan.ts'
import { eventBlocksOf, INDEX_EVENTS, recordsOf, type IndexLog, type Records } from './indexer-records.ts'
import type { Tier } from './tiers.ts'

export type { IndexerHealth } from './health.ts'

/** Block times read at once, at most. */
const TIMES_AT_ONCE = 10
/** An unreadable deploy is logged at most once a minute per collection, whatever the targets' pace. */
const DEPLOY_LOG_EVERY_MS = 60_000

const hasRecords = (records: Records) =>
  records.mints.length + records.owners.length + records.airdrops.length + records.withdrawals.length > 0

/**
 * The indexer of one chain (docs/specs/2026-10-16-indexer-overview.md, section 6.5). Each pass loads the
 * chain's summaries until they have loaded, reads the targets every minute (and after a gap refusal),
 * starting a new one at its deploy transaction's block, reads the head, then scans each cursor's logs up to
 * the safe block in the plan's scans and writes what they record, segment by segment. Passes never overlap;
 * the next starts the plan's delay after this one started, at once when it ran longer, and the fast delay
 * after a pass with any failure (Review Focus 2). `activityOf` answers from memory, for the state body; the
 * request path reads no database.
 */
export function chainIndexer(
  chain: ChainConfig,
  client: PublicClient,
  db: IndexerDb,
  options: { tier(): Tier | null; passMs?: IndexerOptions['passMs']; targetsEveryMs?: number },
): {
  activityOf(address: Address, blockTimestamp: number): StateActivity | null
  health(): IndexerHealth
  stop(): Promise<void>
} {
  const delays = options.passMs ?? PASS_MS
  const targetsEveryMs = options.targetsEveryMs ?? TARGETS_EVERY_MS
  /** The cursors by collection id, and each collection's id by its lowercase contract. */
  const cursors = new Map<string, Cursor>()
  const idByContract = new Map<string, string>()
  const summaries = new Map<string, Summary>()
  let summariesLoaded = false
  let targetsReadAt: number | null = null
  let targetsDue = false
  const deployLoggedAt = new Map<string, number>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let stopped = false
  let safeBlock: bigint | null = null
  let headTime: number | null = null
  let lastPassAt: number | null = null
  let failedPasses = 0
  let lastError: string | null = null
  let unpaired = 0

  /** Counts a failure for /health and logs it as its name, its code and viem's short message, never more. */
  function failed(line: string, error: unknown): void {
    failedPasses++
    lastError = errorName(error)
    console.error(`${line}: ${failureLine(error)}`)
  }

  function setCursor(cursor: Cursor): void {
    cursors.set(cursor.collectionId, cursor)
    idByContract.set(cursor.contract.toLowerCase(), cursor.collectionId)
  }

  /** A cursor at the database's block, as a new one or after a gap refusal; a known one keeps its range. */
  const cursorOf = (target: Target, indexed: bigint, now: number): Cursor => ({
    collectionId: target.collectionId,
    contract: target.contract,
    scanned: indexed,
    written: indexed,
    range: cursors.get(target.collectionId)?.range ?? MAX_RANGE,
    syncedAt: target.syncedAt,
    writtenAt: now,
  })

  /** A target without a cursor: its deploy transaction's block, then its cursor there. */
  async function startTarget(target: Target, now: number): Promise<void> {
    let block: bigint
    try {
      block = (await client.getTransactionReceipt({ hash: target.deployTx })).blockNumber
    } catch {
      const logged = deployLoggedAt.get(target.collectionId)
      if (logged === undefined || now - logged >= DEPLOY_LOG_EVERY_MS) {
        deployLoggedAt.set(target.collectionId, now)
        console.error(
          `The deploy of ${target.collectionId} on ${chain.name} could not be read; it is tried again in a minute.`,
        )
      }
      return
    }
    await db.start(target.collectionId, block)
    deployLoggedAt.delete(target.collectionId)
    setCursor({ ...cursorOf(target, block - 1n, now), syncedAt: null })
    // A cursor this process starts has no record yet: its summary is empty until a write answers one, so the
    // state body carries 0 holders once it reads synced rather than nothing until a mint (Review Focus 4).
    if (!summaries.has(target.collectionId))
      summaries.set(target.collectionId, {
        collectionId: target.collectionId,
        contract: target.contract,
        holders: 0,
        syncedAt: null,
        recentMints: [],
      })
  }

  /** The targets: a new one starts, the database's cursor is taken only when new or after a gap refusal. */
  async function readTargets(now: number): Promise<void> {
    const targets = await db.targets(chain.id)
    const listed = new Set(targets.map((target) => target.collectionId))
    for (const [id, cursor] of cursors)
      if (!listed.has(id)) {
        cursors.delete(id)
        idByContract.delete(cursor.contract.toLowerCase())
      }
    for (const id of summaries.keys()) if (!listed.has(id)) summaries.delete(id)
    for (const target of targets) {
      if (stopped) return
      if (target.indexedBlock === null) await startTarget(target, now)
      else if (targetsDue || !cursors.has(target.collectionId))
        setCursor(cursorOf(target, target.indexedBlock, now))
    }
    targetsReadAt = now
    targetsDue = false
  }

  /** The times of the blocks not read yet, at most 10 at once. */
  async function readTimes(blocks: readonly bigint[], times: Map<bigint, number>): Promise<void> {
    const missing = blocks.filter((block) => !times.has(block))
    for (let at = 0; at < missing.length; at += TIMES_AT_ONCE) {
      const read = await Promise.all(
        missing.slice(at, at + TIMES_AT_ONCE).map((blockNumber) => client.getBlock({ blockNumber })),
      )
      for (const block of read) times.set(block.number, Number(block.timestamp))
    }
  }

  /**
   * One scan: its logs, then each segment's records written or deferred. Answers whether it failed and
   * recorded.
   */
  async function runScan(
    scan: Scan,
    safe: bigint,
    head: { timestamp: number },
  ): Promise<{ failed: boolean; recorded: boolean }> {
    let logs: IndexLog[]
    try {
      logs = (await client.getLogs({
        address: scan.cursors.map((cursor) => cursor.contract),
        events: INDEX_EVENTS,
        fromBlock: scan.fromBlock,
        toBlock: scan.toBlock,
        strict: true,
      })) as unknown as IndexLog[]
    } catch (error) {
      for (const cursor of scan.cursors) cursor.range = cursor.range > 1n ? cursor.range / 2n : 1n
      failed(
        `The index scan of blocks ${scan.fromBlock} to ${scan.toBlock} on ${chain.name} failed, so its range halves`,
        error,
      )
      return { failed: true, recorded: false }
    }
    // A success doubles the range, up to 500, rather than restoring 500 at once: on a provider whose getLogs
    // cap is below 500 blocks, at most one scan then fails between successes, not one per halving.
    for (const cursor of scan.cursors)
      cursor.range = cursor.range * 2n > MAX_RANGE ? MAX_RANGE : cursor.range * 2n
    const collections = new Map(
      scan.cursors.map((cursor) => [cursor.contract.toLowerCase(), cursor.collectionId]),
    )
    const times = new Map<bigint, number>()
    let recorded = false
    for (const segment of segmentsOf(logs, scan)) {
      if (stopped) break
      try {
        await readTimes(eventBlocksOf(segment.logs), times)
      } catch (error) {
        failed(`An index pass on ${chain.name} failed`, error)
        return { failed: true, recorded }
      }
      const { records, unpaired: missed } = recordsOf(segment.logs, collections, times)
      const toSafe = segment.toBlock === safe
      const now = Date.now()
      const due =
        hasRecords(records) ||
        (toSafe && scan.cursors.some((cursor) => cursor.syncedAt === null)) ||
        scan.cursors.some((cursor) => now - cursor.writtenAt >= CURSOR_WRITE_EVERY_MS)
      if (due) {
        const lowest = scan.cursors.reduce(
          (least, cursor) => (cursor.written < least ? cursor.written : least),
          scan.cursors[0]!.written,
        )
        try {
          const answered = await db.record({
            chainId: chain.id,
            fromBlock: lowest + 1n,
            toBlock: segment.toBlock,
            syncedAt: toSafe ? head.timestamp : null,
            collections: scan.cursors.map((cursor) => cursor.collectionId),
            records,
          })
          for (const summary of answered)
            if (cursors.has(summary.collectionId)) summaries.set(summary.collectionId, summary)
        } catch (error) {
          // The scan's deferred blocks are read again from the database's cursor on the next pass.
          for (const cursor of scan.cursors) cursor.scanned = cursor.written
          if (error instanceof IndexerWriteError && error.gap) targetsDue = true
          failed(`The index write on ${chain.name} failed`, error)
          return { failed: true, recorded }
        }
        for (const cursor of scan.cursors) {
          cursor.written = segment.toBlock
          cursor.writtenAt = now
        }
        recorded ||= hasRecords(records)
      }
      for (const cursor of scan.cursors) {
        cursor.scanned = segment.toBlock
        if (toSafe) cursor.syncedAt = head.timestamp
      }
      // Counted once its segment is done, so a segment read again after a failed write is not counted twice.
      for (const tx of missed) {
        unpaired++
        console.error(
          `A mint or airdrop in ${tx} on ${chain.name} did not pair with its transfers and is not recorded.`,
        )
      }
    }
    return { failed: false, recorded }
  }

  /** One pass; answers the wait to the next. */
  async function pass(): Promise<number> {
    const startedAt = Date.now()
    let anyFailure = false
    let recorded = false
    const wait = (behind: boolean) => {
      // A pass with a failure waits the fast delay: an outage is neither retried every second on the quota
      // the reader shares nor left for an idle chain's 20 s (Review Focus 2).
      const delay = anyFailure ? delays.fast : passDelayMs({ behind, recorded, tier: options.tier() }, delays)
      return Math.max(0, startedAt + delay - Date.now())
    }
    if (!summariesLoaded)
      try {
        for (const summary of await db.summaries(chain.id)) summaries.set(summary.collectionId, summary)
        summariesLoaded = true
      } catch (error) {
        anyFailure = true
        failed(`An index pass on ${chain.name} failed`, error)
      }
    if (!stopped && (targetsDue || targetsReadAt === null || startedAt - targetsReadAt >= targetsEveryMs))
      try {
        await readTargets(startedAt)
      } catch (error) {
        anyFailure = true
        failed(`An index pass on ${chain.name} failed`, error)
      }
    if (stopped) return 0
    let head: { number: bigint; timestamp: number }
    try {
      const block = await client.getBlock({ blockTag: 'latest' })
      head = { number: block.number, timestamp: Number(block.timestamp) }
    } catch (error) {
      failed(`An index pass on ${chain.name} failed`, error)
      anyFailure = true
      lastPassAt = Date.now()
      return wait(false)
    }
    const safe = safeBlockOf(head.number, chain.confirmations)
    safeBlock = safe
    headTime = head.timestamp
    for (const scan of scansOf([...cursors.values()], safe)) {
      if (stopped) break
      const outcome = await runScan(scan, safe, head)
      anyFailure ||= outcome.failed
      recorded ||= outcome.recorded
    }
    lastPassAt = Date.now()
    return wait([...cursors.values()].some((cursor) => cursor.scanned < safe))
  }

  function run(): void {
    timer = null
    running = pass()
      .catch((error: unknown) => {
        // A pass that threw outside its own steps counts as failed, and the next comes after the idle delay.
        failed(`An index pass on ${chain.name} failed`, error)
        return delays.idle
      })
      .then((delay) => {
        running = null
        if (!stopped) timer = setTimeout(run, delay)
      })
  }
  run()

  return {
    activityOf(address, blockTimestamp) {
      const id = idByContract.get(address.toLowerCase())
      if (id === undefined) return null
      return activityFrom(summaries.get(id), cursors.get(id)?.syncedAt ?? null, blockTimestamp)
    },
    health() {
      const all = [...cursors.values()]
      return {
        collections: all.length,
        behind: all.filter(
          (cursor) =>
            cursor.syncedAt === null ||
            (headTime !== null && headTime - cursor.syncedAt > ACTIVITY_LAG_MAX_S),
        ).length,
        block: safeBlock === null ? null : Number(safeBlock),
        lastPassAt: lastPassAt === null ? null : new Date(lastPassAt).toISOString(),
        failedPasses,
        lastError,
        unpaired,
      }
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      await running
    },
  }
}

export type ChainIndexer = ReturnType<typeof chainIndexer>

import type { ChainConfig, StateActivity } from '@cobweb/shared'
import type { Address, PublicClient } from 'viem'
import { ACTIVITY_LAG_MAX_S, activityOf as activityFrom, type Summary } from './activity.ts'
import type { IndexerOptions } from './config.ts'
import { failureLine, failureName, type IndexerHealth } from './health.ts'
import { IndexerWriteError, type IndexerDb, type Target } from './indexer-db.ts'
import {
  ADDRESSES_PER_SCAN,
  CURSOR_WRITE_EVERY_MS,
  MAX_RANGE,
  PASS_MS,
  passDelayMs,
  RANGE_GROW_AFTER_MS,
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
/**
 * A line said again is logged at most once a minute, whatever the passes' pace: a failure of one kind on a
 * chain, and per collection a deploy that cannot be read, a start that failed or a block that cannot be read.
 * Every failure still counts on /health.
 */
const LOG_EVERY_MS = 60_000

/** The steps whose failures share one log line a minute on a chain (Minor 5). */
type FailureKind = 'summaries' | 'targets' | 'head' | 'scan' | 'times' | 'write' | 'pass'

/**
 * Whether a segment holds any record: one that does is written at once, the records the scan read again in
 * its window included, so a log a lagging node's short answer left out of a segment written anyway lands with
 * the next pass's read of its block. The writes are idempotent; a segment with no record waits for the
 * minute's write.
 */
const hasRecords = (records: Records) =>
  records.mints.length + records.owners.length + records.airdrops.length + records.withdrawals.length > 0

/**
 * Whether a segment's records hold one above its collection's written block: news, which sets the pass's fast
 * pace. The records a scan reads again in its window are written again but are not news, so they leave an
 * idle chain at its idle pace.
 */
function hasNewRecords(records: Records, cursors: readonly Cursor[]): boolean {
  const written = new Map(cursors.map((cursor) => [cursor.collectionId, cursor.written]))
  const isNew = (record: { collectionId: string; block: number }) => {
    const block = written.get(record.collectionId)
    return block === undefined || BigInt(record.block) > block
  }
  return (
    records.mints.some(isNew) ||
    records.owners.some(isNew) ||
    records.airdrops.some(isNew) ||
    records.withdrawals.some(isNew)
  )
}

/** The lowest of the cursors' blocks that `blockOf` names. */
const lowestOf = (cursors: readonly Cursor[], blockOf: (cursor: Cursor) => bigint): bigint =>
  cursors.reduce((least, cursor) => (blockOf(cursor) < least ? blockOf(cursor) : least), blockOf(cursors[0]!))

/**
 * The indexer of one chain (docs/specs/2026-10-16-indexer-overview.md, section 6.5). Each pass loads the
 * chain's summaries until they have loaded, reads the targets every minute (and after a gap refusal),
 * starting a new one at its deploy transaction's block, reads the head, then scans each cursor's logs up to
 * the safe block in the plan's scans, each reading again up to `REREAD_BLOCKS` blocks at and below the cursor's
 * scanned block within its range, and writes what they record, segment by segment: a segment with any record
 * at once, one without once a minute. A scan that fails halves its range, then at 1 block its
 * chunk of collections, so a block one collection's logs make unreadable stops that collection alone. Passes
 * never overlap; the next starts the plan's delay after this one started, at once when it ran longer, and the
 * fast delay after a pass with any failure (Review Focus 2); a failed write ends its pass. `activityOf`
 * answers from memory, for the state body; the request path reads no database.
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
  /** When each line said again was last logged: a failure kind, or `deploy:` or `block:` and a collection id. */
  const loggedAt = new Map<string, number>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let stopped = false
  let safeBlock: bigint | null = null
  let headTime: number | null = null
  let lastPassAt: number | null = null
  let failedPasses = 0
  let lastError: string | null = null
  let unpaired = 0

  /** Whether the line under `key` may be logged at `now`: at most once a minute. Notes it when it may. */
  function mayLog(key: string, now: number): boolean {
    const logged = loggedAt.get(key)
    if (logged !== undefined && now - logged < LOG_EVERY_MS) return false
    loggedAt.set(key, now)
    return true
  }

  /** Counts a failure for /health, as its name and codes, never its message. */
  function counted(error: unknown): void {
    failedPasses++
    lastError = failureName(error)
  }

  /**
   * Counts a failure and logs it as its name, its codes and viem's short message, never more: at most once a
   * minute for each kind, so a lasting fault does not log every pass (Minor 5).
   */
  function failed(kind: FailureKind, line: string, error: unknown): void {
    counted(error)
    if (mayLog(kind, Date.now())) console.error(`${line}: ${failureLine(error)}`)
  }

  function setCursor(cursor: Cursor): void {
    cursors.set(cursor.collectionId, cursor)
    idByContract.set(cursor.contract.toLowerCase(), cursor.collectionId)
  }

  /**
   * A cursor at the database's block, as a new one or after a gap refusal; a known one keeps its range, its
   * chunk and when its last scan failed.
   */
  const cursorOf = (target: Target, indexed: bigint, now: number): Cursor => {
    const known = cursors.get(target.collectionId)
    return {
      collectionId: target.collectionId,
      contract: target.contract,
      fromBlock: target.fromBlock ?? indexed + 1n,
      scanned: indexed,
      written: indexed,
      range: known?.range ?? MAX_RANGE,
      chunk: known?.chunk ?? ADDRESSES_PER_SCAN,
      syncedAt: target.syncedAt,
      writtenAt: now,
      failedAt: known?.failedAt,
    }
  }

  /**
   * A target without a cursor: its deploy transaction's block, then its cursor there. A receipt that cannot
   * be read waits for the next targets read; a start that fails counts as a failure and is retried there too,
   * while the other targets go on (Minor 6). Each is logged at most once a minute per collection. Answers
   * whether the start failed.
   */
  async function startTarget(target: Target, now: number): Promise<boolean> {
    let block: bigint
    try {
      block = (await client.getTransactionReceipt({ hash: target.deployTx })).blockNumber
    } catch {
      if (mayLog(`deploy:${target.collectionId}`, now))
        console.error(
          `The deploy of ${target.collectionId} on ${chain.name} could not be read; it is tried again in a minute.`,
        )
      return false
    }
    try {
      await db.start(target.collectionId, block)
    } catch (error) {
      counted(error)
      if (mayLog(`deploy:${target.collectionId}`, now))
        console.error(
          `The cursor of ${target.collectionId} on ${chain.name} could not be started; it is tried again in a minute: ${failureLine(error)}`,
        )
      return true
    }
    loggedAt.delete(`deploy:${target.collectionId}`)
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
    return false
  }

  /**
   * The targets: a new one starts, the database's cursor is taken only when new or after a gap refusal.
   * Answers whether a start failed.
   */
  async function readTargets(now: number): Promise<boolean> {
    const targets = await db.targets(chain.id)
    const listed = new Set(targets.map((target) => target.collectionId))
    for (const [id, cursor] of cursors)
      if (!listed.has(id)) {
        cursors.delete(id)
        idByContract.delete(cursor.contract.toLowerCase())
      }
    for (const id of summaries.keys()) if (!listed.has(id)) summaries.delete(id)
    let startFailed = false
    for (const target of targets) {
      if (stopped) return startFailed
      if (target.indexedBlock === null) startFailed = (await startTarget(target, now)) || startFailed
      else if (targetsDue || !cursors.has(target.collectionId))
        setCursor(cursorOf(target, target.indexedBlock, now))
    }
    targetsReadAt = now
    targetsDue = false
    return startFailed
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
   * A scan whose `getLogs` failed. Each cursor's range halves, down to 1 block; a cursor already at 1 block
   * halves its chunk instead (Important 2), so the collections of its scan whose logs a provider answers pass a
   * block whose logs it cannot. A collection scanned alone at 1 block waits at its next block, logged at most
   * once a minute for that collection in place of the scan's line.
   */
  function scanFailed(scan: Scan, error: unknown): void {
    const failedAt = Date.now()
    const half = Math.max(1, Math.floor(scan.cursors.length / 2))
    let chunked = false
    for (const cursor of scan.cursors) {
      if (cursor.range > 1n) cursor.range = cursor.range / 2n
      else {
        cursor.range = 1n
        cursor.chunk = Math.min(cursor.chunk, half)
        chunked = true
      }
      cursor.failedAt = failedAt
    }
    const [alone] = scan.cursors
    if (alone && scan.cursors.length === 1 && chunked) {
      counted(error)
      if (mayLog(`block:${alone.collectionId}`, failedAt))
        console.error(
          `The block ${alone.scanned + 1n} of ${alone.collectionId} on ${chain.name} cannot be read; the collection waits there: ${failureLine(error)}`,
        )
      return
    }
    failed(
      'scan',
      `The index scan of blocks ${scan.fromBlock} to ${scan.toBlock} on ${chain.name} failed, so ${
        chunked ? 'it scans half as many collections at a time' : 'its range halves'
      }`,
      error,
    )
  }

  /**
   * One scan: its logs, then each segment's records written or deferred. Answers whether it failed, whether
   * its write failed, and whether it wrote a new record.
   */
  async function runScan(
    scan: Scan,
    safe: bigint,
    head: { timestamp: number },
  ): Promise<{ failed: boolean; writeFailed: boolean; recorded: boolean }> {
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
      scanFailed(scan, error)
      return { failed: true, writeFailed: false, recorded: false }
    }
    // A success doubles the range, up to 500, once a minute has passed since the cursor's last failed scan
    // (or when none has failed): a provider that caps a scan below 500 blocks keeps the range one halving
    // under its cap, and while the cursor is behind it is probed once a minute rather than every other scan.
    // Back at 500 blocks, the cursor's chunk is the full 100 again.
    const scannedAt = Date.now()
    for (const cursor of scan.cursors) {
      const mayGrow = cursor.failedAt === undefined || scannedAt - cursor.failedAt >= RANGE_GROW_AFTER_MS
      if (mayGrow) cursor.range = cursor.range * 2n > MAX_RANGE ? MAX_RANGE : cursor.range * 2n
      if (cursor.range === MAX_RANGE) cursor.chunk = ADDRESSES_PER_SCAN
    }
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
        failed('times', `An index pass on ${chain.name} failed`, error)
        return { failed: true, writeFailed: false, recorded }
      }
      const { records, unpaired: missed } = recordsOf(segment.logs, collections, times)
      // The blocks above this have not been read by this process: an unpaired event at or below it was
      // counted when its block was first read.
      const readBefore = lowestOf(scan.cursors, (cursor) => cursor.scanned)
      const fresh = hasNewRecords(records, scan.cursors)
      const toSafe = segment.toBlock === safe
      const now = Date.now()
      const due =
        hasRecords(records) ||
        (toSafe && scan.cursors.some((cursor) => cursor.syncedAt === null)) ||
        scan.cursors.some((cursor) => now - cursor.writtenAt >= CURSOR_WRITE_EVERY_MS)
      if (due) {
        // From the segment's start, which reads blocks already written again (the gap check accepts the
        // overlap, and every row is keyed), or from one above the lowest written block when blocks deferred
        // since run further back than the re-read.
        const above = lowestOf(scan.cursors, (cursor) => cursor.written) + 1n
        try {
          const answered = await db.record({
            chainId: chain.id,
            fromBlock: segment.fromBlock < above ? segment.fromBlock : above,
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
          failed('write', `The index write on ${chain.name} failed`, error)
          return { failed: true, writeFailed: true, recorded }
        }
        for (const cursor of scan.cursors) {
          if (segment.toBlock > cursor.written) cursor.written = segment.toBlock
          cursor.writtenAt = now
        }
        // Only news sets the fast pace, not a record the window read again.
        recorded ||= fresh
      }
      for (const cursor of scan.cursors) {
        if (segment.toBlock > cursor.scanned) cursor.scanned = segment.toBlock
        if (toSafe) cursor.syncedAt = head.timestamp
      }
      // Counted once its segment is done, so a segment read again after a failed write is not counted twice,
      // and once per event, at the first read of its block (Decision 4).
      const blockOfTx = new Map(
        segment.logs.map((log) => [log.transactionHash.toLowerCase(), log.blockNumber]),
      )
      for (const tx of missed) {
        const block = blockOfTx.get(tx)
        if (block !== undefined && block <= readBefore) continue
        unpaired++
        console.error(
          `A mint or airdrop in ${tx} on ${chain.name} did not pair with its transfers and is not recorded.`,
        )
      }
    }
    return { failed: false, writeFailed: false, recorded }
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
        failed('summaries', `An index pass on ${chain.name} failed`, error)
      }
    if (!stopped && (targetsDue || targetsReadAt === null || startedAt - targetsReadAt >= targetsEveryMs))
      try {
        if (await readTargets(startedAt)) anyFailure = true
      } catch (error) {
        anyFailure = true
        failed('targets', `An index pass on ${chain.name} failed`, error)
      }
    if (stopped) return 0
    let head: { number: bigint; timestamp: number }
    try {
      const block = await client.getBlock({ blockTag: 'latest' })
      head = { number: block.number, timestamp: Number(block.timestamp) }
    } catch (error) {
      failed('head', `An index pass on ${chain.name} failed`, error)
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
      // A failed write ends the pass: the scans left would write to a database that just failed, and the
      // next pass, after the fast delay, reads again from the written blocks (Minor 5).
      if (outcome.writeFailed) break
    }
    lastPassAt = Date.now()
    return wait([...cursors.values()].some((cursor) => cursor.scanned < safe))
  }

  function run(): void {
    timer = null
    running = pass()
      .catch((error: unknown) => {
        // A pass that threw outside its own steps counts as failed, and the next comes after the idle delay.
        failed('pass', `An index pass on ${chain.name} failed`, error)
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

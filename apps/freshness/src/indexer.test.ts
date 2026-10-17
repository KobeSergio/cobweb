import { chainById, type ChainConfig } from '@cobweb/shared'
import {
  getAddress,
  HttpRequestError,
  TransactionReceiptNotFoundError,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Summary } from './activity.ts'
import { IndexerWriteError, type IndexerDb, type RecordWrite, type Target } from './indexer-db.ts'
import type { IndexLog } from './indexer-records.ts'
import { chainIndexer } from './indexer.ts'
import type { Tier } from './tiers.ts'

/** Anvil asks for 1 confirmation, so the safe block is the head. */
const ANVIL: ChainConfig = chainById(31337, false)!
const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const MINTER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const ID_A = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const ID_B = '7d2c9e10-5b44-4a6f-9c3e-2f1b8a7d6e5c'
const DEPLOY_A: Hex = `0x${'da'.repeat(32)}`
const DEPLOY_B: Hex = `0x${'db'.repeat(32)}`
const TX = (n: bigint): Hex => `0x${n.toString(16).padStart(64, '0')}`
/** Each block's time: 1,800,000,000 plus the block. */
const timeOf = (block: bigint) => 1_800_000_000 + Number(block)
const NO_RECORDS = { mints: [], owners: [], airdrops: [], withdrawals: [] }

/** A mint of one token in its own transaction at a block, decoded as getLogs answers it. */
const mintAt = (block: bigint, tokenId: bigint, contract: Address = A, amount = 1n): IndexLog[] => [
  {
    address: contract,
    eventName: 'Transfer',
    args: { from: zeroAddress, to: MINTER, tokenId },
    blockNumber: block,
    logIndex: 0,
    transactionHash: TX(block),
  },
  {
    address: contract,
    eventName: 'TokensMinted',
    args: { recipient: MINTER, amount, mintGroup: 0n },
    blockNumber: block,
    logIndex: 1,
    transactionHash: TX(block),
  },
]

/**
 * A fake chain recording every call as `head`, `time <block>`, `logs <from>-<to> x<addresses>` or
 * `receipt <hash>`. Its getLogs answers the logs of the addresses and blocks asked for.
 */
function fakeChain() {
  const chain = {
    head: 100n,
    logs: [] as IndexLog[],
    receipts: new Map<Hex, bigint>([[DEPLOY_A, 50n]]),
    calls: [] as string[],
    /** The next getLogs calls fail while this is above 0. */
    logsFailures: 0,
    /** When set, a getLogs call over more blocks than this fails, as a provider's cap refuses it. */
    logsCap: null as bigint | null,
    /** When set, every head read waits for it. */
    gate: null as Promise<void> | null,
  }
  const client = {
    async getBlock(args: { blockTag?: 'latest'; blockNumber?: bigint }) {
      if (args.blockNumber === undefined) {
        chain.calls.push('head')
        if (chain.gate) await chain.gate
        return { number: chain.head, timestamp: BigInt(timeOf(chain.head)) }
      }
      chain.calls.push(`time ${args.blockNumber}`)
      return { number: args.blockNumber, timestamp: BigInt(timeOf(args.blockNumber)) }
    },
    async getLogs({
      address,
      fromBlock,
      toBlock,
    }: {
      address: Address[]
      fromBlock: bigint
      toBlock: bigint
    }) {
      chain.calls.push(`logs ${fromBlock}-${toBlock} x${address.length}`)
      const overCap = chain.logsCap !== null && toBlock - fromBlock + 1n > chain.logsCap
      if (overCap || chain.logsFailures > 0) {
        if (!overCap) chain.logsFailures--
        // A provider refusing the range; viem's message carries the URL, with the provider's key.
        throw new HttpRequestError({ url: 'https://rpc.example/v2/secret-key', status: 413 })
      }
      const asked = new Set(address.map((contract) => contract.toLowerCase()))
      return chain.logs.filter(
        (log) =>
          asked.has(log.address.toLowerCase()) && log.blockNumber >= fromBlock && log.blockNumber <= toBlock,
      )
    },
    async getTransactionReceipt({ hash }: { hash: Hex }) {
      chain.calls.push(`receipt ${hash}`)
      const blockNumber = chain.receipts.get(hash)
      if (blockNumber === undefined) throw new TransactionReceiptNotFoundError({ hash })
      return { blockNumber }
    },
  } as unknown as PublicClient
  return { chain, client }
}

/** A target with its cursor at a block, synced at that block's time unless `synced` is false. */
const targetAt = (
  collectionId: string,
  contract: Address,
  deployTx: Hex,
  indexed: bigint | null,
  synced = true,
): Target => ({
  collectionId,
  contract: contract.toLowerCase() as Address,
  deployTx,
  fromBlock: indexed === null ? null : 50n,
  indexedBlock: indexed,
  syncedAt: indexed !== null && synced ? timeOf(indexed) : null,
})

/** A summary as the database answers it: recipients lowercase. */
const summaryOf = (
  collectionId: string,
  contract: Address,
  holders: number,
  mints: bigint[] = [],
): Summary => ({
  collectionId,
  contract: contract.toLowerCase() as Address,
  holders,
  syncedAt: null,
  recentMints: mints.map((block) => ({
    txHash: TX(block),
    recipient: MINTER.toLowerCase() as Address,
    groupId: 0,
    amount: 1,
    firstTokenId: Number(block),
    blockTimestamp: timeOf(block),
  })),
})

/**
 * A fake database recording every call as `summaries`, `targets`, `start <id> <block>` or
 * `record <from>-<to>`. A write moves its targets' cursors as indexer_record does, and answers
 * `answer(write)`.
 */
function fakeDb(targets: Target[]) {
  const db = {
    targets,
    calls: [] as string[],
    writes: [] as RecordWrite[],
    summaries: [] as Summary[],
    summariesFailures: 0,
    /** The next writes throw these, in order. */
    recordFailures: [] as Error[],
    answer: (write: RecordWrite): Summary[] => {
      void write
      return []
    },
  }
  const port: IndexerDb = {
    async targets() {
      db.calls.push('targets')
      return db.targets.map((target) => ({ ...target }))
    },
    async start(collectionId, fromBlock) {
      db.calls.push(`start ${collectionId} ${fromBlock}`)
      const target = db.targets.find((entry) => entry.collectionId === collectionId)!
      target.fromBlock = fromBlock
      target.indexedBlock = fromBlock - 1n
    },
    async record(write) {
      db.calls.push(`record ${write.fromBlock}-${write.toBlock}`)
      const failure = db.recordFailures.shift()
      if (failure) throw failure
      db.writes.push(write)
      for (const id of write.collections) {
        const target = db.targets.find((entry) => entry.collectionId === id)!
        if (target.indexedBlock === null || target.indexedBlock < write.toBlock)
          target.indexedBlock = write.toBlock
        if (write.syncedAt !== null) target.syncedAt = write.syncedAt
      }
      return db.answer(write)
    },
    async summaries() {
      db.calls.push('summaries')
      if (db.summariesFailures > 0) {
        db.summariesFailures--
        throw new IndexerWriteError('indexer_summaries', 'NETWORK', false)
      }
      return db.summaries
    },
  }
  return { db, port }
}

/** Lets the indexer's promises run, at the fake clock's current time. */
const settle = () => vi.advanceTimersByTimeAsync(0)
/** The indexer on Anvil at the default pace, its chain's reader at `tier`. */
const indexerOn = (client: PublicClient, port: IndexerDb, tier: Tier | null = 'idle') =>
  chainIndexer(ANVIL, client, port, { tier: () => tier })
const logCalls = (calls: string[]) => calls.filter((call) => call.startsWith('logs'))
/** The blocks each getLogs call spanned, in order. */
const spansOf = (calls: string[]) =>
  logCalls(calls).map((call) => {
    const [from, to] = call.split(' ')[1]!.split('-').map(Number)
    return to! - from! + 1
  })

describe('chainIndexer (docs/specs/2026-10-16-indexer-overview.md, section 6.5)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('loads the summaries before it reads the targets and the chain, and answers the activity from them', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    db.summaries = [summaryOf(ID_A, A, 3, [99n])]
    const indexer = indexerOn(client, port)
    await settle()
    expect(db.calls).toEqual(['summaries', 'targets'])
    expect(chain.calls).toEqual(['head'])
    expect(indexer.activityOf(A, timeOf(100n))).toEqual({
      holders: 3,
      recentMints: [
        {
          txHash: TX(99n),
          recipient: MINTER,
          groupId: 0,
          amount: 1,
          firstTokenId: 99,
          blockTimestamp: timeOf(99n),
        },
      ],
    })
    await indexer.stop()
  })

  it('answers no activity while the summaries fail to load, and loads them on the next pass', async () => {
    const { client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    db.summaries = [summaryOf(ID_A, A, 3)]
    db.summariesFailures = 1
    const indexer = indexerOn(client, port)
    await settle()
    expect(indexer.activityOf(A, timeOf(100n))).toBeNull()
    expect(indexer.health()).toMatchObject({ failedPasses: 1, lastError: 'IndexerWriteError' })
    await vi.advanceTimersByTimeAsync(5_000)
    expect(db.calls.filter((call) => call === 'summaries')).toHaveLength(2)
    expect(indexer.activityOf(A, timeOf(100n))?.holders).toBe(3)
    await indexer.stop()
  })

  it('reads the targets every 60 s, starts a new one at its deploy block, and tries a missing receipt at the next read', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, null)])
    const indexer = indexerOn(client, port)
    await settle()
    expect(db.calls).toEqual(['summaries', 'targets', `start ${ID_A} 50`, 'record 50-100'])
    expect(chain.calls).toEqual([`receipt ${DEPLOY_A}`, 'head', 'logs 50-100 x1'])
    db.targets.push(targetAt(ID_B, B, DEPLOY_B, null))
    db.calls.length = 0
    await vi.advanceTimersByTimeAsync(40_000)
    expect(db.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(db.calls).toEqual(['targets'])
    expect(console.error).toHaveBeenCalledWith(
      `The deploy of ${ID_B} on Anvil could not be read; it is tried again in a minute.`,
    )
    chain.receipts.set(DEPLOY_B, 70n)
    db.calls.length = 0
    await vi.advanceTimersByTimeAsync(60_000)
    expect(db.calls).toEqual(['targets', `start ${ID_B} 70`, 'record 70-100'])
    await indexer.stop()
  })

  it('logs an unreadable deploy at most once a minute, though it reads the targets every second (Decision 10)', async () => {
    const { chain, client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_B, B, DEPLOY_B, null)])
    const indexer = chainIndexer(ANVIL, client, port, {
      tier: () => 'idle',
      passMs: { behind: 1_000, fast: 1_000, idle: 1_000 },
      targetsEveryMs: 1_000,
    })
    const deployLines = () =>
      vi.mocked(console.error).mock.calls.filter(([line]) => String(line).includes('could not be read'))
    await settle()
    await vi.advanceTimersByTimeAsync(59_000)
    // Its receipt is asked for at each of the minute's 60 reads, and logged at the first alone.
    expect(chain.calls.filter((call) => call === `receipt ${DEPLOY_B}`)).toHaveLength(60)
    expect(deployLines()).toEqual([
      [`The deploy of ${ID_B} on Anvil could not be read; it is tried again in a minute.`],
    ])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(deployLines()).toHaveLength(2)
    await indexer.stop()
  })

  it('writes from one above the lowest written block of the scan, once groups merge', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n), targetAt(ID_B, B, DEPLOY_B, 90n)])
    const indexer = indexerOn(client, port)
    await settle()
    // B reads 91 to 100 with nothing to record and defers its write; both cursors now read 100.
    expect(logCalls(chain.calls)).toEqual(['logs 91-100 x1'])
    expect(db.writes).toEqual([])
    chain.head = 110n
    chain.logs = mintAt(105n, 1n, B)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(logCalls(chain.calls)).toEqual(['logs 91-100 x1', 'logs 101-110 x2'])
    expect(db.writes).toMatchObject([
      { chainId: 31337, fromBlock: 91n, toBlock: 110n, syncedAt: timeOf(110n), collections: [ID_A, ID_B] },
    ])
    await indexer.stop()
  })

  it('defers an empty pass to a minute while its cursor reads synced, then writes the blocks it read', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    db.summaries = [summaryOf(ID_A, A, 1)]
    const indexer = indexerOn(client, port)
    await settle()
    for (const head of [101n, 102n]) {
      chain.head = head
      await vi.advanceTimersByTimeAsync(20_000)
      expect(db.writes).toEqual([])
      // Synced at the head in memory, so the state 300 s on still carries the activity.
      expect(indexer.activityOf(A, timeOf(head) + 300)?.holders).toBe(1)
      expect(indexer.activityOf(A, timeOf(head) + 301)).toBeNull()
    }
    chain.head = 103n
    await vi.advanceTimersByTimeAsync(20_000)
    expect(db.writes).toEqual([
      {
        chainId: 31337,
        fromBlock: 101n,
        toBlock: 103n,
        syncedAt: timeOf(103n),
        collections: [ID_A],
        records: NO_RECORDS,
      },
    ])
    await indexer.stop()
  })

  it('writes a first read to the safe block at once', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 90n, false)])
    const indexer = indexerOn(client, port)
    await settle()
    expect(logCalls(chain.calls)).toEqual(['logs 91-100 x1'])
    expect(db.writes).toEqual([
      {
        chainId: 31337,
        fromBlock: 91n,
        toBlock: 100n,
        syncedAt: timeOf(100n),
        collections: [ID_A],
        records: NO_RECORDS,
      },
    ])
    await indexer.stop()
  })

  it('answers 0 holders and no mint for a collection it started, once read to the safe block (Review Focus 4)', async () => {
    const { client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, null)])
    const indexer = indexerOn(client, port)
    await settle()
    expect(indexer.activityOf(A, timeOf(100n))).toEqual({ holders: 0, recentMints: [] })
    await indexer.stop()
  })

  it('rewinds a failed write to the written block and reads the range again', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    chain.head = 103n
    chain.logs = mintAt(102n, 1n)
    db.recordFailures = [new IndexerWriteError('indexer_record', 'NETWORK', false)]
    const indexer = indexerOn(client, port)
    await settle()
    expect(db.calls).toContain('record 101-103')
    expect(db.writes).toEqual([])
    expect(indexer.health()).toMatchObject({ failedPasses: 1, lastError: 'IndexerWriteError' })
    expect(console.error).toHaveBeenCalledWith('The index write on Anvil failed: IndexerWriteError (NETWORK)')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(logCalls(chain.calls)).toEqual(['logs 101-103 x1', 'logs 101-103 x1'])
    expect(db.writes).toHaveLength(1)
    expect(db.writes[0]).toMatchObject({ fromBlock: 101n, toBlock: 103n, syncedAt: timeOf(103n) })
    expect(db.writes[0]!.records.mints).toMatchObject([{ collectionId: ID_A, block: 102, firstTokenId: 1 }])
    await indexer.stop()
  })

  it('waits the fast delay after a failed write rather than the backfill 1 s (Review Focus 2)', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 0n, false)])
    chain.head = 2_000n
    chain.logs = mintAt(100n, 1n)
    db.recordFailures = [new IndexerWriteError('indexer_record', 'NETWORK', false)]
    const indexer = indexerOn(client, port)
    await settle()
    expect(logCalls(chain.calls)).toEqual(['logs 1-500 x1'])
    await vi.advanceTimersByTimeAsync(4_999)
    expect(logCalls(chain.calls)).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(logCalls(chain.calls)).toEqual(['logs 1-500 x1', 'logs 1-500 x1'])
    // Written this time, so the backfill goes on 1 s later.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(logCalls(chain.calls)).toEqual(['logs 1-500 x1', 'logs 1-500 x1', 'logs 501-1000 x1'])
    await indexer.stop()
  })

  it('reads the targets again after a gap refusal and takes the database cursor', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    chain.head = 105n
    chain.logs = mintAt(103n, 1n)
    db.recordFailures = [new IndexerWriteError('indexer_record', '23514', true)]
    const indexer = indexerOn(client, port)
    await settle()
    // Another indexer recorded the blocks meanwhile.
    db.targets[0]!.indexedBlock = 105n
    db.targets[0]!.syncedAt = timeOf(105n)
    db.calls.length = 0
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(5_000)
    expect(db.calls).toEqual(['targets'])
    expect(chain.calls).toEqual(['head'])
    await indexer.stop()
  })

  it('keeps a halved range and its last failure when a gap refusal takes the cursor again from the database (Decision 10)', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 0n, false)])
    chain.head = 2_000n
    chain.logsFailures = 2
    chain.logs = mintAt(50n, 1n)
    db.recordFailures = [new IndexerWriteError('indexer_record', '23514', true)]
    const indexer = indexerOn(client, port)
    await settle()
    // Two failures halve the range to 125, which the scan of 1 to 125 keeps; its write is refused as a gap.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(logCalls(chain.calls)).toEqual(['logs 1-500 x1', 'logs 1-250 x1', 'logs 1-125 x1'])
    expect(db.calls).toEqual(['summaries', 'targets', 'record 1-125'])
    // Another indexer recorded the blocks meanwhile.
    db.targets[0]!.indexedBlock = 125n
    await vi.advanceTimersByTimeAsync(6_000)
    expect(db.calls).toEqual(['summaries', 'targets', 'record 1-125', 'targets'])
    // From the database's block, 125 blocks rather than 500, and still 125 after a success within the minute
    // of the last failure, which the cursor taken again remembers.
    expect(logCalls(chain.calls)).toEqual([
      'logs 1-500 x1',
      'logs 1-250 x1',
      'logs 1-125 x1',
      'logs 126-250 x1',
      'logs 251-375 x1',
    ])
    await indexer.stop()
  })

  it('halves a failed scan range down to 1 and never below, keeps it for a minute after the last failure, then doubles it back to 500 with no block skipped', async () => {
    const { chain, client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 0n, false)])
    chain.head = 2_000n
    chain.logsFailures = 9
    const indexer = indexerOn(client, port)
    await settle()
    // Nine failures 5 s apart, the last at 40 s, then a scan each second while the cursor is behind.
    await vi.advanceTimersByTimeAsync(9 * 5_000 + 64 * 1_000)
    expect(logCalls(chain.calls)).toEqual([
      'logs 1-500 x1',
      'logs 1-250 x1',
      'logs 1-125 x1',
      'logs 1-62 x1',
      'logs 1-31 x1',
      'logs 1-15 x1',
      'logs 1-7 x1',
      'logs 1-3 x1',
      'logs 1-1 x1',
      // From 45 s to 100 s, a minute after the last failure, the range stays 1: one block a second.
      ...Array.from({ length: 56 }, (_, index) => `logs ${index + 1}-${index + 1} x1`),
      // Then each success doubles it, up to 500.
      'logs 57-58 x1',
      'logs 59-62 x1',
      'logs 63-70 x1',
      'logs 71-86 x1',
      'logs 87-118 x1',
      'logs 119-182 x1',
      'logs 183-310 x1',
      'logs 311-566 x1',
      'logs 567-1066 x1',
    ])
    expect(indexer.health()).toMatchObject({ failedPasses: 9, lastError: 'HttpRequestError' })
    expect(console.error).toHaveBeenCalledWith(
      'The index scan of blocks 1 to 500 on Anvil failed, so its range halves: HttpRequestError: HTTP request failed.',
    )
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret-key')
    await indexer.stop()
  })

  it("keeps the range one halving under a provider's cap and probes the cap once a minute, not every other scan", async () => {
    const { chain, client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 0n, false)])
    chain.head = 100_000n
    chain.logsCap = 100n
    const indexer = indexerOn(client, port)
    await settle()
    // 500, 250 and 125 fail 5 s apart; 62 succeeds from 15 s, and a minute after each failure one scan of 124
    // probes the cap, fails and halves the range again: at 71 s, 132 s and 193 s.
    await vi.advanceTimersByTimeAsync(193_000)
    const minute = Array<number>(56).fill(62)
    expect(spansOf(chain.calls)).toEqual([500, 250, 125, ...minute, 124, ...minute, 124, ...minute, 124])
    // Three failures to reach 62, then one probe a minute: 6 of 174 scans failed, not one in two.
    expect(indexer.health().failedPasses).toBe(6)
    await indexer.stop()
  })

  it("follows each write's answer for the activity, and answers none for a contract it does not read", async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    db.summaries = [summaryOf(ID_A, A, 0)]
    db.answer = (write) => {
      const mints = chain.logs.filter((log) => log.eventName === 'TokensMinted').map((log) => log.blockNumber)
      return [{ ...summaryOf(ID_A, A, mints.length, mints.reverse()), syncedAt: write.syncedAt }]
    }
    const indexer = indexerOn(client, port, 'live')
    await settle()
    chain.head = 101n
    chain.logs = mintAt(101n, 1n)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(indexer.activityOf(A, timeOf(101n))).toMatchObject({
      holders: 1,
      recentMints: [{ txHash: TX(101n), recipient: MINTER, firstTokenId: 101 }],
    })
    chain.head = 102n
    chain.logs = [...chain.logs, ...mintAt(102n, 2n)]
    await vi.advanceTimersByTimeAsync(5_000)
    expect(indexer.activityOf(A, timeOf(102n))?.holders).toBe(2)
    expect(indexer.activityOf(A, timeOf(102n))?.recentMints.map((mint) => mint.firstTokenId)).toEqual([
      102, 101,
    ])
    expect(indexer.activityOf(getAddress(B), timeOf(102n))).toBeNull()
    await indexer.stop()
  })

  it('reports its collections, those behind, the safe block, the last pass, its failures and the unpaired mints', async () => {
    const { chain, client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n), targetAt(ID_B, B, DEPLOY_B, null)])
    chain.head = 103n
    // A mint of 2 whose transaction moved one token: not recorded, its transfer still an owner.
    chain.logs = mintAt(102n, 1n, A, 2n)
    const indexer = indexerOn(client, port)
    await settle()
    expect(indexer.health()).toEqual({
      collections: 1,
      behind: 0,
      block: 103,
      lastPassAt: new Date(1_000_000).toISOString(),
      failedPasses: 0,
      lastError: null,
      unpaired: 1,
    })
    expect(console.error).toHaveBeenCalledWith(
      `A mint or airdrop in ${TX(102n)} on Anvil did not pair with its transfers and is not recorded.`,
    )
    await indexer.stop()
  })

  it('waits for the pass in flight when stopped, and makes no call after', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    let release = () => {}
    chain.gate = new Promise((resolve) => {
      release = resolve
    })
    const indexer = indexerOn(client, port)
    await settle()
    let stopped = false
    const stopping = indexer.stop().then(() => {
      stopped = true
    })
    await settle()
    expect(stopped).toBe(false)
    release()
    await stopping
    const calls = chain.calls.length + db.calls.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(chain.calls.length + db.calls.length).toBe(calls)
  })
})

import { chainById, type ChainConfig } from '@cobweb/shared'
import {
  getAddress,
  HttpRequestError,
  RpcRequestError,
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
const C: Address = '0x00000000000000000000000000000000000000c3'
const X: Address = '0x00000000000000000000000000000000000000e5'
const MINTER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const ID_A = '0a977c0b-7e53-476b-8c08-6c685315c3af'
const ID_B = '7d2c9e10-5b44-4a6f-9c3e-2f1b8a7d6e5c'
const ID_C = '3f6e1c2a-8b4d-4e5f-9a1b-2c3d4e5f6a7b'
const ID_X = '9b8a7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d'
const DEPLOY_A: Hex = `0x${'da'.repeat(32)}`
const DEPLOY_B: Hex = `0x${'db'.repeat(32)}`
const DEPLOY_C: Hex = `0x${'dc'.repeat(32)}`
const DEPLOY_X: Hex = `0x${'de'.repeat(32)}`
/** An RPC URL as a provider issues it, its key in the path. */
const KEYED_URL: string = 'https://rpc.example/v2/secret-key'
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
 * `receipt <hash>`, and each getLogs call's blocks and addresses in `scans`. Its getLogs answers the logs of
 * the addresses and blocks asked for.
 */
function fakeChain() {
  const chain = {
    head: 100n,
    logs: [] as IndexLog[],
    receipts: new Map<Hex, bigint>([[DEPLOY_A, 50n]]),
    calls: [] as string[],
    scans: [] as { from: bigint; to: bigint; addresses: string[] }[],
    /** The next getLogs calls fail while this is above 0. */
    logsFailures: 0,
    /** What a failed getLogs throws: a provider refusing the range, viem's message carrying the keyed URL. */
    logsError: (): Error => new HttpRequestError({ url: KEYED_URL, status: 413 }),
    /** When set, a getLogs call over more blocks than this fails, as a provider's cap refuses it. */
    logsCap: null as bigint | null,
    /** When set, a getLogs call naming the contract over a range holding the block fails, every time. */
    failsAt: null as { contract: Address; block: bigint } | null,
    /** When set, the next getLogs call answers only up to this block, as a node behind the head does. */
    answersTo: null as bigint | null,
    /** The next head reads fail while this is above 0. */
    headFailures: 0,
    /** When set, every head read waits for it. */
    gate: null as Promise<void> | null,
  }
  const client = {
    async getBlock(args: { blockTag?: 'latest'; blockNumber?: bigint }) {
      if (args.blockNumber === undefined) {
        chain.calls.push('head')
        if (chain.gate) await chain.gate
        if (chain.headFailures > 0) {
          chain.headFailures--
          throw new HttpRequestError({ url: KEYED_URL, status: 503 })
        }
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
      const asked = new Set(address.map((contract) => contract.toLowerCase()))
      chain.scans.push({ from: fromBlock, to: toBlock, addresses: [...asked] })
      const overCap = chain.logsCap !== null && toBlock - fromBlock + 1n > chain.logsCap
      const failing =
        chain.failsAt !== null &&
        asked.has(chain.failsAt.contract.toLowerCase()) &&
        fromBlock <= chain.failsAt.block &&
        chain.failsAt.block <= toBlock
      if (overCap || failing) throw chain.logsError()
      if (chain.logsFailures > 0) {
        chain.logsFailures--
        throw chain.logsError()
      }
      const answered = chain.answersTo !== null && chain.answersTo < toBlock ? chain.answersTo : toBlock
      chain.answersTo = null
      return chain.logs.filter(
        (log) =>
          asked.has(log.address.toLowerCase()) && log.blockNumber >= fromBlock && log.blockNumber <= answered,
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

/**
 * A target with its cursor at a block (deployed at block 1 unless another is given), synced at that block's
 * time unless `synced` is false.
 */
const targetAt = (
  collectionId: string,
  contract: Address,
  deployTx: Hex,
  indexed: bigint | null,
  synced = true,
  fromBlock = 1n,
): Target => ({
  collectionId,
  contract: contract.toLowerCase() as Address,
  deployTx,
  fromBlock: indexed === null ? null : fromBlock,
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
    /** The collections whose start fails, until they leave the set. */
    startFailures: new Set<string>(),
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
      if (db.startFailures.has(collectionId)) throw new IndexerWriteError('indexer_start', 'NETWORK', false)
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
/** The lines the indexer logged, each as one string. */
const errorLines = () => vi.mocked(console.error).mock.calls.map((call) => call.map(String).join(' '))
/** The lines that hold `words`. */
const linesWith = (words: string) => errorLines().filter((line) => line.includes(words))

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
    expect(indexer.health()).toMatchObject({ failedPasses: 1, lastError: 'IndexerWriteError (NETWORK)' })
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

  it('starts the other targets when one start fails, retries it at the next read and logs it once a minute (Minor 6)', async () => {
    const { chain, client } = fakeChain()
    chain.receipts.set(DEPLOY_B, 70n)
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, null), targetAt(ID_B, B, DEPLOY_B, null)])
    db.startFailures.add(ID_A)
    const indexer = chainIndexer(ANVIL, client, port, {
      tier: () => 'idle',
      passMs: { behind: 1_000, fast: 1_000, idle: 1_000 },
      targetsEveryMs: 1_000,
    })
    const startLine = `The cursor of ${ID_A} on Anvil could not be started; it is tried again in a minute: IndexerWriteError (NETWORK)`
    await settle()
    expect(db.calls).toEqual([
      'summaries',
      'targets',
      `start ${ID_A} 50`,
      `start ${ID_B} 70`,
      'record 70-100',
    ])
    expect(indexer.health()).toMatchObject({
      collections: 1,
      failedPasses: 1,
      lastError: 'IndexerWriteError (NETWORK)',
    })
    expect(errorLines()).toEqual([startLine])
    // Tried at each read, every second, and logged once a minute.
    await vi.advanceTimersByTimeAsync(59_000)
    expect(db.calls.filter((call) => call === `start ${ID_A} 50`)).toHaveLength(60)
    expect(indexer.health().failedPasses).toBe(60)
    expect(errorLines()).toEqual([startLine])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(errorLines()).toEqual([startLine, startLine])
    db.startFailures.clear()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(indexer.health().collections).toBe(2)
    expect(db.calls.slice(-2)).toEqual([`start ${ID_A} 50`, 'record 50-100'])
    await indexer.stop()
  })

  it('writes from the scan start, 32 blocks below the scanned one, or from one above the lowest written block when the blocks deferred since reach further back', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n), targetAt(ID_B, B, DEPLOY_B, 90n)])
    const indexer = indexerOn(client, port)
    await settle()
    // B reads 59 to 100 with nothing to record and defers its write; both cursors now read 100.
    expect(logCalls(chain.calls)).toEqual(['logs 59-100 x1'])
    expect(db.writes).toEqual([])
    chain.head = 110n
    chain.logs = mintAt(105n, 1n, B)
    await vi.advanceTimersByTimeAsync(20_000)
    // One scan of both from 32 blocks below 101: the write starts there, below B's written 90 plus one.
    expect(logCalls(chain.calls)).toEqual(['logs 59-100 x1', 'logs 69-110 x2'])
    expect(db.writes).toMatchObject([
      { chainId: 31337, fromBlock: 69n, toBlock: 110n, syncedAt: timeOf(110n), collections: [ID_A, ID_B] },
    ])
    // The next pass, 5 s on, reads the mint again in its window, so it writes at once, from the scan's start.
    chain.head = 300n
    await vi.advanceTimersByTimeAsync(20_000)
    expect(db.writes).toHaveLength(2)
    expect(db.writes[1]).toMatchObject({ fromBlock: 79n, toBlock: 300n })
    // A window with no record defers the blocks 301 to 400; then blocks deferred for more than 32 past the
    // written block: the write starts one above it, so the database sees no gap.
    chain.head = 400n
    await vi.advanceTimersByTimeAsync(20_000)
    expect(db.writes).toHaveLength(2)
    chain.head = 500n
    chain.logs = [...chain.logs, ...mintAt(450n, 2n, B)]
    await vi.advanceTimersByTimeAsync(20_000)
    expect(logCalls(chain.calls).slice(-3)).toEqual(['logs 79-300 x2', 'logs 269-400 x2', 'logs 369-500 x2'])
    expect(db.writes[2]).toMatchObject({ fromBlock: 301n, toBlock: 500n })
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
        fromBlock: 71n,
        toBlock: 103n,
        syncedAt: timeOf(103n),
        collections: [ID_A],
        records: NO_RECORDS,
      },
    ])
    await indexer.stop()
  })

  it('writes an idle synced cursor once a minute, not every pass, while the 32 blocks it reads again hold no record (Critical 1)', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    // A mint the database holds already, one block below the first window.
    chain.logs = mintAt(68n, 1n)
    const indexer = indexerOn(client, port)
    await settle()
    for (const head of [101n, 102n]) {
      chain.head = head
      await vi.advanceTimersByTimeAsync(20_000)
      expect(db.writes).toEqual([])
    }
    chain.head = 103n
    await vi.advanceTimersByTimeAsync(20_000)
    expect(db.writes).toEqual([
      {
        chainId: 31337,
        fromBlock: 71n,
        toBlock: 103n,
        syncedAt: timeOf(103n),
        collections: [ID_A],
        records: NO_RECORDS,
      },
    ])
    chain.head = 104n
    await vi.advanceTimersByTimeAsync(20_000)
    expect(db.writes).toHaveLength(1)
    expect(logCalls(chain.calls)).toEqual([
      'logs 69-101 x1',
      'logs 70-102 x1',
      'logs 71-103 x1',
      'logs 72-104 x1',
    ])
    // The passes keep the idle pace: a head read every 20 s.
    expect(chain.calls.filter((call) => call === 'head')).toHaveLength(5)
    await indexer.stop()
  })

  it('writes a log a lagging node left out of a segment written anyway with the next read of its block, before a minute passes (Critical 1)', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    chain.head = 110n
    // A mint at 104 and one at 108, block N; the node answering getLogs is at 105, so the first answer for 69
    // to 110 holds the first mint and stops short of the second.
    chain.logs = [...mintAt(104n, 1n), ...mintAt(108n, 2n)]
    chain.answersTo = 105n
    const indexer = indexerOn(client, port)
    await settle()
    // The first mint is news: the segment is written at once, to 110, past block 108.
    expect(logCalls(chain.calls)).toEqual(['logs 69-110 x1'])
    expect(db.writes).toHaveLength(1)
    expect(db.writes[0]!.records.mints.map((mint) => mint.block)).toEqual([104])
    // 5 s on (the fast delay after news), the read of 79 to 112 answers block 108: its segment holds records,
    // so it is written at once although both mints lie at or below the written block.
    chain.head = 112n
    await vi.advanceTimersByTimeAsync(5_000)
    expect(logCalls(chain.calls)).toEqual(['logs 69-110 x1', 'logs 79-112 x1'])
    expect(db.writes).toHaveLength(2)
    expect(db.writes[1]).toMatchObject({ fromBlock: 79n, toBlock: 112n })
    expect(db.writes[1]!.records.mints.map((mint) => mint.block)).toEqual([104, 108])
    // The mints the window reads again are written at each pass, but are not news: the pace stays idle.
    chain.head = 113n
    await vi.advanceTimersByTimeAsync(19_000)
    expect(db.writes).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(logCalls(chain.calls).at(-1)).toBe('logs 81-113 x1')
    expect(db.writes).toHaveLength(3)
    await indexer.stop()
  })

  it('writes a mint a lagging node left out of its first answer once the next pass reads its block again (Critical 1)', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    const owners = new Map<number, string>()
    db.answer = (write) => {
      for (const owner of write.records.owners) owners.set(owner.tokenId, owner.owner)
      const mints = write.records.mints.map((mint) => BigInt(mint.block))
      return [{ ...summaryOf(ID_A, A, new Set(owners.values()).size, mints), syncedAt: write.syncedAt }]
    }
    chain.head = 110n
    chain.logs = mintAt(108n, 1n)
    // The node answering getLogs is at block 105: its answer for 69 to 110 stops there, without an error.
    chain.answersTo = 105n
    const indexer = indexerOn(client, port, 'live')
    await settle()
    expect(logCalls(chain.calls)).toEqual(['logs 69-110 x1'])
    expect(db.writes).toEqual([])
    chain.head = 112n
    await vi.advanceTimersByTimeAsync(5_000)
    expect(logCalls(chain.calls)).toEqual(['logs 69-110 x1', 'logs 79-112 x1'])
    expect(db.writes).toHaveLength(1)
    expect(db.writes[0]).toMatchObject({ fromBlock: 79n, toBlock: 112n })
    expect(db.writes[0]!.records.mints).toMatchObject([{ block: 108, firstTokenId: 1 }])
    expect(indexer.activityOf(A, timeOf(112n))).toMatchObject({
      holders: 1,
      recentMints: [{ txHash: TX(108n), firstTokenId: 108 }],
    })
    await indexer.stop()
  })

  it("starts the first scan of a new cursor at its deploy block, and never reads below a cursor's deploy block (Critical 1)", async () => {
    const { chain, client } = fakeChain()
    chain.receipts.set(DEPLOY_B, 90n)
    chain.head = 110n
    // A was deployed at 95 and is indexed to 100; B is new, deployed at 90.
    const { db, port } = fakeDb([
      targetAt(ID_A, A, DEPLOY_A, 100n, true, 95n),
      targetAt(ID_B, B, DEPLOY_B, null),
    ])
    const indexer = indexerOn(client, port)
    await settle()
    expect(logCalls(chain.calls)).toEqual(['logs 95-110 x1', 'logs 90-110 x1'])
    expect(db.calls).toEqual(['summaries', 'targets', `start ${ID_B} 90`, 'record 90-110'])
    await indexer.stop()
  })

  it('writes a first read to the safe block at once', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 90n, false)])
    const indexer = indexerOn(client, port)
    await settle()
    expect(logCalls(chain.calls)).toEqual(['logs 59-100 x1'])
    expect(db.writes).toEqual([
      {
        chainId: 31337,
        fromBlock: 59n,
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
    expect(db.calls).toContain('record 69-103')
    expect(db.writes).toEqual([])
    expect(indexer.health()).toMatchObject({ failedPasses: 1, lastError: 'IndexerWriteError (NETWORK)' })
    expect(console.error).toHaveBeenCalledWith('The index write on Anvil failed: IndexerWriteError (NETWORK)')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(logCalls(chain.calls)).toEqual(['logs 69-103 x1', 'logs 69-103 x1'])
    expect(db.writes).toHaveLength(1)
    expect(db.writes[0]).toMatchObject({ fromBlock: 69n, toBlock: 103n, syncedAt: timeOf(103n) })
    expect(db.writes[0]!.records.mints).toMatchObject([{ collectionId: ID_A, block: 102, firstTokenId: 1 }])
    await indexer.stop()
  })

  it('ends a pass at a failed write, its other scans and writes left for the next pass (Minor 5)', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n), targetAt(ID_B, B, DEPLOY_B, 90n)])
    chain.head = 110n
    chain.logs = [...mintAt(105n, 1n, A), ...mintAt(95n, 1n, B)]
    db.recordFailures = [new IndexerWriteError('indexer_record', 'NETWORK', false)]
    const indexer = indexerOn(client, port)
    await settle()
    // The front group's write fails, so B's scan waits for the next pass.
    expect(logCalls(chain.calls)).toEqual(['logs 69-110 x1'])
    expect(db.calls.filter((call) => call.startsWith('record'))).toEqual(['record 69-110'])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(logCalls(chain.calls)).toEqual(['logs 69-110 x1', 'logs 69-110 x1', 'logs 59-110 x1'])
    expect(db.writes.map((write) => write.collections)).toEqual([[ID_A], [ID_B]])
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
    // Written this time, so the backfill goes on 1 s later: 500 blocks from 32 below the next block, 468 new.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(logCalls(chain.calls)).toEqual(['logs 1-500 x1', 'logs 1-500 x1', 'logs 469-968 x1'])
    await indexer.stop()
  })

  it('logs a failure said again on a chain once a minute for each kind, counting every one (Minor 5)', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    chain.head = 103n
    chain.logs = mintAt(102n, 1n)
    chain.logsFailures = 1
    db.recordFailures = Array.from(
      { length: 13 },
      () => new IndexerWriteError('indexer_record', 'NETWORK', false),
    )
    const indexer = indexerOn(client, port)
    const scanLine =
      'The index scan of blocks 69 to 103 on Anvil failed, so its range halves: HttpRequestError: HTTP request failed.'
    const writeLine = 'The index write on Anvil failed: IndexerWriteError (NETWORK)'
    await settle()
    // The scan fails at 0 s, then the write every 5 s from 5 s: a line for each kind, then each once a minute.
    await vi.advanceTimersByTimeAsync(59_000)
    expect(errorLines()).toEqual([scanLine, writeLine])
    expect(indexer.health().failedPasses).toBe(1 + 11)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(errorLines()).toEqual([scanLine, writeLine])
    expect(indexer.health().failedPasses).toBe(1 + 12)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(errorLines()).toEqual([scanLine, writeLine, writeLine])
    expect(indexer.health().failedPasses).toBe(1 + 13)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(db.writes).toHaveLength(1)
    await indexer.stop()
  })

  it('logs a failing head once a minute while it counts each pass it fails (Minor 5)', async () => {
    const { chain, client } = fakeChain()
    const { port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    chain.headFailures = 13
    const indexer = indexerOn(client, port)
    await settle()
    await vi.advanceTimersByTimeAsync(55_000)
    expect(indexer.health().failedPasses).toBe(12)
    expect(linesWith('An index pass on Anvil failed')).toEqual([
      'An index pass on Anvil failed: HttpRequestError: HTTP request failed.',
    ])
    await vi.advanceTimersByTimeAsync(5_000)
    expect(indexer.health().failedPasses).toBe(13)
    expect(linesWith('An index pass on Anvil failed')).toHaveLength(2)
    expect(JSON.stringify(errorLines())).not.toContain('secret-key')
    await indexer.stop()
  })

  it('reports the last failure on /health by its name and codes, never its message (Minor 4)', async () => {
    const { chain, client } = fakeChain()
    const { db, port } = fakeDb([targetAt(ID_A, A, DEPLOY_A, 100n)])
    chain.head = 103n
    chain.logs = mintAt(102n, 1n)
    chain.logsFailures = 1
    chain.logsError = () =>
      new RpcRequestError({
        body: { method: 'eth_getLogs' },
        error: { code: -32005, message: `Too many results from ${KEYED_URL}` },
        url: KEYED_URL,
      })
    db.recordFailures = [new IndexerWriteError('indexer_record', 'PGRST202', false)]
    const indexer = indexerOn(client, port)
    await settle()
    expect(indexer.health().lastError).toBe('RpcRequestError (-32005)')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(indexer.health().lastError).toBe('IndexerWriteError (PGRST202)')
    expect(JSON.stringify(indexer.health())).not.toMatch(/secret-key|:\/\//)
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
    // From the database's block, 125 blocks rather than 500 (the 32 read again among them), and still 125
    // after a success within the minute of the last failure, which the cursor taken again remembers.
    expect(logCalls(chain.calls)).toEqual([
      'logs 1-500 x1',
      'logs 1-250 x1',
      'logs 1-125 x1',
      'logs 94-218 x1',
      'logs 187-311 x1',
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
      // From 45 s to 100 s, a minute after the last failure, the range stays 1: one block a second, read alone.
      ...Array.from({ length: 56 }, (_, index) => `logs ${index + 1}-${index + 1} x1`),
      // Then each success doubles it, up to 500, the blocks read again within it: half of each scan new up to a
      // range of 64, then 96, 224 and 468.
      'logs 56-57 x1',
      'logs 56-59 x1',
      'logs 56-63 x1',
      'logs 56-71 x1',
      'logs 56-87 x1',
      'logs 56-119 x1',
      'logs 88-215 x1',
      'logs 184-439 x1',
      'logs 408-907 x1',
    ])
    expect(indexer.health()).toMatchObject({ failedPasses: 9, lastError: 'HttpRequestError' })
    expect(errorLines()).toEqual([
      'The index scan of blocks 1 to 500 on Anvil failed, so its range halves: HttpRequestError: HTTP request failed.',
      `The block 1 of ${ID_A} on Anvil cannot be read; the collection waits there: HttpRequestError: HTTP request failed.`,
    ])
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
    // 500, 250 and 125 fail 5 s apart; 62 succeeds from 15 s, the 31 blocks read again among them (half of
    // 62), and a minute after each failure one scan of 124 probes the cap, fails and halves the range again: at
    // 71 s, 132 s and 193 s. No scan spans more than its range.
    await vi.advanceTimersByTimeAsync(193_000)
    const minute = Array<number>(56).fill(62)
    expect(spansOf(chain.calls)).toEqual([500, 250, 125, ...minute, 124, ...minute, 124, ...minute, 124])
    // Three failures to reach 62, then one probe a minute: 6 of 174 scans failed, not one in two.
    expect(indexer.health().failedPasses).toBe(6)
    await indexer.stop()
  })

  it('scans half as many collections at a time after a failure at 1 block, so a block one collection cannot be read at stops that collection alone, logged once a minute (Important 2)', async () => {
    const { chain, client } = fakeChain()
    const { port } = fakeDb([
      targetAt(ID_A, A, DEPLOY_A, 100n),
      targetAt(ID_B, B, DEPLOY_B, 100n),
      targetAt(ID_C, C, DEPLOY_C, 100n),
      targetAt(ID_X, X, DEPLOY_X, 100n),
    ])
    chain.head = 110n
    // Any scan asking for X over block 105 fails, as a provider refuses a block holding more logs than it
    // answers.
    chain.failsAt = { contract: X, block: 105n }
    const indexer = indexerOn(client, port)
    const scansOfContract = (contract: Address) =>
      chain.scans.filter((scan) => scan.addresses.includes(contract.toLowerCase()))
    const stuckLine = `The block 105 of ${ID_X} on Anvil cannot be read; the collection waits there: HttpRequestError: HTTP request failed.`
    await settle()
    // The four fail together while the range halves to 1 block, then two scans of two, then X alone at 51 s.
    await vi.advanceTimersByTimeAsync(51_000)
    expect(errorLines()).toEqual([
      'The index scan of blocks 69 to 110 on Anvil failed, so its range halves: HttpRequestError: HTTP request failed.',
      stuckLine,
    ])
    // One line a minute while X waits at its block, though its scan fails every 5 s.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(errorLines().slice(1)).toEqual([stuckLine, stuckLine])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(errorLines().slice(1)).toEqual([stuckLine, stuckLine, stuckLine])
    // The other three read past block 105 to the safe block; X stays at 104, each of its scans block 105 alone.
    for (const contract of [A, B, C]) expect(scansOfContract(contract).at(-1)!.to).toBe(110n)
    const xs = scansOfContract(X).slice(-25)
    expect(xs.every((scan) => scan.addresses.length === 1 && scan.from === 105n && scan.to === 105n)).toBe(
      true,
    )
    expect(indexer.health().lastError).toBe('HttpRequestError')
    // Once the block can be read, X catches up, and with each cursor's range back at 500 its chunk is the full
    // 100 again: one scan asks for the four.
    chain.failsAt = null
    chain.head = 2_000n
    await vi.advanceTimersByTimeAsync(80_000)
    for (const contract of [A, B, C, X]) expect(scansOfContract(contract).at(-1)!.to).toBe(2_000n)
    const before = chain.scans.length
    chain.head = 3_000n
    await vi.advanceTimersByTimeAsync(30_000)
    const after = chain.scans.slice(before)
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((scan) => scan.addresses.length === 4)).toBe(true)
    expect(after[0]).toMatchObject({ from: 1_969n, to: 2_468n })
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

  it('reports its collections, those behind, the safe block, the last pass, its failures and the unpaired mints, each counted once though its block is read again', async () => {
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
    const unpairedLine = `A mint or airdrop in ${TX(102n)} on Anvil did not pair with its transfers and is not recorded.`
    expect(linesWith('did not pair')).toEqual([unpairedLine])
    // The next pass reads block 102 again: the mint is still unpaired, and neither counted nor logged twice.
    chain.head = 104n
    await vi.advanceTimersByTimeAsync(20_000)
    expect(logCalls(chain.calls)).toEqual(['logs 69-103 x1', 'logs 72-104 x1'])
    expect(indexer.health().unpaired).toBe(1)
    expect(linesWith('did not pair')).toEqual([unpairedLine])
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

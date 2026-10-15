import { chainById, type CollectionStateResult } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  encodeEventTopics,
  HttpRequestError,
  maxUint256,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chainReader } from './chain-reader.ts'
import { hotSet } from './hot-set.ts'

const ANVIL = chainById(31337, false)!
const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const OWNER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'

/**
 * `collectionState()` at a block: one open group with allocation left, so the chain ticks at the 2 s tier.
 */
const stateAt = (block: bigint): CollectionStateResult => ({
  maxSupply: 5n,
  totalMinted: 1n,
  publicMaxMintPerWallet: 2n,
  mintFeeFlat: 0n,
  mintFeeBps: 0n,
  airdropFeePerToken: 100_000_000_000_000n,
  mintOnBehalfActive: false,
  blockTimestamp: 1_800_000_000n + block,
  groups: [
    { id: 0n, price: 0n, maxSupply: 3n, minted: 1n, startTimestamp: 0n, activeFlag: true, active: true },
  ],
})

/** A revert as viem reports it for one call. */
const reverted = (functionName: string) =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: collectionAbi, functionName }),
    {
      abi: collectionAbi,
      contractAddress: A,
      functionName,
    },
  )

/** The base URI's log, as `setBaseURI` leaves it. */
const metadataLog = (address: Address) => ({
  address,
  topics: encodeEventTopics({
    abi: collectionAbi,
    eventName: 'BatchMetadataUpdate',
    args: { fromTokenId: 1n, toTokenId: maxUint256 },
  }) as Hex[],
})

/**
 * A fake chain without multicall3 (so `readEach` reads each call), recording every call as `head`, `logs
 * <from>-<to>`, `code <address>` or `<function> <address> @<block>`.
 */
function fakeChain() {
  const chain = {
    head: 100n,
    /** Mine a block after each head read, as a busy chain does. */
    autoMine: false,
    calls: [] as string[],
    logs: [] as { address: Address; topics: Hex[] }[],
    /** `<function> <address>` pairs that revert. */
    reverts: new Set<string>(),
    baseUris: new Map<string, string>(),
    validatorHasCode: false,
    /** When set, every head read waits for it. */
    gate: null as Promise<void> | null,
    failure: null as Error | null,
    headsInFlight: 0,
    mostHeadsInFlight: 0,
  }
  const client = {
    chain: { contracts: {} },
    async getBlockNumber() {
      chain.calls.push('head')
      chain.headsInFlight++
      chain.mostHeadsInFlight = Math.max(chain.mostHeadsInFlight, chain.headsInFlight)
      try {
        if (chain.gate) await chain.gate
        if (chain.failure) throw chain.failure
        return chain.autoMine ? chain.head++ : chain.head
      } finally {
        chain.headsInFlight--
      }
    },
    async request({ params }: { params: [{ fromBlock: Hex; toBlock: Hex }] }) {
      chain.calls.push(`logs ${BigInt(params[0].fromBlock)}-${BigInt(params[0].toBlock)}`)
      return chain.logs
    },
    async getCode({ address }: { address: Address }) {
      chain.calls.push(`code ${address}`)
      return chain.validatorHasCode ? '0x6080' : undefined
    },
    async readContract({
      address,
      functionName,
      blockNumber,
    }: {
      address: Address
      functionName: string
      blockNumber: bigint
    }) {
      chain.calls.push(`${functionName} ${address} @${blockNumber}`)
      if (chain.reverts.has(`${functionName} ${address}`)) throw reverted(functionName)
      if (functionName === 'collectionState') return stateAt(blockNumber)
      if (functionName === 'owner') return OWNER
      if (functionName === 'royaltyInfo') return [OWNER, 500n]
      if (functionName === 'baseURI') return chain.baseUris.get(address) ?? 'ipfs://first/'
      if (functionName === 'getTransferValidator') return VALIDATOR
      if (functionName === 'getCollectionSecurityPolicy') return { transferSecurityLevel: 9 }
      throw new Error(`unexpected ${functionName}`)
    },
  } as unknown as PublicClient
  return { chain, client }
}

/** Lets the reader's promises run, at the fake clock's current time. */
const settle = () => vi.advanceTimersByTimeAsync(0)

describe('chainReader (docs/specs/2026-10-16-freshness-server.md, section 6.4)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reads a new collection in full at the head on its first tick, with no log scan', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const { entry } = hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    expect(chain.calls).toEqual([
      'head',
      `collectionState ${A} @100`,
      `owner ${A} @100`,
      `royaltyInfo ${A} @100`,
      `baseURI ${A} @100`,
      `getTransferValidator ${A} @100`,
      `code ${VALIDATOR}`,
    ])
    expect(entry.read).toEqual({
      state: {
        block: 100n,
        blockTimestamp: 1_800_000_100,
        maxSupply: 5,
        totalMinted: 1,
        publicMaxMintPerWallet: 2,
        mintOnBehalfActive: false,
        groups: [
          { id: 0, priceWei: '0', maxSupply: 3, minted: 1, startTimestamp: 0, flag: true, active: true },
        ],
      },
      fees: { mintFeeFlatWei: '0', mintFeeBps: 0, airdropFeePerTokenWei: '100000000000000' },
      extras: {
        owner: OWNER,
        royalty: { receiver: OWNER, bps: 500 },
        baseUri: 'ipfs://first/',
        transferValidator: VALIDATOR,
        transferLevel: { kind: 'none', reason: 'no-code' },
      },
    })
    expect([entry.readAt, entry.extrasReadAt, entry.marked]).toEqual([1_000_000, 1_000_000, false])
    expect(reader.health()).toMatchObject({ hot: 1, tier: 'live', block: 100, failedTicks: 0, logGaps: 0 })
    await reader.stop()
  })

  it('counts a head older than the last read as a read now, and never moves the block back (Review Focus 1)', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const { entry } = hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    chain.head = 99n
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.calls).toEqual(['head'])
    expect([entry.read?.state.block, entry.readAt]).toEqual([100n, 1_002_000])
    expect(reader.health().block).toBe(100)
    chain.head = 101n
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.calls).toEqual(['head', 'logs 101-101', `collectionState ${A} @101`])
    expect(entry.read?.state.block).toBe(101n)
    await reader.stop()
  })

  it('leaves a collection whose call answers null as it was, mark included, and reads the others (Review Focus 2)', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const a = hot.join(31337, A, Date.now()).entry
    const b = hot.join(31337, B, Date.now()).entry
    reader.wake()
    await settle()
    chain.head = 101n
    chain.logs = [metadataLog(A), metadataLog(B)]
    chain.reverts.add(`baseURI ${A}`)
    chain.baseUris.set(B, 'ipfs://second/')
    await vi.advanceTimersByTimeAsync(2_000)
    expect([a.read?.state.block, a.read?.extras.baseUri, a.marked]).toEqual([100n, 'ipfs://first/', true])
    expect([b.read?.state.block, b.read?.extras.baseUri, b.marked]).toEqual([101n, 'ipfs://second/', false])
    chain.head = 102n
    chain.logs = []
    chain.reverts.clear()
    chain.baseUris.set(A, 'ipfs://second/')
    await vi.advanceTimersByTimeAsync(2_000)
    expect([a.read?.state.block, a.read?.extras.baseUri, a.marked]).toEqual([102n, 'ipfs://second/', false])
    await reader.stop()
  })

  it('runs one more tick after a wake during a tick, never beside it (Review Focus 5)', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    let release = () => {}
    chain.gate = new Promise<void>((resolve) => (release = resolve))
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    const b = hot.join(31337, B, Date.now()).entry
    reader.wake()
    reader.wake()
    await settle()
    expect(chain.calls).toEqual(['head'])
    chain.gate = null
    release()
    await settle()
    expect(chain.calls.filter((call) => call === 'head')).toHaveLength(2)
    expect(chain.mostHeadsInFlight).toBe(1)
    expect(b.read?.state.block).toBe(100n)
    await vi.advanceTimersByTimeAsync(1_999)
    expect(chain.calls.filter((call) => call === 'head')).toHaveLength(2)
    await reader.stop()
  })

  it('reads the extras again once they are 60 s old, and only the state in between', async () => {
    const { chain, client } = fakeChain()
    chain.autoMine = true
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const { entry } = hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(58_000)
    expect(chain.calls.filter((call) => call.startsWith('collectionState'))).toHaveLength(29)
    expect(chain.calls.filter((call) => call.startsWith('owner'))).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.calls.filter((call) => call.startsWith('owner'))).toEqual([`owner ${A} @130`])
    expect(entry.extrasReadAt).toBe(1_060_000)
    await reader.stop()
  })

  it('reads the level on a validator with code, asking for its code once a chain, and unread when it does not answer', async () => {
    const { chain, client } = fakeChain()
    chain.validatorHasCode = true
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const a = hot.join(31337, A, Date.now()).entry
    reader.wake()
    await settle()
    expect(a.read?.extras.transferLevel).toEqual({ kind: 'level', level: 9 })
    chain.reverts.add(`getCollectionSecurityPolicy ${VALIDATOR}`)
    const b = hot.join(31337, B, Date.now()).entry
    reader.wake()
    await settle()
    expect(b.read?.extras.transferLevel).toEqual({ kind: 'unread' })
    expect(chain.calls.filter((call) => call.startsWith('code'))).toEqual([`code ${VALIDATOR}`])
    await reader.stop()
  })

  it("fails a tick whose head does not answer, keeping every read and logging the error's name, never the RPC URL", async () => {
    const { chain, client } = fakeChain()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const { entry } = hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    chain.failure = new HttpRequestError({ url: 'https://rpc.example/v2/secret-key', status: 503 })
    await vi.advanceTimersByTimeAsync(2_000)
    expect([entry.read?.state.block, entry.readAt]).toEqual([100n, 1_000_000])
    expect(reader.health()).toMatchObject({ failedTicks: 1, lastError: 'HttpRequestError', block: 100 })
    expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
      'A tick on Anvil failed: HttpRequestError: HTTP request failed.',
    ])
    chain.failure = null
    chain.head = 101n
    await vi.advanceTimersByTimeAsync(2_000)
    expect(entry.read?.state.block).toBe(101n)
    await reader.stop()
  })

  it('stops ticking once its last collection leaves, and scans nothing on its next first tick', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    await vi.advanceTimersByTimeAsync(600_000)
    const heads = chain.calls.filter((call) => call === 'head').length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(chain.calls.filter((call) => call === 'head')).toHaveLength(heads)
    expect(reader.health()).toMatchObject({ hot: 0, tier: null })
    chain.head = 150n
    chain.calls.length = 0
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    expect(chain.calls.slice(0, 2)).toEqual(['head', `collectionState ${A} @150`])
    await reader.stop()
  })
})

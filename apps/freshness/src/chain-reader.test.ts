import { chainById, type ChainConfig, type CollectionStateResult } from '@cobweb/shared'
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
import { hotSet, type HotSet } from './hot-set.ts'

const ANVIL: ChainConfig = chainById(31337, false)!
const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const OWNER: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const VALIDATOR: Address = '0x721C008fdff27BF06E7E123956E2Fe03B63342e3'
/** A validator with no code at its address. */
const BARE_VALIDATOR: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'

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

/**
 * `collectionState()` at a block on an idle collection whose one group starts 23 s after block 100's time.
 */
const scheduledAt = (block: bigint): CollectionStateResult => ({
  ...stateAt(block),
  groups: [
    {
      id: 0n,
      price: 0n,
      maxSupply: 3n,
      minted: 1n,
      startTimestamp: 1_800_000_123n,
      activeFlag: true,
      active: false,
    },
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

/** An RPC failure as viem reports it: its message carries the URL, with the provider's key. */
const rpcDown = (status: number): HttpRequestError =>
  new HttpRequestError({ url: 'https://rpc.example/v2/secret-key', status })

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
    /** The argument of each head read. */
    headArgs: [] as unknown[],
    logs: [] as { address: Address; topics: Hex[] }[],
    /** The `address` list of each log scan. */
    logAddresses: [] as Address[][],
    /** When set, every log scan throws it. */
    logsFailure: null as Error | null,
    /** `<function> <address>` pairs that revert. */
    reverts: new Set<string>(),
    baseUris: new Map<string, string>(),
    /** Each collection's validator, by its address; VALIDATOR when not set. */
    validators: new Map<string, Address>(),
    /** Whether VALIDATOR has code; no other address has any. */
    validatorHasCode: false,
    /** `collectionState()` at a block. */
    state: stateAt,
    /** When set, every head read waits for it. */
    gate: null as Promise<void> | null,
    failure: null as Error | null,
    headsInFlight: 0,
    mostHeadsInFlight: 0,
  }
  const client = {
    chain: { contracts: {} },
    async getBlockNumber(args?: unknown) {
      chain.calls.push('head')
      chain.headArgs.push(args)
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
    async request({ params }: { params: [{ address: Address[]; fromBlock: Hex; toBlock: Hex }] }) {
      chain.calls.push(`logs ${BigInt(params[0].fromBlock)}-${BigInt(params[0].toBlock)}`)
      chain.logAddresses.push(params[0].address)
      if (chain.logsFailure) throw chain.logsFailure
      return chain.logs
    },
    async getCode({ address }: { address: Address }) {
      chain.calls.push(`code ${address}`)
      return chain.validatorHasCode && address === VALIDATOR ? '0x6080' : undefined
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
      if (functionName === 'collectionState') return chain.state(blockNumber)
      if (functionName === 'owner') return OWNER
      if (functionName === 'royaltyInfo') return [OWNER, 500n]
      if (functionName === 'baseURI') return chain.baseUris.get(address) ?? 'ipfs://first/'
      if (functionName === 'getTransferValidator') return chain.validators.get(address) ?? VALIDATOR
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
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
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
    expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
      `The call baseURI on ${A} (Anvil) answered nothing; the collection stays as it was.`,
    ])
    chain.head = 102n
    chain.logs = []
    chain.reverts.clear()
    chain.baseUris.set(A, 'ipfs://second/')
    await vi.advanceTimersByTimeAsync(2_000)
    expect([a.read?.state.block, a.read?.extras.baseUri, a.marked]).toEqual([102n, 'ipfs://second/', false])
    await reader.stop()
  })

  it('keeps a collection read in full at a head below the scanned block marked, and reads it in full again at the next tick', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    chain.head = 102n
    await vi.advanceTimersByTimeAsync(2_000)
    // An older head (a load-balanced RPC) as B joins: B is read in full at 101, below the scanned 102.
    chain.head = 101n
    const b = hot.join(31337, B, Date.now()).entry
    reader.wake()
    await settle()
    expect([b.read?.state.block, b.read?.extras.baseUri, b.marked]).toEqual([101n, 'ipfs://first/', true])
    // B's base URI changed in block 102, which the scan passed before B joined.
    chain.baseUris.set(B, 'ipfs://second/')
    chain.head = 103n
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.calls).toEqual([
      'head',
      'logs 103-103',
      `collectionState ${A} @103`,
      `collectionState ${B} @103`,
      `owner ${B} @103`,
      `royaltyInfo ${B} @103`,
      `baseURI ${B} @103`,
      `getTransferValidator ${B} @103`,
      `code ${VALIDATOR}`,
    ])
    expect([b.read?.state.block, b.read?.extras.baseUri, b.marked]).toEqual([103n, 'ipfs://second/', false])
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
    expect(reader.health()).toMatchObject({ hot: 0, tier: null, lagSeconds: null })
    chain.head = 150n
    chain.calls.length = 0
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    expect(chain.calls.slice(0, 2)).toEqual(['head', `collectionState ${A} @150`])
    await reader.stop()
  })

  it('counts a head unchanged since the last read as a read now, with no log scan and no call (reconciliation 10)', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const { entry } = hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.calls).toEqual(['head'])
    expect([entry.read?.state.block, entry.readAt]).toEqual([100n, 1_002_000])
    await reader.stop()
  })

  it('counts a failed scan and a range over 500 blocks as gaps, reads every hot collection in full after each, and scans on from the head', async () => {
    const { chain, client } = fakeChain()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    hot.join(31337, A, Date.now())
    hot.join(31337, B, Date.now())
    reader.wake()
    await settle()
    const scansAndOwners = () =>
      chain.calls.filter((call) => call.startsWith('logs') || call.startsWith('owner'))
    chain.head = 101n
    chain.logsFailure = rpcDown(429)
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(2_000)
    expect(scansAndOwners()).toEqual(['logs 101-101', `owner ${A} @101`, `owner ${B} @101`])
    expect(reader.health().logGaps).toBe(1)
    chain.logsFailure = null
    chain.head = 701n
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(2_000)
    expect(scansAndOwners()).toEqual([`owner ${A} @701`, `owner ${B} @701`])
    expect(reader.health().logGaps).toBe(2)
    chain.head = 702n
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(2_000)
    expect(scansAndOwners()).toEqual(['logs 702-702'])
    expect(reader.health()).toMatchObject({ logGaps: 2, failedTicks: 0, lastError: null })
    expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
      'The log scan on Anvil failed, so every hot collection is read in full: HttpRequestError: HTTP request failed.',
    ])
    await reader.stop()
  })

  it('leaves a marked collection whose validator call answers null as it was, mark included, and still reads the others', async () => {
    const { chain, client } = fakeChain()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    const a = hot.join(31337, A, Date.now()).entry
    const b = hot.join(31337, B, Date.now()).entry
    reader.wake()
    await settle()
    chain.head = 101n
    chain.logs = [metadataLog(A)]
    chain.reverts.add(`getTransferValidator ${A}`)
    await vi.advanceTimersByTimeAsync(2_000)
    expect([a.read?.state.block, a.marked]).toEqual([100n, true])
    expect([b.read?.state.block, b.marked]).toEqual([101n, false])
    expect(reader.health()).toMatchObject({ failedTicks: 0, lastError: null })
    expect(errors.mock.calls.map((call) => String(call[0]))).toEqual([
      `The call getTransferValidator on ${A} (Anvil) answered nothing; the collection stays as it was.`,
    ])
    await reader.stop()
  })

  it("reads the head past viem's cache, and scans the validators found with code, not one without (section 6.5)", async () => {
    const { chain, client } = fakeChain()
    chain.validatorHasCode = true
    chain.validators.set(B, BARE_VALIDATOR)
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    hot.join(31337, A, Date.now())
    hot.join(31337, B, Date.now())
    reader.wake()
    await settle()
    chain.head = 101n
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.headArgs).toEqual([{ cacheTime: 0 }, { cacheTime: 0 }])
    expect(chain.logAddresses).toEqual([[A, B, VALIDATOR]])
    await reader.stop()
  })

  it('stops only once the tick in flight has ended, then leaves no timer and reads nothing more', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    let release = () => {}
    chain.gate = new Promise<void>((resolve) => (release = resolve))
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.headsInFlight).toBe(1)
    let stopped = false
    const stopping = reader.stop().then(() => {
      stopped = true
    })
    await settle()
    expect(stopped).toBe(false)
    chain.gate = null
    release()
    await stopping
    expect(vi.getTimerCount()).toBe(0)
    const heads = chain.calls.filter((call) => call === 'head').length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(chain.calls.filter((call) => call === 'head')).toHaveLength(heads)
  })

  it('clears the next tick when stopped between ticks, and reads nothing on a later wake', async () => {
    const { chain, client } = fakeChain()
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    expect(vi.getTimerCount()).toBe(1)
    await reader.stop()
    expect(vi.getTimerCount()).toBe(0)
    reader.wake()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(chain.calls.filter((call) => call === 'head')).toHaveLength(1)
  })

  it('never reads back to back while an idle read stays frozen past its start window (Important 1)', async () => {
    const { chain, client } = fakeChain()
    chain.state = scheduledAt
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    expect(reader.health().tier).toBe('idle')
    chain.failure = rpcDown(503)
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(60_000)
    // A tick when the window opens, 8 s after the read, then the idle tier's 20 s: 3 head reads in 60 s.
    const heads = chain.calls.filter((call) => call === 'head').length
    expect(heads).toBeGreaterThan(0)
    expect(heads).toBeLessThanOrEqual(5)
    expect(reader.health().failedTicks).toBe(heads)
    const lines = errors.mock.calls.map((call) => String(call[0]))
    expect(lines).toHaveLength(heads)
    expect(new Set(lines)).toEqual(
      new Set(['A tick on Anvil failed: HttpRequestError: HTTP request failed.']),
    )
    await reader.stop()
  })

  it('counts a tick that throws outside its try as failed, logs its name and ticks again', async () => {
    const { chain, client } = fakeChain()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const set = hotSet()
    let breaks = false
    const hot: HotSet = {
      ...set,
      onChain(chainId) {
        if (breaks) {
          breaks = false
          throw new TypeError('the hot set broke')
        }
        return set.onChain(chainId)
      },
    }
    const reader = chainReader(ANVIL, hot, client)
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    breaks = true
    chain.calls.length = 0
    await vi.advanceTimersByTimeAsync(2_000)
    expect(chain.calls).toEqual([])
    expect(reader.health()).toMatchObject({ failedTicks: 1, lastError: 'TypeError' })
    expect(errors.mock.calls.map((call) => String(call[0]))).toEqual(['A tick on Anvil failed: TypeError'])
    chain.head = 101n
    // The next tick comes one interval of the chain's tier (live, 2 s) after the throw.
    await vi.advanceTimersByTimeAsync(1_999)
    expect(chain.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(chain.calls).toEqual(['head', 'logs 101-101', `collectionState ${A} @101`])
    await reader.stop()
  })

  it('reports the tier of its read collections only, so a collection joining an idle chain keeps it idle until read (Decision 6)', async () => {
    const { chain, client } = fakeChain()
    chain.state = scheduledAt
    const hot = hotSet()
    const reader = chainReader(ANVIL, hot, client)
    hot.join(31337, A, Date.now())
    reader.wake()
    await settle()
    expect(reader.health()).toMatchObject({ hot: 1, tier: 'idle' })
    let release = () => {}
    chain.gate = new Promise<void>((resolve) => (release = resolve))
    const b = hot.join(31337, B, Date.now()).entry
    reader.wake()
    await settle()
    // The wake tick waits at its head read, with B not read yet.
    expect([b.read, chain.headsInFlight]).toEqual([null, 1])
    expect(reader.health()).toMatchObject({ hot: 2, tier: 'idle' })
    chain.gate = null
    release()
    await settle()
    expect(b.read?.state.block).toBe(100n)
    expect(reader.health()).toMatchObject({ hot: 2, tier: 'idle' })
    await reader.stop()
  })
})

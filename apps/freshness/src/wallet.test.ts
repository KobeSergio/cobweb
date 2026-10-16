import { chainById, DELEGATE_REGISTRY, DELEGATION_TYPE, type ChainConfig } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  getAddress,
  HttpRequestError,
  InvalidAddressError,
  isAddress,
  zeroAddress,
  zeroHash,
  type Address,
  type PublicClient,
} from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Delegation } from './delegations.ts'
import {
  NULL_LISTING_LOG_EVERY_MS,
  QUEUE_MAX,
  REGISTRY_RECHECK_MS,
  WINDOW_MAX,
  WINDOW_MS,
  walletWindows,
  type WalletBody,
} from './wallet.ts'

const ANVIL: ChainConfig = chainById(31337, false)!
const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const V1: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const V2: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const V3: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
/** WALLET in mixed case with a wrong checksum. */
const MISSPELLED_WALLET: Address = '0x70997970c51812dc3A010C7d01b50e0d17dc79C8'

/** The wallet of index `n`, checksummed, distinct for every n. */
const walletOf = (n: number) => getAddress(`0x${(n + 1).toString(16).padStart(40, '0')}`)

const delegation = (from: Address, overrides: Partial<Delegation> = {}): Delegation => ({
  type_: DELEGATION_TYPE.all,
  to: WALLET,
  from,
  rights: zeroHash,
  contract_: zeroAddress,
  tokenId: 0n,
  amount: 0n,
  ...overrides,
})

/** A revert as viem reports it for one call. */
const reverted = (functionName: string, address: Address, args: readonly unknown[]) =>
  new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: collectionAbi, functionName }),
    {
      abi: collectionAbi,
      args,
      contractAddress: address,
      functionName,
    },
  )

/** An RPC failure as viem reports it: its message carries the URL, with the provider's key. */
const rpcDown = () => new HttpRequestError({ url: 'https://rpc.example/v2/secret-key', status: 503 })

/**
 * A fake reader on a chain without multicall3 (so `readEach` reads each call), recording `head`, `code`,
 * `walletState <collection> <wallet> @<block>` and `listing <wallet> @<block>`. Each wallet's `walletState`
 * is public 1, Holders (id 1) quota 2 and claimed 1. A wallet viem would refuse to encode (mixed case with a
 * wrong checksum) fails its call as viem's encoder does.
 */
function fakeReader() {
  const reader = {
    head: 100n,
    registryHasCode: true,
    failHead: false,
    failCode: false,
    calls: [] as string[],
    /** `<collection> <wallet>` pairs whose walletState reverts. */
    reverts: new Set<string>(),
    /** `<collection> <wallet>` pairs whose walletState answers a shape the window cannot read. */
    malformed: new Set<string>(),
    listings: new Map<string, Delegation[]>(),
    /** Wallets whose listing reverts. */
    failedListings: new Set<string>(),
  }
  const client = {
    chain: { contracts: {} },
    async getBlockNumber() {
      reader.calls.push('head')
      if (reader.failHead) throw rpcDown()
      return reader.head
    },
    async getCode({ address }: { address: Address }) {
      reader.calls.push(`code ${address}`)
      if (reader.failCode) throw rpcDown()
      return reader.registryHasCode ? '0x6080' : undefined
    },
    async readContract({
      address,
      functionName,
      args,
      blockNumber,
    }: {
      address: Address
      functionName: string
      args: [Address]
      blockNumber: bigint
    }) {
      if (functionName === 'getIncomingDelegations') {
        reader.calls.push(`listing ${args[0]} @${blockNumber}`)
        if (reader.failedListings.has(args[0])) throw reverted(functionName, DELEGATE_REGISTRY, args)
        return reader.listings.get(args[0]) ?? []
      }
      reader.calls.push(`walletState ${address} ${args[0]} @${blockNumber}`)
      if (!isAddress(args[0])) throw new InvalidAddressError({ address: args[0] })
      if (reader.reverts.has(`${address} ${args[0]}`)) throw reverted(functionName, address, args)
      if (reader.malformed.has(`${address} ${args[0]}`)) return [1n]
      return [1n, [0n, 1n], [0n, 2n], [0n, 1n]]
    },
  } as unknown as PublicClient
  return { reader, client }
}

/** The lines logged to `console.error`, as text. */
const linesOf = (errors: { mock: { calls: unknown[][] } }) => errors.mock.calls.map((call) => String(call[0]))

const quotas: Pick<WalletBody, 'publicMinted' | 'groups'> = {
  publicMinted: 1,
  groups: [
    { id: 0, quota: 0, claimed: 0 },
    { id: 1, quota: 2, claimed: 1 },
  ],
}

describe('walletWindows (docs/specs/2026-10-16-freshness-server.md, section 6.8)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('answers the asks made within 200 ms from one window, at one head', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    const windows = walletWindows(ANVIL, client)
    const first = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(150)
    const second = windows.ask(A, V1)
    expect(windows.stats()).toEqual({ windows: 0, answered: 0, waiting: 2 })
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 150)
    expect(await first).toEqual<WalletBody>({
      chainId: 31337,
      address: A,
      wallet: WALLET,
      block: 100,
      ...quotas,
      vaults: [],
    })
    expect(await second).toMatchObject({ wallet: V1, block: 100 })
    expect(reader.calls.filter((call) => call === 'head')).toHaveLength(1)
    expect(windows.stats()).toEqual({ windows: 1, answered: 2, waiting: 0 })
    await windows.stop()
  })

  it('reads a pair asked twice in a window once, whatever the case', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    const windows = walletWindows(ANVIL, client)
    const asks = [windows.ask(A, WALLET), windows.ask(A, WALLET.toLowerCase() as Address)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect((await Promise.all(asks)).map((body) => typeof body === 'object' && body.wallet)).toEqual([
      WALLET,
      WALLET,
    ])
    expect(reader.calls.filter((call) => call.startsWith('walletState'))).toEqual([
      `walletState ${A} ${WALLET} @100`,
    ])
    await windows.stop()
  })

  it('takes at most 200 pairs a window, and opens the next at once for the rest', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    const windows = walletWindows(ANVIL, client)
    const asks = Array.from({ length: 250 }, (_, n) => windows.ask(A, walletOf(n)))
    const states = () => reader.calls.filter((call) => call.startsWith('walletState')).length
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(states()).toBe(WINDOW_MAX)
    await vi.advanceTimersByTimeAsync(WINDOW_MS - 1)
    expect(states()).toBe(WINDOW_MAX)
    await vi.advanceTimersByTimeAsync(1)
    expect(states()).toBe(250)
    expect((await Promise.all(asks)).every((body) => typeof body === 'object')).toBe(true)
    expect(windows.stats()).toEqual({ windows: 2, answered: 250, waiting: 0 })
    await windows.stop()
  })

  it('answers busy to the ask past 5,000 waiting', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    const windows = walletWindows(ANVIL, client)
    const asks = Array.from({ length: QUEUE_MAX }, (_, n) => windows.ask(A, walletOf(n % 300)))
    expect(await windows.ask(B, WALLET)).toBe('busy')
    expect(windows.stats().waiting).toBe(QUEUE_MAX)
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 2)
    await Promise.all(asks)
    expect(windows.stats().waiting).toBe(0)
    await windows.stop()
  })

  it("fails a window's asks when its head fails, and only its pair when one walletState answers null", async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const windows = walletWindows(ANVIL, client)
    reader.failHead = true
    const failed = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await Promise.all(failed)).toEqual(['unreadable', 'unreadable'])
    // One line for the window: the error's name and viem's short message, never the RPC URL.
    expect(linesOf(errors)).toEqual([
      'A wallet window on Anvil failed: HttpRequestError: HTTP request failed.',
    ])
    reader.failHead = false
    reader.reverts.add(`${B} ${WALLET}`)
    const mixed = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    const [own, other] = await Promise.all(mixed)
    expect(own).toMatchObject({ address: A, block: 100 })
    expect(other).toBe('unreadable')
    expect(errors).toHaveBeenCalledTimes(1)
    await windows.stop()
  })

  it("fails a window's asks when the registry's code cannot be read, and asks for it again in the next", async () => {
    const { reader, client } = fakeReader()
    reader.failCode = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const windows = walletWindows(ANVIL, client)
    const failed = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await Promise.all(failed)).toEqual(['unreadable', 'unreadable'])
    expect(reader.calls).toEqual(['head', `code ${DELEGATE_REGISTRY}`])
    expect(linesOf(errors)).toEqual([
      'A wallet window on Anvil failed: HttpRequestError: HTTP request failed.',
    ])
    reader.failCode = false
    const next = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await next).toMatchObject({ address: A, wallet: WALLET, block: 100 })
    expect(reader.calls.filter((call) => call.startsWith('code'))).toHaveLength(2)
    await windows.stop()
  })

  it("fails a pair when one of its vaults' walletState answers null, and only that pair", async () => {
    const { reader, client } = fakeReader()
    reader.listings.set(WALLET, [delegation(V1)])
    reader.reverts.add(`${A} ${V1}`)
    const windows = walletWindows(ANVIL, client)
    const asks = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    const [onA, onB] = await Promise.all(asks)
    expect(onA).toBe('unreadable')
    expect(onB).toEqual<WalletBody>({
      chainId: 31337,
      address: B,
      wallet: WALLET,
      block: 100,
      ...quotas,
      vaults: [{ vault: V1, ...quotas }],
    })
    await windows.stop()
  })

  it('reads a listing that answers null as no vaults, and logs the wallet and the chain at most once every 10 s', async () => {
    const { reader, client } = fakeReader()
    reader.listings.set(WALLET, [delegation(V1)])
    reader.failedListings.add(WALLET)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const windows = walletWindows(ANVIL, client)
    const ask = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await ask).toEqual<WalletBody>({
      chainId: 31337,
      address: A,
      wallet: WALLET,
      block: 100,
      ...quotas,
      vaults: [],
    })
    const line = `The registry listing for ${WALLET} on Anvil answered nothing; it reads as no vaults.`
    expect(linesOf(errors)).toEqual([line])
    // The next window, 200 ms later, reads the same, unlogged; one 10 s after the first is logged again.
    const again = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await again).toMatchObject({ vaults: [] })
    expect(linesOf(errors)).toEqual([line])
    await vi.advanceTimersByTimeAsync(NULL_LISTING_LOG_EVERY_MS - 2 * WINDOW_MS)
    const later = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await later).toMatchObject({ vaults: [] })
    expect(linesOf(errors)).toEqual([line, line])
    await windows.stop()
  })

  it('answers each ask once when a window fails part-way through its pairs', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    // B's answer cannot be read, after A's pair has been answered.
    reader.malformed.add(`${B} ${WALLET}`)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const windows = walletWindows(ANVIL, client)
    const asks = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    const [onA, onB] = await Promise.all(asks)
    expect(onA).toMatchObject({ address: A, block: 100 })
    expect(onB).toBe('unreadable')
    expect(windows.stats()).toEqual({ windows: 1, answered: 2, waiting: 0 })
    expect(linesOf(errors)).toEqual(['A wallet window on Anvil failed: TypeError'])
    await windows.stop()
  })

  it('reads a pair asked in any spelling by its checksummed addresses, so a bad one fails nothing', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    const windows = walletWindows(ANVIL, client)
    const lower = windows.ask(A.toLowerCase() as Address, WALLET.toLowerCase() as Address)
    const misspelled = windows.ask(B, MISSPELLED_WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await lower).toMatchObject({ address: A, wallet: WALLET, block: 100 })
    expect(await misspelled).toMatchObject({ address: B, wallet: WALLET, block: 100 })
    expect(reader.calls.filter((call) => call.startsWith('walletState'))).toEqual([
      `walletState ${A} ${WALLET} @100`,
      `walletState ${B} ${WALLET} @100`,
    ])
    await windows.stop()
  })

  it("reads the vaults' walletState at the window's head, after the listing", async () => {
    const { reader, client } = fakeReader()
    reader.listings.set(WALLET, [
      delegation(V1),
      delegation(V2, { type_: DELEGATION_TYPE.contract, contract_: A }),
    ])
    const windows = walletWindows(ANVIL, client)
    const ask = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await ask).toEqual<WalletBody>({
      chainId: 31337,
      address: A,
      wallet: WALLET,
      block: 100,
      ...quotas,
      vaults: [
        { vault: V1, ...quotas },
        { vault: V2, ...quotas },
      ],
    })
    expect(reader.calls).toEqual([
      'head',
      `code ${DELEGATE_REGISTRY}`,
      `walletState ${A} ${WALLET} @100`,
      `listing ${WALLET} @100`,
      `walletState ${A} ${V1} @100`,
      `walletState ${A} ${V2} @100`,
    ])
    await windows.stop()
  })

  it('lists nothing where the registry has no code, and asks for its code again only after an hour', async () => {
    const { reader, client } = fakeReader()
    reader.registryHasCode = false
    reader.listings.set(WALLET, [delegation(V1)])
    const windows = walletWindows(ANVIL, client)
    const first = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await first).toMatchObject({ vaults: [] })
    const second = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    await second
    expect(reader.calls.filter((call) => call.startsWith('code') || call.startsWith('listing'))).toEqual([
      `code ${DELEGATE_REGISTRY}`,
    ])
    await vi.advanceTimersByTimeAsync(REGISTRY_RECHECK_MS)
    reader.registryHasCode = true
    const third = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await third).toMatchObject({ vaults: [{ vault: V1 }] })
    expect(reader.calls.filter((call) => call.startsWith('code'))).toHaveLength(2)
    await windows.stop()
  })

  it('reads one listing per wallet for two collections, each pair keeping only its own contract delegations (Review Focus 4)', async () => {
    const { reader, client } = fakeReader()
    reader.listings.set(WALLET, [
      delegation(V1, { type_: DELEGATION_TYPE.contract, contract_: A }),
      delegation(V2, { type_: DELEGATION_TYPE.contract, contract_: B }),
      delegation(V3),
    ])
    const windows = walletWindows(ANVIL, client)
    const asks = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    const [onA, onB] = await Promise.all(asks)
    const vaults = (body: unknown) => (body as WalletBody).vaults.map((entry) => entry.vault)
    expect([vaults(onA), vaults(onB)]).toEqual([
      [V1, V3],
      [V2, V3],
    ])
    expect(reader.calls.filter((call) => call.startsWith('listing'))).toEqual([`listing ${WALLET} @100`])
    expect(reader.calls.filter((call) => call.startsWith('walletState') && call.includes(V3))).toEqual([
      `walletState ${A} ${V3} @100`,
      `walletState ${B} ${V3} @100`,
    ])
    await windows.stop()
  })

  it('settles stop() once the window in flight has ended, and answers the asks still waiting unreadable', async () => {
    const client = {
      chain: { contracts: {} },
      getBlockNumber: async () => 100n,
      getCode: async () => undefined,
      readContract: async () => [1n, [0n, 1n], [0n, 2n], [0n, 1n]],
    } as unknown as PublicClient
    let release: () => void = () => {}
    const held = new Promise<bigint>((resolve) => {
      release = () => resolve(100n)
    })
    vi.spyOn(client, 'getBlockNumber').mockReturnValue(held)
    const windows = walletWindows(ANVIL, client)
    const inFlight = windows.ask(A, WALLET)
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    const waiting = windows.ask(A, V1)
    let stopped = false
    const stopping = windows.stop().then(() => (stopped = true))
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 3)
    expect(stopped).toBe(false)
    expect(await waiting).toBe('unreadable')
    expect(await windows.ask(B, WALLET)).toBe('unreadable')
    release()
    await stopping
    expect(stopped).toBe(true)
    expect(await inFlight).toMatchObject({ address: A, wallet: WALLET, block: 100 })
    expect(windows.stats()).toEqual({ windows: 1, answered: 2, waiting: 0 })
  })

  it('answers the queued asks unreadable on stop(), refuses the asks after it and leaves no timer', async () => {
    const { reader, client } = fakeReader()
    const windows = walletWindows(ANVIL, client)
    const answers: unknown[] = []
    const record = (ask: Promise<unknown>) => ask.then((answer) => answers.push(answer))
    record(windows.ask(A, WALLET))
    record(windows.ask(B, WALLET))
    expect(vi.getTimerCount()).toBe(1)
    await windows.stop()
    record(windows.ask(A, V1))
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(WINDOW_MS * 2)
    expect(answers).toEqual(['unreadable', 'unreadable', 'unreadable'])
    expect(reader.calls).toEqual([])
    expect(windows.stats()).toEqual({ windows: 0, answered: 2, waiting: 0 })
  })

  it('reads in windows of 200 ms and 200 pairs, lets 5,000 asks wait, and asks for the registry again after an hour', () => {
    expect([WINDOW_MS, WINDOW_MAX, QUEUE_MAX, REGISTRY_RECHECK_MS]).toEqual([200, 200, 5_000, 3_600_000])
  })
})

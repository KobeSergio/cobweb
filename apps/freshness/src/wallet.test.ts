import { chainById, DELEGATE_REGISTRY, DELEGATION_TYPE } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  getAddress,
  HttpRequestError,
  zeroAddress,
  zeroHash,
  type Address,
  type PublicClient,
} from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Delegation } from './delegations.ts'
import {
  QUEUE_MAX,
  REGISTRY_RECHECK_MS,
  WINDOW_MAX,
  WINDOW_MS,
  walletWindows,
  type WalletBody,
} from './wallet.ts'

const ANVIL = chainById(31337, false)!
const A: Address = '0x0409454C375c8a6aB05383bFB6D9FcDe9ebB8F85'
const B: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const WALLET: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const V1: Address = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
const V2: Address = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const V3: Address = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'

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

/**
 * A fake reader on a chain without multicall3 (so `readEach` reads each call), recording `head`, `code`,
 * `walletState <collection> <wallet> @<block>` and `listing <wallet> @<block>`. Each wallet's `walletState`
 * is public 1, Holders (id 1) quota 2 and claimed 1.
 */
function fakeReader() {
  const reader = {
    head: 100n,
    registryHasCode: true,
    failHead: false,
    calls: [] as string[],
    /** `<collection> <wallet>` pairs whose walletState reverts. */
    reverts: new Set<string>(),
    listings: new Map<string, Delegation[]>(),
  }
  const client = {
    chain: { contracts: {} },
    async getBlockNumber() {
      reader.calls.push('head')
      if (reader.failHead)
        throw new HttpRequestError({ url: 'https://rpc.example/v2/secret-key', status: 503 })
      return reader.head
    },
    async getCode({ address }: { address: Address }) {
      reader.calls.push(`code ${address}`)
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
        return reader.listings.get(args[0]) ?? []
      }
      reader.calls.push(`walletState ${address} ${args[0]} @${blockNumber}`)
      if (reader.reverts.has(`${address} ${args[0]}`))
        throw new ContractFunctionExecutionError(
          new ContractFunctionRevertedError({ abi: collectionAbi, functionName: 'walletState' }),
          { abi: collectionAbi, args, contractAddress: address, functionName: 'walletState' },
        )
      return [1n, [0n, 1n], [0n, 2n], [0n, 1n]]
    },
  } as unknown as PublicClient
  return { reader, client }
}

const quotas = {
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
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const windows = walletWindows(ANVIL, client)
    reader.failHead = true
    const failed = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    expect(await Promise.all(failed)).toEqual(['unreadable', 'unreadable'])
    reader.failHead = false
    reader.reverts.add(`${B} ${WALLET}`)
    const mixed = [windows.ask(A, WALLET), windows.ask(B, WALLET)]
    await vi.advanceTimersByTimeAsync(WINDOW_MS)
    const [own, other] = await Promise.all(mixed)
    expect(own).toMatchObject({ address: A, block: 100 })
    expect(other).toBe('unreadable')
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
})

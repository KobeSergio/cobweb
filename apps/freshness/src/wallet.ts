import { DELEGATE_REGISTRY, delegateRegistryAbi, readEach, type ChainConfig } from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import type { Address, ContractFunctionParameters, PublicClient } from 'viem'
import { vaultsOf, type Delegation } from './delegations.ts'
import { errorLine } from './health.ts'

/**
 * The wallet endpoint's reads (docs/specs/2026-10-16-freshness-server.md, section 6.8): asks are gathered per
 * chain into 200 ms windows of at most 200 distinct (collection, wallet) pairs. A window reads the head, then
 * one `readEach` at it of each pair's `walletState(wallet)` and, where the registry has code, each distinct
 * wallet's `getIncomingDelegations`, then the vaults' `walletState` at the same block. There is no cache: the
 * edge holds each answer 5 s.
 */

/** A window closes 200 ms after it opens. */
export const WINDOW_MS = 200
/** The most pairs one window reads; the rest wait for the next window, which opens at once. */
export const WINDOW_MAX = 200
/** The most asks that may wait on one chain; the next answers busy. */
export const QUEUE_MAX = 5_000
/** Where the registry has no code, it is asked again after an hour. */
export const REGISTRY_RECHECK_MS = 3_600_000

/** One registered group of `walletState`: the quota issued and claimed, both 0 for the public group. */
export type QuotaBody = { id: number; quota: number; claimed: number }

export type WalletBody = {
  chainId: number
  /** The collection, checksummed. */
  address: Address
  /** Checksummed. */
  wallet: Address
  /** The block the window read at. */
  block: number
  publicMinted: number
  groups: QuotaBody[]
  vaults: { vault: Address; publicMinted: number; groups: QuotaBody[] }[]
}

type Answer = WalletBody | 'busy' | 'unreadable'
type Pair = { address: Address; wallet: Address; waiters: ((answer: Answer) => void)[] }
type WalletState = readonly [bigint, readonly bigint[], readonly bigint[], readonly bigint[]]

/** A `walletState` answer as the body carries it. */
function quotasOf(state: WalletState): { publicMinted: number; groups: QuotaBody[] } {
  const [publicMinted, ids, issued, claimed] = state
  return {
    publicMinted: Number(publicMinted),
    groups: ids.map((id, index) => ({
      id: Number(id),
      quota: Number(issued[index] ?? 0n),
      claimed: Number(claimed[index] ?? 0n),
    })),
  }
}

export function walletWindows(
  chain: ChainConfig,
  client: PublicClient,
): {
  ask(address: Address, wallet: Address): Promise<Answer>
  stats(): { windows: number; answered: number; waiting: number }
  stop(): Promise<void>
} {
  /** The pairs waiting for the next window to close, in the order they were first asked. */
  const queue = new Map<string, Pair>()
  const reads = new Set<Promise<void>>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let registry: { hasCode: boolean; askedAt: number } | null = null
  let windows = 0
  let answered = 0
  let waiting = 0
  let stopped = false

  function answer(pair: Pair, value: Answer): void {
    for (const resolve of pair.waiters) resolve(value)
    waiting -= pair.waiters.length
    answered += pair.waiters.length
  }

  /**
   * Whether the registry has code on the chain: code found is kept, and none is asked again after an hour.
   */
  async function listed(head: bigint): Promise<boolean> {
    if (registry && (registry.hasCode || Date.now() - registry.askedAt < REGISTRY_RECHECK_MS))
      return registry.hasCode
    const code = await client.getCode({ address: DELEGATE_REGISTRY, blockNumber: head })
    registry = { hasCode: !!code && code !== '0x', askedAt: Date.now() }
    return registry.hasCode
  }

  async function read(pairs: readonly Pair[]): Promise<void> {
    try {
      const head = await client.getBlockNumber({ cacheTime: 0 })
      const withRegistry = await listed(head)
      const wallets = [...new Map(pairs.map((pair) => [pair.wallet.toLowerCase(), pair.wallet])).values()]
      const calls: ContractFunctionParameters[] = pairs.map((pair) => ({
        address: pair.address,
        abi: collectionAbi,
        functionName: 'walletState',
        args: [pair.wallet],
      }))
      if (withRegistry)
        for (const wallet of wallets)
          calls.push({
            address: DELEGATE_REGISTRY,
            abi: delegateRegistryAbi,
            functionName: 'getIncomingDelegations',
            args: [wallet],
          })
      const answers = await readEach<unknown>(client, calls, { blockNumber: head })
      // A null listing reads as no vaults.
      const listings = new Map(
        wallets.map((wallet, index) => [
          wallet.toLowerCase(),
          (answers[pairs.length + index] ?? []) as readonly Delegation[],
        ]),
      )
      const vaults = pairs.map((pair) =>
        vaultsOf(listings.get(pair.wallet.toLowerCase()) ?? [], pair.address, pair.wallet),
      )
      const vaultStates = await readEach<WalletState>(
        client,
        pairs.flatMap((pair, index) =>
          vaults[index]!.map((vault) => ({
            address: pair.address,
            abi: collectionAbi,
            functionName: 'walletState',
            args: [vault],
          })),
        ),
        { blockNumber: head },
      )
      let next = 0
      pairs.forEach((pair, index) => {
        const own = answers[index] as WalletState | null
        const theirs = vaults[index]!.map((vault) => ({ vault, state: vaultStates[next++] ?? null }))
        // A null walletState, the wallet's or a vault's, fails its pair.
        if (own === null || theirs.some(({ state }) => state === null)) return answer(pair, 'unreadable')
        answer(pair, {
          chainId: chain.id,
          address: pair.address,
          wallet: pair.wallet,
          block: Number(head),
          ...quotasOf(own),
          vaults: theirs.map(({ vault, state }) => ({ vault, ...quotasOf(state!) })),
        })
      })
    } catch (error) {
      console.error(`A wallet window on ${chain.name} failed: ${errorLine(error)}`)
      for (const pair of pairs) answer(pair, 'unreadable')
    }
  }

  /** Closes the open window: takes up to 200 pairs, opens the next window at once for the rest, reads. */
  function close(): void {
    timer = null
    const pairs: Pair[] = []
    for (const [key, pair] of queue) {
      if (pairs.length === WINDOW_MAX) break
      queue.delete(key)
      pairs.push(pair)
    }
    if (queue.size) timer = setTimeout(close, WINDOW_MS)
    windows++
    const reading = read(pairs).finally(() => reads.delete(reading))
    reads.add(reading)
  }

  return {
    ask(address, wallet) {
      if (stopped) return Promise.resolve('unreadable')
      if (waiting >= QUEUE_MAX) return Promise.resolve('busy')
      waiting++
      return new Promise<Answer>((resolve) => {
        const key = `${address.toLowerCase()}:${wallet.toLowerCase()}`
        const pair = queue.get(key)
        if (pair) pair.waiters.push(resolve)
        else queue.set(key, { address, wallet, waiters: [resolve] })
        timer ??= setTimeout(close, WINDOW_MS)
      })
    },
    stats() {
      return { windows, answered, waiting }
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      for (const pair of queue.values()) answer(pair, 'unreadable')
      queue.clear()
      await Promise.all(reads)
    },
  }
}

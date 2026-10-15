import {
  chainStateOf,
  levelOf,
  readEach,
  validatorAbi,
  type ChainConfig,
  type ChainState,
  type CollectionStateResult,
  type TransferLevelState,
} from '@cobweb/shared'
import { collectionAbi } from '@cobweb/shared/collection-abi'
import {
  getAddress,
  numberToHex,
  zeroAddress,
  type Address,
  type ContractFunctionParameters,
  type PublicClient,
} from 'viem'
import { errorLine, errorName, type ChainHealth } from './health.ts'
import type { HotEntry, HotSet } from './hot-set.ts'
import { scanLogs, type GetLogs } from './logs.ts'
import { chainTier, nextDelayMs } from './tiers.ts'

/** The fees `collectionState()` carries, wei as decimal strings. */
export type FeeWei = { mintFeeFlatWei: string; mintFeeBps: number; airdropFeePerTokenWei: string }

/** What a mint page shows beside the state, read on their logs and every 60 s. */
export type Extras = {
  owner: Address
  royalty: { receiver: Address; bps: number }
  baseUri: string
  transferValidator: Address
  transferLevel: TransferLevelState
}

/** A collection's last read: the state at its block, the fees and the extras. */
export type CollectionRead = { state: ChainState; fees: FeeWei; extras: Extras }

/** Besides on their logs, the extras are read again once 60 s old. */
export const EXTRAS_EVERY_MS = 60_000

/** The four extras calls, in the order the tick reads them. */
const extrasCalls = (address: Address): ContractFunctionParameters[] => [
  { address, abi: collectionAbi, functionName: 'owner' },
  // Settings reads the royalty the same way: token 1 at a price of 10,000, so the amount is the basis points.
  { address, abi: collectionAbi, functionName: 'royaltyInfo', args: [1n, 10_000n] },
  { address, abi: collectionAbi, functionName: 'baseURI' },
  { address, abi: collectionAbi, functionName: 'getTransferValidator' },
]

/**
 * The reader of one chain (docs/specs/2026-10-16-freshness-server.md, section 6.4). A tick expires the
 * chain's entries (with none left the reader stops and forgets its scanned block), reads the head, counts an
 * entry read at the head or later as read now, scans the logs since the last scanned block, then reads every
 * other entry's `collectionState()` at the head in one `readEach`, with the extras where they are due, and
 * the levels after it. Ticks never overlap: a wake during a tick runs one more tick after it. The next tick
 * starts one interval after this one started, or at once when it ran longer.
 */
export function chainReader(
  chain: ChainConfig,
  hot: HotSet,
  client: PublicClient,
): { wake(): void; stop(): Promise<void>; health(): ChainHealth } {
  /** The last block the logs were scanned to; null before the chain's first tick. */
  let scanned: bigint | null = null
  /** Validators found with code on this chain, lowercase. */
  const withCode = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let again = false
  let stopped = false
  let block: bigint | null = null
  let headTime: number | null = null
  let lastGoodTickAt: number | null = null
  let failedTicks = 0
  let lastError: string | null = null
  let logGaps = 0

  const getLogs: GetLogs = (filter) =>
    client.request({
      method: 'eth_getLogs',
      params: [
        {
          address: filter.address,
          topics: filter.topics,
          fromBlock: numberToHex(filter.fromBlock),
          toBlock: numberToHex(filter.toBlock),
        },
      ],
    })

  /**
   * Each collection's level on its validator at the head, as Settings reads it: none for the zero validator
   * or one without code, the policy's level, or unread when the validator does not answer. A failed request
   * reads unread for all of them, without failing the tick.
   */
  async function levelsAt(
    head: bigint,
    asks: readonly { collection: Address; validator: Address }[],
  ): Promise<TransferLevelState[]> {
    const isZero = (validator: Address) => validator.toLowerCase() === zeroAddress
    try {
      // Each distinct validator not yet known to have code is asked once, at the head.
      const unknown = new Map<string, Address>()
      for (const { validator } of asks)
        if (!isZero(validator) && !withCode.has(validator.toLowerCase()))
          unknown.set(validator.toLowerCase(), validator)
      await Promise.all(
        [...unknown].map(async ([key, validator]) => {
          const code = await client.getCode({ address: validator, blockNumber: head })
          if (code && code !== '0x') withCode.add(key)
        }),
      )
      const hasCode = (validator: Address) => withCode.has(validator.toLowerCase())
      const policed = asks.filter((ask) => !isZero(ask.validator) && hasCode(ask.validator))
      const policies = await readEach<{ transferSecurityLevel: number }>(
        client,
        policed.map((ask) => ({
          address: ask.validator,
          abi: validatorAbi,
          functionName: 'getCollectionSecurityPolicy',
          args: [ask.collection],
        })),
        { blockNumber: head },
      )
      return asks.map((ask): TransferLevelState => {
        if (isZero(ask.validator) || !hasCode(ask.validator)) return levelOf(ask.validator, false, null)
        const policy = policies[policed.indexOf(ask)]
        return levelOf(ask.validator, true, policy ? policy.transferSecurityLevel : null)
      })
    } catch (error) {
      console.error(`The transfer levels on ${chain.name} could not be read: ${errorLine(error)}`)
      return asks.map((ask) =>
        isZero(ask.validator) ? levelOf(ask.validator, false, null) : { kind: 'unread' },
      )
    }
  }

  /**
   * Steps 5 to 7: one `readEach` at the head for `entries`, the levels after it, then each entry's new read.
   */
  async function readAt(head: bigint, entries: readonly HotEntry[], now: number): Promise<void> {
    const calls: ContractFunctionParameters[] = []
    const plans = entries.map((entry) => {
      const extras =
        entry.read === null ||
        entry.marked ||
        entry.extrasReadAt === null ||
        now - entry.extrasReadAt >= EXTRAS_EVERY_MS
      const at = calls.length
      calls.push({ address: entry.address, abi: collectionAbi, functionName: 'collectionState' })
      if (extras) calls.push(...extrasCalls(entry.address))
      return { entry, at, extras }
    })
    if (!calls.length) return
    const answers = await readEach<unknown>(client, calls, { blockNumber: head })
    // A call answering null leaves its entry as it was, its mark included.
    const answered = plans.filter(({ at, extras }) =>
      answers.slice(at, at + (extras ? 5 : 1)).every((answer) => answer !== null),
    )
    const levelAsks = answered
      .filter((plan) => plan.extras)
      .map(({ entry, at }) => ({
        collection: entry.address,
        validator: getAddress(answers[at + 4] as Address),
      }))
    const levels = await levelsAt(head, levelAsks)
    const doneAt = Date.now()
    for (const { entry, at, extras } of answered) {
      const raw = answers[at] as CollectionStateResult
      const previous = entry.read
      let read: Extras
      if (extras) {
        const [receiver, bps] = answers[at + 2] as readonly [Address, bigint]
        const asked = levelAsks.findIndex((ask) => ask.collection === entry.address)
        read = {
          owner: getAddress(answers[at + 1] as Address),
          royalty: { receiver: getAddress(receiver), bps: Number(bps) },
          baseUri: answers[at + 3] as string,
          transferValidator: levelAsks[asked]!.validator,
          transferLevel: levels[asked]!,
        }
      } else if (previous) read = previous.extras
      else continue
      entry.read = {
        state: chainStateOf(raw, head),
        fees: {
          mintFeeFlatWei: raw.mintFeeFlat.toString(),
          mintFeeBps: Number(raw.mintFeeBps),
          airdropFeePerTokenWei: raw.airdropFeePerToken.toString(),
        },
        extras: read,
      }
      entry.readAt = doneAt
      if (extras) {
        entry.extrasReadAt = doneAt
        entry.marked = false
      }
    }
  }

  /** One tick; answers the delay to the next, or null when the chain has no hot entry left. */
  async function tick(): Promise<number | null> {
    const startedAt = Date.now()
    hot.expire(startedAt)
    const entries = hot.onChain(chain.id)
    if (!entries.length) {
      scanned = null
      return null
    }
    try {
      // cacheTime 0: viem would otherwise reuse a recent head for its polling interval.
      const head = await client.getBlockNumber({ cacheTime: 0 })
      const now = Date.now()
      const stale: HotEntry[] = []
      for (const entry of entries) {
        // A load-balanced RPC can answer an older head: an entry read at the head or later is current.
        if (entry.read && entry.read.state.block >= head) entry.readAt = now
        else stale.push(entry)
      }
      if (scanned === null) scanned = head
      else if (head > scanned) {
        const validators = [
          ...new Set(
            entries
              .map((entry) => entry.read?.extras.transferValidator)
              .filter(
                (validator): validator is Address => !!validator && withCode.has(validator.toLowerCase()),
              ),
          ),
        ]
        const targets = entries.map((entry) => ({
          address: entry.address,
          validator: entry.read?.extras.transferValidator ?? null,
        }))
        const scan = await scanLogs(getLogs, scanned, head, targets, validators)
        if (scan.gap) logGaps++
        if (scan.failure)
          console.error(
            `The log scan on ${chain.name} failed (${scan.failure}); every hot collection is read in full.`,
          )
        for (const entry of entries) if (scan.marks.has(entry.address.toLowerCase())) entry.marked = true
        scanned = head
      }
      await readAt(head, stale, now)
      block = block !== null && block > head ? block : head
      const times = entries.flatMap((entry) => (entry.read ? [entry.read.state.blockTimestamp] : []))
      if (times.length) headTime = Math.max(...times)
      lastGoodTickAt = Date.now()
    } catch (error) {
      failedTicks++
      lastError = errorName(error)
      console.error(`A tick on ${chain.name} failed: ${errorLine(error)}`)
    }
    const current = hot.onChain(chain.id)
    const reads = current.flatMap((entry) =>
      entry.read && entry.readAt !== null ? [{ state: entry.read.state, readAt: entry.readAt }] : [],
    )
    const tier = chainTier(current.map((entry) => entry.read?.state ?? null))
    return nextDelayMs(tier, reads, startedAt, Date.now())
  }

  function start(): void {
    if (stopped || running) return
    if (timer) clearTimeout(timer)
    timer = null
    running = tick().then((delay) => {
      running = null
      if (stopped) return
      if (again) {
        again = false
        start()
      } else if (delay !== null) timer = setTimeout(start, delay)
    })
  }

  return {
    wake() {
      if (stopped) return
      if (running) again = true
      else start()
    },
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      await running
    },
    health() {
      const entries = hot.onChain(chain.id)
      return {
        chainId: chain.id,
        name: chain.name,
        hot: entries.length,
        tier: entries.length ? chainTier(entries.map((entry) => entry.read?.state ?? null)) : null,
        block: block === null ? null : Number(block),
        lagSeconds: headTime === null ? null : Math.max(0, Math.round(Date.now() / 1_000 - headTime)),
        lastGoodTickAt: lastGoodTickAt === null ? null : new Date(lastGoodTickAt).toISOString(),
        failedTicks,
        lastError,
        logGaps,
      }
    },
  }
}

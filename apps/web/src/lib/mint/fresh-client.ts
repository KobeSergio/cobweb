import { statePath, walletPath, type StateBody, type WalletBody } from '@cobweb/shared'
import { isAddress, type Address } from 'viem'
import { z } from 'zod'
import type { Phase } from '@/components/mint/model'

/**
 * The mint page's freshness client (docs/specs/2026-10-16-mint-page-live-data.md, section 7.1), pure apart from
 * the fetch it is given: one poll of the state or wallet endpoint read into an answer, the track that folds the
 * answers in (the shown body, the highest block, the chain clock's anchor, the failures), the clock, the
 * page's own `degraded` and the cadence. The browser's cache sends `If-None-Match` itself (`cache:
 * 'no-cache'`), so a poll never makes a preflight; a fresh state poll (`cache: 'reload'`) asks past the
 * browser's stored copy, so a page load never anchors the clock on an old block. Liveness is each group's
 * `active`; nothing here computes it.
 */

/** An answer older than this at the edge counts as a failed poll. */
export const UNREACHABLE_AGE_S = 10
/** The longest wait between polls after failures. */
export const RETRY_MAX_MS = 8_000
/** Without an accepted answer for this long, the page raises its own degraded banner. */
export const OWN_DEGRADED_MS = 10_000
/** How long a mint waits for the next accepted answer before checking again. */
export const NEXT_ANSWER_MAX_MS = 2_000
/** A poll that has not answered after this long counts as a network failure, so a hung request never stops the polls. */
export const POLL_TIMEOUT_MS = 5_000

export type StatePoll =
  | { kind: 'body'; body: StateBody; ageSeconds: number }
  | {
      kind: 'retry'
      afterMs: number
      reason: 'not-read-yet' | 'chain-unreadable' | 'busy' | 'stale' | 'network'
    }
  | { kind: 'final'; reason: 'not-a-collection' | 'unavailable' }
export type WalletPoll =
  { kind: 'body'; body: WalletBody } | { kind: 'retry'; afterMs: number } | { kind: 'final' }

/** An address in any case: the server lowercases what it is asked, so no checksum is required. */
const addressShape = z.custom<Address>(
  (value) => typeof value === 'string' && isAddress(value, { strict: false }),
)
const count = z.number().int().min(0)
const wei = z.string().regex(/^[0-9]+$/)

const stateBodySchema: z.ZodType<StateBody> = z.object({
  chainId: count,
  address: addressShape,
  block: count,
  blockTimestamp: count,
  readAt: count,
  degraded: z.boolean(),
  maxSupply: count,
  totalMinted: count,
  publicMaxMintPerWallet: count,
  mintFeeFlatWei: wei,
  mintFeeBps: count,
  airdropFeePerTokenWei: wei,
  mintOnBehalfActive: z.boolean(),
  groups: z.array(
    z.object({
      id: count,
      priceWei: wei,
      maxSupply: count,
      minted: count,
      startTimestamp: count,
      flag: z.boolean(),
      active: z.boolean(),
    }),
  ),
  owner: addressShape,
  royalty: z.object({ receiver: addressShape, bps: count }),
  baseUri: z.string(),
  transferValidator: addressShape,
  transferLevel: z.union([z.literal('none'), z.literal('unread'), count]),
})

const quotaSchema = z.object({ id: count, quota: count, claimed: count })
const walletBodySchema: z.ZodType<WalletBody> = z.object({
  chainId: count,
  address: addressShape,
  wallet: addressShape,
  block: count,
  publicMinted: count,
  groups: z.array(quotaSchema),
  vaults: z.array(z.object({ vault: addressShape, publicMinted: count, groups: z.array(quotaSchema) })),
})

/** Whether two addresses are the same whatever their case: the server's are lowercase, wagmi's checksummed. */
export const sameAddress = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
/** `Retry-After` in milliseconds: its seconds, or 1 s without one. */
const retryAfterMs = (response: Response) => {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1_000 : 1_000
}
/** The edge's `Age` in seconds, 0 without one. */
const ageOf = (response: Response) => {
  const age = Number(response.headers.get('age') ?? 0)
  return Number.isFinite(age) && age > 0 ? age : 0
}
/** The refusal's `{ "error": "<code>" }`, or null for a body that is not one. */
async function refusalCodeOf(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === 'string' ? body.error : null
  } catch {
    return null
  }
}

/**
 * One request, failed after `POLL_TIMEOUT_MS`; null when the network did not answer. With `no-cache` the
 * browser asks with its stored copy's `If-None-Match` and hands that copy back on a 304; with `reload` it asks
 * without one and stores the server's answer.
 */
async function request(
  url: string,
  fetchImpl: typeof fetch,
  cache: 'no-cache' | 'reload' = 'no-cache',
): Promise<Response | null> {
  try {
    return await fetchImpl(url, { cache, signal: AbortSignal.timeout(POLL_TIMEOUT_MS) })
  } catch {
    return null
  }
}

/** The server's origin without a trailing slash, as `ipfsGateway()` trims it; empty without one. */
const originOf = (base: string | undefined) => (base ?? '').replace(/\/+$/, '')

/**
 * One poll of a collection's state: a body that parses for the asked chain and address, with its edge `Age`;
 * an `Age` above 10 s, a 503 (after its `Retry-After`), a network error, another status or a body that does not
 * parse is a retry; a 404 `not-a-collection` is final for the page load, and any other 404, a 400 or a build
 * without the server's origin final as unavailable. A `fresh` poll asks past the browser's stored copy
 * (`cache: 'reload'`): the page asks so until its first body, because on a page load a 304 would hand back the
 * copy of the last change, whose block time can be long past, and the chain clock would anchor on it.
 */
export async function pollState(
  base: string | undefined,
  chainId: number,
  address: Address,
  fetchImpl: typeof fetch = fetch,
  options: { fresh?: boolean } = {},
): Promise<StatePoll> {
  const origin = originOf(base)
  if (!origin) return { kind: 'final', reason: 'unavailable' }
  const response = await request(
    `${origin}${statePath(chainId, address)}`,
    fetchImpl,
    options.fresh ? 'reload' : 'no-cache',
  )
  if (!response) return { kind: 'retry', afterMs: 1_000, reason: 'network' }
  if (response.status === 200) {
    let parsed: ReturnType<typeof stateBodySchema.safeParse>
    try {
      parsed = stateBodySchema.safeParse(await response.json())
    } catch {
      return { kind: 'retry', afterMs: 1_000, reason: 'network' }
    }
    if (!parsed.success || parsed.data.chainId !== chainId || !sameAddress(parsed.data.address, address))
      return { kind: 'retry', afterMs: 1_000, reason: 'network' }
    const ageSeconds = ageOf(response)
    if (ageSeconds > UNREACHABLE_AGE_S) return { kind: 'retry', afterMs: 1_000, reason: 'stale' }
    return { kind: 'body', body: parsed.data, ageSeconds }
  }
  if (response.status === 503) {
    const code = await refusalCodeOf(response)
    const reason =
      code === 'not-read-yet' || code === 'chain-unreadable' || code === 'busy' ? code : 'network'
    return { kind: 'retry', afterMs: retryAfterMs(response), reason }
  }
  if (response.status === 404) {
    const code = await refusalCodeOf(response)
    return { kind: 'final', reason: code === 'not-a-collection' ? 'not-a-collection' : 'unavailable' }
  }
  if (response.status === 400) return { kind: 'final', reason: 'unavailable' }
  return { kind: 'retry', afterMs: 1_000, reason: 'network' }
}

/** One poll of a wallet's quotas and vaults, read as the state's is. */
export async function pollWallet(
  base: string | undefined,
  chainId: number,
  address: Address,
  wallet: Address,
  fetchImpl: typeof fetch = fetch,
): Promise<WalletPoll> {
  const origin = originOf(base)
  if (!origin) return { kind: 'final' }
  const response = await request(`${origin}${walletPath(chainId, address, wallet)}`, fetchImpl)
  if (!response) return { kind: 'retry', afterMs: 1_000 }
  if (response.status === 200) {
    let parsed: ReturnType<typeof walletBodySchema.safeParse>
    try {
      parsed = walletBodySchema.safeParse(await response.json())
    } catch {
      return { kind: 'retry', afterMs: 1_000 }
    }
    if (
      !parsed.success ||
      parsed.data.chainId !== chainId ||
      !sameAddress(parsed.data.address, address) ||
      !sameAddress(parsed.data.wallet, wallet) ||
      ageOf(response) > UNREACHABLE_AGE_S
    )
      return { kind: 'retry', afterMs: 1_000 }
    return { kind: 'body', body: parsed.data }
  }
  if (response.status === 503) return { kind: 'retry', afterMs: retryAfterMs(response) }
  if (response.status === 404 || response.status === 400) return { kind: 'final' }
  return { kind: 'retry', afterMs: 1_000 }
}

/** What the page has read: the body it shows, the clock's anchor and how the polls are going. */
export type FreshTrack = {
  body: StateBody | null
  /** The highest block of an accepted body; -1 before the first. */
  highestBlock: number
  /** The chain's time in seconds at `performance.now()` `at`, set by each body with a new block. */
  anchor: { seconds: number; at: number } | null
  /** When the last body was accepted (`performance.now()`). */
  lastGoodAt: number | null
  /** Failed polls since the last accepted body. */
  failures: number
  /** The wait before the next poll after a failure. */
  retryMs: number | null
  /** A refusal that stops the polls for this page load. */
  final: 'not-a-collection' | 'unavailable' | null
}

export const EMPTY_TRACK: FreshTrack = {
  body: null,
  highestBlock: -1,
  anchor: null,
  lastGoodAt: null,
  failures: 0,
  retryMs: null,
  final: null,
}

/**
 * Folds a poll into the track: a body above the highest block replaces the shown one and anchors the clock at its
 * block time plus its `Age`; one at the highest block replaces the shown one (`degraded` may have changed) and
 * keeps the anchor; one below is ignored. A retry adds a failure and doubles its wait up to 8 s; a final stops.
 */
export function foldState(track: FreshTrack, poll: StatePoll, nowMs: number): FreshTrack {
  if (poll.kind === 'final') return { ...track, final: poll.reason, retryMs: null }
  if (poll.kind === 'retry') {
    const failures = track.failures + 1
    return { ...track, failures, retryMs: Math.min(RETRY_MAX_MS, poll.afterMs * 2 ** (failures - 1)) }
  }
  const { body } = poll
  if (body.block < track.highestBlock) return track
  const accepted = { ...track, body, lastGoodAt: nowMs, failures: 0, retryMs: null }
  if (body.block === track.highestBlock) return accepted
  return {
    ...accepted,
    highestBlock: body.block,
    anchor: { seconds: body.blockTimestamp + poll.ageSeconds, at: nowMs },
  }
}

/** The chain's time now by the anchor, in whole seconds; null before the first body. Labels only. */
export function chainNowOf(track: FreshTrack, nowMs: number): number | null {
  if (!track.anchor) return null
  return Math.floor(track.anchor.seconds + (nowMs - track.anchor.at) / 1_000)
}

/**
 * The page's own degraded flag: a body is shown and no answer was accepted for 10 s while the tab was visible.
 * Nothing polls while it is hidden, so the 10 s count from the later of the last accepted answer and
 * `visibleSince`, when the tab last became visible (`performance.now()`).
 */
export function ownDegraded(track: FreshTrack, nowMs: number, visibleSince: number | null = null): boolean {
  if (track.body === null || track.lastGoodAt === null) return false
  return nowMs - Math.max(track.lastGoodAt, visibleSince ?? track.lastGoodAt) >= OWN_DEGRADED_MS
}

/**
 * The page has had no body 10 s after it started reading, while the tab was visible: nothing polls while it is
 * hidden, so a page loaded in a background tab counts from `visibleSince`, its return, rather than from its load.
 */
export function readingLong(
  track: FreshTrack,
  nowMs: number,
  startedAt: number,
  visibleSince: number | null = null,
): boolean {
  if (track.body !== null) return false
  return nowMs - Math.max(startedAt, visibleSince ?? startedAt) >= OWN_DEGRADED_MS
}

/**
 * The wait before the next state poll: none after a final refusal; the retry's after a failure; 1 s with no body
 * yet or while a visible phase is starting or scheduled within 60 s by the chain clock; else 3 s.
 */
export function cadenceMs(
  track: FreshTrack,
  phases: readonly Pick<Phase, 'status' | 'startsIn'>[],
): number | null {
  if (track.final) return null
  if (track.retryMs !== null) return track.retryMs
  if (!track.body) return 1_000
  const soon = phases.some(
    (phase) =>
      phase.status === 'starting' ||
      (phase.status === 'scheduled' && phase.startsIn !== null && phase.startsIn <= 60),
  )
  return soon ? 1_000 : 3_000
}

import { BaseError } from 'viem'
import type { RequestsHealth } from './requests.ts'
import type { Tier } from './tiers.ts'

/**
 * `/health` (docs/specs/2026-10-16-freshness-server.md, section 6.9), pure: what it reports per served chain
 * and for the server, and how a failure is named. It never carries an RPC URL, a key or an error's message.
 */

/** A chain's reader on /health. */
export type ReaderHealth = {
  chainId: number
  name: string
  hot: number
  /**
   * The tier of the chain's read collections, which `degraded` counts from: one not read yet does not count,
   * so a chain with none read is idle. Null while the chain has no hot collection.
   */
  tier: Tier | null
  /** The head the last good tick read; null before one. */
  block: number | null
  /**
   * Seconds since the block time of that head (0 when the chain's clock is ahead); null before a good tick
   * and while the chain has no hot collection.
   */
  lagSeconds: number | null
  /** The last good tick's time (ISO); null before one. */
  lastGoodTickAt: string | null
  failedTicks: number
  /** The last failure's error name, never its message. */
  lastError: string | null
  /** Log scans skipped or failed, whose collections were read in full instead. */
  logGaps: number
  /** Failed ticks and noted factory failures in the last 5 minutes. */
  failedTicksRecent: number
  /**
   * When the chain last turned hot, a collection asked for while it had none (ISO); null while it has no hot
   * collection. A read counts as stale from the later of this and the last good tick.
   */
  hotSince: string | null
}

/** A chain's indexer on /health (docs/specs/2026-10-16-indexer-overview.md, section 6.7). */
export type IndexerHealth = {
  /** The collections with a cursor in this process. */
  collections: number
  /**
   * Those not read to the safe block yet, or last read there more than 300 s of chain time before the head.
   */
  behind: number
  /** The last safe block a pass reached; null before one. */
  block: number | null
  /** When the last pass ended (ISO); null before one. */
  lastPassAt: string | null
  /** Failures: each failed head, scan, block time, write, start or database read counts one. */
  failedPasses: number
  /**
   * The last failure's error name and codes as `failureName` writes them (`IndexerWriteError (PGRST202)`),
   * never its message.
   */
  lastError: string | null
  /** Mints and airdrops that did not pair with their transfers, so are not recorded. */
  unpaired: number
  /** Failures in the last 5 minutes. */
  failedPassesRecent: number
  /** When the last pass without a failure ended (ISO); null before one. */
  lastGoodPassAt: string | null
  /** Since when some collection has been behind, without a pass finding none since (ISO); null while none is. */
  behindSince: string | null
}

/** A chain on /health: its reader's fields, then its indexer's, null while the indexer is off. */
export type ChainHealth = ReaderHealth & { indexer: IndexerHealth | null }

/** A chain's /health entry from its reader and its indexer (null while the indexer is off). */
export function chainHealth(reader: ReaderHealth, indexer: IndexerHealth | null): ChainHealth {
  return { ...reader, indexer }
}

export type HealthBody = {
  status: 'ok' | 'degraded'
  /** One sentence per threshold crossed, which an alert can show; empty while `status` is ok. */
  problems: string[]
  startedAt: string
  hot: number
  chains: ChainHealth[]
  wallet: { windows: number; answered: number; waiting: number }
  /**
   * The origin's answers over the last 60 s by route, which `status` and `problems` do not read
   * (docs/specs/2026-10-18-load-run-contract-review-and-cloudflare.md, section 4.2). It names no address.
   */
  requests: RequestsHealth
}

/**
 * The thresholds /health answers `degraded` past (docs/specs/2026-10-17-production-hardening.md, section 8.2). It
 * stays 200, so Railway's deploy check never refuses a deployment during an RPC outage; a monitor keys on the body:
 * the keyword `"status":"ok"`, and the `problems` in its alert. Per chain:
 * - readerStaleS: with hot collections, no good read for more than 60 s (counted from the later of the last good
 *   read and the moment the chain turned hot, or from the start while there was neither): the chain's RPC is down
 *   or refusing;
 * - readerLagS: with hot collections, the newest block read is more than 120 s old: the node is stuck, or a quiet
 *   chain makes no block;
 * - readerFailures: more than 10 failed reads (ticks and factory reads) in 5 minutes: the RPC is flapping;
 * - indexerStaleS: with the indexer on, no pass without a failure for more than 120 s (from the start while there
 *   was none): the database or the RPC fails every pass;
 * - indexerBehindS: collections behind the safe block for more than 900 s: a backfill too slow, or a stuck one;
 * - indexerFailures: more than 5 failed passes in 5 minutes.
 */
export const HEALTH_LIMITS = {
  readerStaleS: 60,
  readerLagS: 120,
  readerFailures: 10,
  indexerStaleS: 120,
  indexerBehindS: 900,
  indexerFailures: 5,
} as const

/**
 * The start line's sentence while the indexer is off, which /health also answers as its problem on a hosted run
 * (`isHostedRun`), where the indexer must run.
 */
export const INDEXER_OFF = 'The indexer is off: set INDEXER_DATABASE_URL to run it.'

/** Limits of the same names, any numbers: `healthProblems` reads `HEALTH_LIMITS` unless given others. */
export type HealthLimits = { readonly [K in keyof typeof HEALTH_LIMITS]: number }

/** Whole seconds from an ISO time, or from the start while there is none, to `now`. */
const secondsSince = (iso: string | null, startedAt: number, now: number) =>
  Math.floor((now - (iso === null ? startedAt : Date.parse(iso))) / 1_000)

/** The later of two ISO times, either of which may be missing; null when both are. */
const laterOf = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null || Date.parse(a) >= Date.parse(b) ? a : b

/**
 * One sentence per threshold crossed, per chain, in the order of `HEALTH_LIMITS`. A chain with no hot collection
 * has no reader problem but its failures; an indexer that is off has none of its own.
 */
export function healthProblems(
  chains: readonly ChainHealth[],
  now: number,
  startedAt: number,
  limits: HealthLimits = HEALTH_LIMITS,
): string[] {
  return chains.flatMap((chain) => {
    const problems: string[] = []
    if (chain.hot > 0) {
      const stale = secondsSince(laterOf(chain.lastGoodTickAt, chain.hotSince), startedAt, now)
      if (stale > limits.readerStaleS)
        problems.push(`${chain.name}: no good read for ${stale} s (limit ${limits.readerStaleS} s).`)
      if (chain.lagSeconds !== null && chain.lagSeconds > limits.readerLagS)
        problems.push(
          `${chain.name}: the newest block is ${chain.lagSeconds} s old (limit ${limits.readerLagS} s).`,
        )
    }
    if (chain.failedTicksRecent > limits.readerFailures)
      problems.push(
        `${chain.name}: ${chain.failedTicksRecent} failed reads in 5 minutes (limit ${limits.readerFailures}).`,
      )
    const indexer = chain.indexer
    if (indexer) {
      const stale = secondsSince(indexer.lastGoodPassAt, startedAt, now)
      if (stale > limits.indexerStaleS)
        problems.push(`${chain.name}: no good index pass for ${stale} s (limit ${limits.indexerStaleS} s).`)
      if (indexer.behindSince !== null && indexer.behind > 0) {
        const behind = secondsSince(indexer.behindSince, startedAt, now)
        const collections = indexer.behind === 1 ? 'collection' : 'collections'
        if (behind > limits.indexerBehindS)
          problems.push(
            `${chain.name}: ${indexer.behind} ${collections} behind for ${behind} s (limit ${limits.indexerBehindS} s).`,
          )
      }
      if (indexer.failedPassesRecent > limits.indexerFailures)
        problems.push(
          `${chain.name}: ${indexer.failedPassesRecent} failed index passes in 5 minutes (limit ${limits.indexerFailures}).`,
        )
    }
    return problems
  })
}

/** How many causes deep the log line looks, so a cause that refers back to itself cannot loop. */
const CAUSE_DEPTH = 10

/** The innermost viem error, where viem wraps one in another. */
function innermost(error: unknown): unknown {
  let current = error
  for (let depth = 0; depth < CAUSE_DEPTH; depth++) {
    if (!(current instanceof BaseError && current.cause instanceof BaseError)) break
    current = current.cause
  }
  return current
}

/** A failure's name as /health reports it: the innermost viem error's (HttpRequestError, for example). */
export function errorName(error: unknown): string {
  const inner = innermost(error)
  return inner instanceof Error ? inner.name : 'Error'
}

/** The first whole-number `code` on the error's chain of causes, outermost first: a JSON-RPC error's. */
function codeOf(error: unknown): number | undefined {
  let current: unknown = error
  for (let depth = 0; depth < CAUSE_DEPTH && current instanceof Error; depth++) {
    if ('code' in current && typeof current.code === 'number' && Number.isInteger(current.code))
      return current.code
    current = current.cause
  }
  return undefined
}

/** The innermost viem error's name with the first whole-number code on the chain of causes, if any. */
function namedOf(error: unknown): string {
  const code = codeOf(error)
  return code === undefined ? errorName(error) : `${errorName(error)} (${code})`
}

/**
 * The error's own code in parentheses where it is capitals, digits and underscores (` (ERR_INVALID_URL)`, a
 * Postgres code, `HTTP_401`), else nothing: such a code carries no URL, key or message.
 */
function ownCodeOf(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code) ? ` (${code})` : ''
}

/**
 * A failure as the log writes it: the innermost viem error's name, the first whole-number code on its chain
 * of causes (a JSON-RPC error's, as `RpcRequestError (-32005)`) and viem's short message, or the name and
 * code alone for anything else. Never a full message: viem's carries the request's URL, and an RPC URL
 * carries the provider's key.
 */
export function errorLine(error: unknown): string {
  const inner = innermost(error)
  return inner instanceof BaseError ? `${namedOf(error)}: ${inner.shortMessage}` : namedOf(error)
}

/**
 * An unexpected failure as the log writes it: `errorLine`, which carries a whole-number code, then the
 * error's own code where it is capitals, digits and underscores, as `TypeError (ERR_INVALID_URL)`. Never a
 * message.
 */
export function failureLine(error: unknown): string {
  return `${errorLine(error)}${ownCodeOf(error)}`
}

/**
 * A failure's name and codes as `failureLine` writes them, without viem's short message: what /health's
 * indexer reports as its last error, as `IndexerWriteError (PGRST202)` or `RpcRequestError (-32005)`.
 */
export function failureName(error: unknown): string {
  return `${namedOf(error)}${ownCodeOf(error)}`
}

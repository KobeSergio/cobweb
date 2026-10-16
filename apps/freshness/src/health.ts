import { BaseError } from 'viem'
import type { Tier } from './tiers.ts'

/**
 * `/health` (docs/specs/2026-10-16-freshness-server.md, section 6.9), pure: what it reports per served chain
 * and for the server, and how a failure is named. It never carries an RPC URL or an error's message.
 */

export type ChainHealth = {
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
}

export type HealthBody = {
  status: 'ok'
  startedAt: string
  hot: number
  chains: ChainHealth[]
  wallet: { windows: number; answered: number; waiting: number }
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

/**
 * A failure as the log writes it: the innermost viem error's name, the first whole-number code on its chain
 * of causes (a JSON-RPC error's, as `RpcRequestError (-32005)`) and viem's short message, or the name and
 * code alone for anything else. Never a full message: viem's carries the request's URL, and an RPC URL
 * carries the provider's key.
 */
export function errorLine(error: unknown): string {
  const inner = innermost(error)
  const code = codeOf(error)
  const named = code === undefined ? errorName(error) : `${errorName(error)} (${code})`
  return inner instanceof BaseError ? `${named}: ${inner.shortMessage}` : named
}

/**
 * An unexpected failure as the log writes it: `errorLine`, which carries a whole-number code, then the
 * error's own code where it is capitals, digits and underscores, as `TypeError (ERR_INVALID_URL)`. Never a
 * message.
 */
export function failureLine(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : undefined
  return typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
    ? `${errorLine(error)} (${code})`
    : errorLine(error)
}

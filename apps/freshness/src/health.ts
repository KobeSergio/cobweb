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
  /** Null while the chain has no hot collection. */
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

/** The innermost viem error, where viem wraps one in another. */
function innermost(error: unknown): unknown {
  let current = error
  while (current instanceof BaseError && current.cause instanceof BaseError) current = current.cause
  return current
}

/** A failure's name as /health reports it: the innermost viem error's (HttpRequestError, for example). */
export function errorName(error: unknown): string {
  const inner = innermost(error)
  return inner instanceof Error ? inner.name : 'Error'
}

/**
 * A failure as the log writes it: the innermost viem error's name and short message, or a name alone for
 * anything else. Never a full message: viem's carries the request's URL, and an RPC URL carries the
 * provider's key.
 */
export function errorLine(error: unknown): string {
  const inner = innermost(error)
  return inner instanceof BaseError ? `${inner.name}: ${inner.shortMessage}` : errorName(error)
}

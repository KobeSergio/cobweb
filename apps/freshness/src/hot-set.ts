import { getAddress, type Address } from 'viem'
import type { CollectionRead } from './chain-reader.ts'

/**
 * The hot set (docs/specs/2026-10-16-freshness-server.md, section 6.3): the collections mint pages asked for
 * in the last 10 minutes, per chain, each with its last read. Pure: every time is passed in, in milliseconds.
 */

/** An entry leaves after 10 minutes without a request. */
export const HOT_TTL_MS = 600_000
/** A request for an entry without a read waits up to 2 s after the join for its first read. */
export const JOIN_WAIT_MS = 2_000

export type HotEntry = {
  chainId: number
  /** Checksummed. */
  address: Address
  /** When the entry joined, for the join wait. */
  joinedAt: number
  /** The last state request. */
  requestedAt: number
  /** The last successful read, or null before the first. */
  read: CollectionRead | null
  /** When the last read landed, or was counted at an unchanged head; null before the first. */
  readAt: number | null
  /** When the extras were last read; null before the first. */
  extrasReadAt: number | null
  /**
   * To read in full (the state and the extras) at the next tick: a new entry, one a log named, or one read in
   * full at a head below the scanned block.
   */
  marked: boolean
}

const keyOf = (chainId: number, address: Address) => `${chainId}:${address.toLowerCase()}`

/** The hot set, keyed by the chain and the lowercase address. */
export function hotSet(): {
  join(chainId: number, address: Address, now: number): { entry: HotEntry; joined: boolean }
  onChain(chainId: number): HotEntry[]
  expire(now: number): HotEntry[]
  size(chainId?: number): number
} {
  const entries = new Map<string, HotEntry>()
  const onChain = (chainId: number) => [...entries.values()].filter((entry) => entry.chainId === chainId)
  return {
    join(chainId, address, now) {
      const key = keyOf(chainId, address)
      const known = entries.get(key)
      if (known) {
        known.requestedAt = now
        return { entry: known, joined: false }
      }
      const entry: HotEntry = {
        chainId,
        address: getAddress(address),
        joinedAt: now,
        requestedAt: now,
        read: null,
        readAt: null,
        extrasReadAt: null,
        marked: true,
      }
      entries.set(key, entry)
      return { entry, joined: true }
    },
    onChain,
    expire(now) {
      const gone: HotEntry[] = []
      for (const [key, entry] of entries)
        if (now - entry.requestedAt >= HOT_TTL_MS) {
          entries.delete(key)
          gone.push(entry)
        }
      return gone
    },
    size(chainId) {
      return chainId === undefined ? entries.size : onChain(chainId).length
    },
  }
}

export type HotSet = ReturnType<typeof hotSet>

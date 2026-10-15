import type { Address, Hex } from 'viem'
import type { MintGroup } from '@/lib/demo/types'

/**
 * The shapes the Whitelist tab moves between the database, the server and the screen
 * (docs/specs/2026-10-15-whitelist.md, section 6.1). Types only, so the browser imports them without the
 * server module (whitelist-core.ts).
 */

/** One address on a group's list: the creator's quota and what the chain was last proven to hold. */
export type ListEntry = {
  /** Checksummed. */
  address: Address
  /** 1 to 10,000, or 0 for a removal staged on a written address. */
  quota: number
  /** The quota the last proven chunk carrying the address wrote, or null while none has. */
  writtenQuota: number | null
  /** That chunk's transaction (lowercase), or null. */
  writtenTx: Hex | null
}

/** A chunk on chain, counted by the entries that still name its transaction. */
export type WrittenChunk = {
  txHash: Hex
  addresses: number
  /** When the server recorded it, in Unix milliseconds, so chunks recorded in the same second keep their order. */
  writtenAt: number
}

/** One whitelist group's list and its counts. */
export type GroupList = {
  onchainId: number
  /** In lowercase address order. */
  entries: ListEntry[]
  /** Entries above 0. */
  total: number
  /** Entries whose written quota equals their quota. */
  written: number
  /** The rest, staged removals included. */
  unwritten: number
  /** The sum of the quotas. */
  totalQuota: number
  /** The group's minted count from the chain (each whitelist mint claims one quota); 0 when the chain did not answer. */
  quotaUsed: number
  /** In the order they were written. */
  chunks: WrittenChunk[]
}

/** What the Whitelist tab shows: the phases view's whitelist groups and a list per named group. */
export type WhitelistView = {
  chainId: number
  contract: Address
  /** The whitelist groups (id 1 and up), in the phases view's order. */
  groups: MintGroup[]
  /** One per whitelist group Cobweb has a row for. */
  lists: GroupList[]
  chunkSize: 500
  /** The chain's time at the read, for relative labels only. */
  blockTimestamp: number
  readAt: number
  /** False: the groups are the copy; quota used and minted counts are unknown and chunks wait. */
  chainReachable: boolean
}

/** One address and quota as an add sends it or a chunk carries it. */
export type ChunkEntry = { address: Address; quota: number }

/** The next chunk the server built: chunk `number` of `of`, its entries in address order, a removal sending 0. */
export type ChunkPlan = { onchainId: number; number: number; of: number; entries: ChunkEntry[] }

/** A chunk this browser sent and the server has not confirmed yet. */
export type SentChunk = { hash: Hex; onchainId: number }

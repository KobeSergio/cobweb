import type { ChainState } from '@cobweb/shared'
import type { Address } from 'viem'
import type { MintGroup } from '@/lib/demo/types'
import type { ExpectedEvent } from './phase-calls'

/**
 * The shapes Phases moves between the chain, the database, the server and the screens
 * (docs/specs/2026-10-15-phases.md, section 6). Types only, so the browser imports them without the
 * server module (phases-core.ts).
 */

/**
 * `collectionState()` as the screens read it: the shapes live in the shared package with their mapping
 * (docs/specs/2026-10-16-freshness-server.md, section 5.1), re-exported so the screens keep their imports.
 */
export type { ChainGroup, ChainState } from '@cobweb/shared'

/** At the latest block, or at `atLeast` when the node is behind it; null when the chain, its RPC or the contract does not answer. */
export type StateReader = (chainId: number, address: Address, atLeast?: bigint) => Promise<ChainState | null>

/** What Phases and the Overview show: the contract's groups joined with what Cobweb keeps (section 6.2). */
export type PhasesView = {
  chainId: number
  contract: Address
  /** In the creator's order; groups the chain lists without a row follow by id, as "Group N". */
  groups: MintGroup[]
  publicMaxPerWallet: number
  totalMinted: number
  maxSupply: number
  /** The chain's time at the read, for relative labels only (never liveness). */
  blockTimestamp: number
  /** The read's block time, or the copy's `state_read_at` when the chain did not answer. */
  readAt: number
  /** False: the groups are the copy, and minted counts and status are unknown. */
  chainReachable: boolean
}

/** What Cobweb records for a phase Add phase registers, once its receipt proves the registration. */
export type PhaseAdd = { onchainId: number; name: string; description: string; visible: boolean }

/** What a confirm must find in the receipt, and the add's row to write when it does. */
export type PhaseTxExpected = { event: ExpectedEvent; add?: PhaseAdd }

/** A `mint_groups` row as the view reads it: numeric columns as text, so no wei is lost. */
export type PhaseRowCopy = {
  onchain_id: number
  name: string
  description: string
  visible: boolean
  /** Null only inside a move. */
  position: number | null
  price_wei: string
  max_supply: number
  start_at: string | null
}

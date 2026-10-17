import type { RevealPointer, RevealTargets, TransferLevelState } from '@cobweb/shared'
import type { Address } from 'viem'
import type { PreparedArgs } from '@/lib/deploy/deploy-types'
import type { FeeSnapshot } from '@/lib/demo/types'
import type { ChainState } from './phases-types'

/**
 * The shapes Settings moves between the chain, the database, the server and the screens
 * (docs/specs/2026-10-15-airdrop-settings.md, section 6.1). Types only, so the browser imports them without the
 * server module (settings-core.ts).
 */

/**
 * The transfer level and what the base URI points at: the shapes live in the shared package with `levelOf`
 * and `pointerOf` (docs/specs/2026-10-16-freshness-server.md, section 5.1), re-exported so the screens keep
 * their imports.
 */
export type { RevealPointer, RevealTargets, TransferLevelState } from '@cobweb/shared'

/** What Settings and the Overview show: the contract's settings and balances from one read, or Cobweb's copies. */
export type SettingsView = {
  chainId: number
  contract: Address
  /** The contract's `owner()`; null while the chain does not answer. */
  owner: Address | null
  /** `creatorBalance()`, wei as a decimal string; null while the chain does not answer. */
  creatorBalanceWei: string | null
  /** `platformBalance()`; null while the chain does not answer. */
  platformBalanceWei: string | null
  /** `pendingBalance(wallet)` for the session wallet; null while the chain does not answer. */
  pendingBalanceWei: string | null
  /** The sum of the recorded withdrawals: those Cobweb confirmed and those the indexer read. */
  withdrawnWei: string
  /** `fees()`; null while the chain does not answer. */
  fees: FeeSnapshot | null
  payout: Address
  royaltyBps: number
  royaltyReceiver: Address
  baseUri: string
  /** `getTransferValidator()`, or its copy; null until the first read. The zero address is no validator. */
  transferValidator: Address | null
  mintOnBehalf: boolean
  /** Null while the chain does not answer. */
  level: TransferLevelState | null
  targets: RevealTargets
  pointer: RevealPointer
  /** Whether a real job is done, so Reveal has something to point at. */
  realArtRendered: boolean
  /** The chain's time at the read, for relative labels only. */
  blockTimestamp: number
  readAt: number
  /** False: the settings are Cobweb's copies, and the balances, fees and level are not read. */
  chainReachable: boolean
}

/** One server read of the contract for Settings, at one block. */
export type SettingsState = {
  block: bigint
  blockTimestamp: number
  /** `collectionState()`, which also refreshes the phase copies. */
  chain: ChainState
  creatorBalanceWei: string
  platformBalanceWei: string
  pendingBalanceWei: string
  payout: Address
  royaltyBps: number
  royaltyReceiver: Address
  baseUri: string
  validator: Address
  owner: Address
  fees: FeeSnapshot
  level: TransferLevelState
}

/** At the latest block, or at `atLeast` when the node is behind it; null when the chain, its RPC or the contract does not answer. */
export type SettingsReader = (
  chainId: number,
  address: Address,
  wallet: Address,
  atLeast?: bigint,
) => Promise<SettingsState | null>

/** A `withdrawals` row as Settings reads it: the amount as text, so no wei is lost, and its block. */
export type WithdrawalRow = { amount_wei: string; block: number }

/** The deployments copies Settings shows while the chain does not answer, and the deploy-time arguments. */
export type SettingsCopyRow = {
  payout_address: string
  royalty_bps: number
  royalty_receiver: string
  base_uri: string
  transfer_validator: string | null
  mint_on_behalf: boolean
  args: PreparedArgs
}

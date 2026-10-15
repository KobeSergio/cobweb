import type { ChainState, TransferLevelState } from '@cobweb/shared'
import type { Address } from 'viem'

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

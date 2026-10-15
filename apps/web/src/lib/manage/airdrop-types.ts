import type { Address, Hex } from 'viem'

/**
 * The shapes Airdrop moves between the chain, the database, the server and the screen
 * (docs/specs/2026-10-15-airdrop-settings.md, section 6.1). Types only, so the browser imports them without the
 * server module (airdrop-core.ts).
 */

/** Tokens sent to wallets, or a burn: tokens minted to the dead address. */
export type AirdropKind = 'airdrop' | 'burn'

/** One transaction Cobweb proved and recorded, as History shows it. */
export type AirdropRow = {
  txHash: Hex
  kind: AirdropKind
  recipients: number
  tokens: number
  /** The fee the transaction paid, wei as a decimal string. */
  feePaidWei: string
  firstTokenId: number
  lastTokenId: number
  block: number
  /** When Cobweb recorded it (Unix seconds): later than its block when "Check again" came late. */
  confirmedAt: number
}

/** What the Airdrop tab shows: the contract's fee, supply and owner from one read, and Cobweb's records. */
export type AirdropView = {
  chainId: number
  contract: Address
  /** The contract's `owner()`; null while the chain does not answer. */
  owner: Address | null
  /** The contract's airdrop fee per token, wei as a decimal string; null while the chain does not answer. */
  feePerTokenWei: string | null
  maxSupply: number
  /** Null while the chain does not answer. */
  totalMinted: number | null
  /** `maxSupply - totalMinted`, never below 0; null while the chain does not answer. */
  left: number | null
  /** Newest first. */
  history: AirdropRow[]
  /** The chain's time at the read, for relative labels only. */
  blockTimestamp: number
  readAt: number
  /** False: the history is Cobweb's record, and the fee, minted and left are not read. */
  chainReachable: boolean
}

/** One recipient of a batch: a checksummed address and its tokens (1 to 1,000). */
export type BatchEntry = { address: Address; amount: number }

/**
 * A list frozen at the first send, kept in the browser: its batches in the list's order, how many landed, and
 * the hash of the batch sent but not confirmed yet. A burn is one batch of one entry to the dead address, kept
 * only while its hash is pending.
 */
export type AirdropJob = { kind: AirdropKind; batches: BatchEntry[][]; sent: number; pending: Hex | null }

/** One server read of the contract for the Airdrop tab, at one block. */
export type AirdropState = {
  block: bigint
  blockTimestamp: number
  maxSupply: number
  totalMinted: number
  feePerTokenWei: string
  owner: Address
}

/** At the latest block, or at `atLeast` when the node is behind it; null when the chain, its RPC or the contract does not answer. */
export type AirdropReader = (
  chainId: number,
  address: Address,
  atLeast?: bigint,
) => Promise<AirdropState | null>

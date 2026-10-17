import type { Address, Hex } from 'viem'

/**
 * The shapes Airdrop moves between the chain, the database, the server and the screen
 * (docs/specs/2026-10-15-airdrop-settings.md, section 6.1; docs/specs/2026-10-16-indexer-overview.md, section 7.3).
 * Types and By recipient's page size only, so the browser imports them without the server module (airdrop-core.ts).
 */

/** Tokens sent to wallets, or a burn: tokens minted to the dead address. */
export type AirdropKind = 'airdrop' | 'burn'

/** One airdropNFTs transaction, proven by Cobweb or read by the indexer, as History shows it. */
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
  /**
   * When it happened (Unix seconds): its block's time once the indexer has read it, else the time Cobweb recorded
   * it, which is later than its block when "Check again" came late.
   */
  confirmedAt: number
}

/**
 * What the Airdrop tab shows: the contract's fee, supply and owner from one read, and the collection's
 * airdrops, Cobweb's and the indexer's.
 */
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
  /**
   * False: the chain did not answer, so the history is the records alone, and the fee, minted and left are
   * not read.
   */
  chainReachable: boolean
  /**
   * The indexer has read every block since the deploy, so the history lists the airdrops sent from outside Cobweb
   * too, and By recipient every wallet an airdrop reached.
   */
  counted: boolean
  /**
   * The chain's time at the indexer's last read to the confirmation depth (Unix seconds), no earlier than any
   * airdrop it recorded; null before it has read every block since the deploy. Relative labels count from the
   * later of this and `readAt`.
   */
  countedAt: number | null
}

/** One run of an airdrop to one wallet, as By recipient shows it. */
export type RecipientRow = {
  txHash: Hex
  /** Checksummed. */
  wallet: Address
  tokens: number
  firstTokenId: number
  lastTokenId: number
  /** The block's time (Unix seconds). */
  at: number
  /** Minted to the dead address. */
  burn: boolean
}

/** One page of By recipient: its rows, how many match in all, and which page it is (from 0). */
export type RecipientPage = { rows: RecipientRow[]; total: number; page: number }

/** The rows of one page of By recipient. */
export const RECIPIENTS_PAGE = 25

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

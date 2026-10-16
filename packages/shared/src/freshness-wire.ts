import type { Address } from 'viem'
import type { ChainGroup } from './collection-state.ts'

/**
 * What the freshness server answers and where (docs/specs/2026-10-16-freshness-server.md, sections 6.7 and
 * 6.8), shared by the server, which writes these bodies, and the mint page, which polls them
 * (docs/specs/2026-10-16-mint-page-live-data.md, section 5). Types and two path builders; no ABI.
 */

/**
 * The state endpoint's body. Liveness is each group's `active`, the contract's own; the times only label
 * countdowns.
 */
export type StateBody = {
  chainId: number
  /** Checksummed. */
  address: Address
  /** The block of the last read; it never goes back. */
  block: number
  blockTimestamp: number
  /** Unix seconds of the last successful read, on the server's clock. */
  readAt: number
  degraded: boolean
  maxSupply: number
  totalMinted: number
  publicMaxMintPerWallet: number
  mintFeeFlatWei: string
  mintFeeBps: number
  airdropFeePerTokenWei: string
  mintOnBehalfActive: boolean
  /** In the contract's order. */
  groups: ChainGroup[]
  owner: Address
  royalty: { receiver: Address; bps: number }
  baseUri: string
  transferValidator: Address
  transferLevel: 'none' | 'unread' | number
}

/** One registered group of `walletState`: the quota issued and claimed, both 0 for the public group. */
export type QuotaBody = { id: number; quota: number; claimed: number }

/**
 * The wallet endpoint's body: a wallet's quotas in a collection, and those of up to 10 vaults that delegate
 * to it.
 */
export type WalletBody = {
  chainId: number
  /** The collection, checksummed. */
  address: Address
  /** Checksummed. */
  wallet: Address
  /** The block the window read at. */
  block: number
  publicMinted: number
  groups: QuotaBody[]
  vaults: { vault: Address; publicMinted: number; groups: QuotaBody[] }[]
}

/** What a refusal's `{ "error": "<code>" }` names. */
export type RefusalCode =
  | 'bad-request'
  | 'not-found'
  | 'chain-not-served'
  | 'not-a-collection'
  | 'method-not-allowed'
  | 'chain-unreadable'
  | 'not-read-yet'
  | 'wallet-unreadable'
  | 'busy'
  | 'internal'

/** `/v1/state/<chain id>/<collection>`, the address in lowercase: one edge entry per collection. */
export function statePath(chainId: number, address: Address): string {
  return `/v1/state/${chainId}/${address.toLowerCase()}`
}

/** `/v1/wallet/<chain id>/<collection>/<wallet>`, both addresses in lowercase. */
export function walletPath(chainId: number, address: Address, wallet: Address): string {
  return `/v1/wallet/${chainId}/${address.toLowerCase()}/${wallet.toLowerCase()}`
}

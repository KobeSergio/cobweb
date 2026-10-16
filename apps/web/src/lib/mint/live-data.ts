import type { StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import type { FeeSnapshot, MintGroup, WalletState } from '@/lib/demo/types'
import { joinPhases } from '@/lib/manage/phases-view'
import type { MintPageStatic } from './page-doc'

/**
 * The chain's state as the mint page reads it (docs/specs/2026-10-16-mint-page-live-data.md, section 7.4), pure:
 * the freshness server's state body joined with the document's phases, the reveal and the transfer rows; the
 * wallet answer as allowances; and the mints this page saw land. Liveness is each group's `active`.
 */
export type MintLive = {
  block: number
  blockTimestamp: number
  /** When the server read the chain (its clock), for the degraded banner's minutes. */
  readAt: number
  degraded: boolean
  supply: { max: number; minted: number }
  publicMaxMintPerWallet: number
  fees: FeeSnapshot
  /** The chain's groups with their names, in the creator's order; groups registered outside Cobweb after them. */
  groups: MintGroup[]
  /** The contract's owner. */
  creator: Address
  royaltyBps: number
  baseUri: string
  /** The base URI is set and is not one of the placeholders. */
  revealed: boolean
  mintOnBehalfActive: boolean
  /** Null when the collection has no validator level to show. */
  transfers: 'open' | 'locked' | 'restricted' | null
  /** Royalties are enforced through the transfer validator: level 0 only. */
  royaltyEnforced: boolean
}

/** A wallet's answer as allowances, with the block it was read at. */
export type WalletView = WalletState & { block: number }

/**
 * A mint this page saw land: its group, who holds the allowance it used (the vault, else the wallet), how many and
 * the receipt's block. Supply counts add it while the state is older than its block, allowances while the wallet
 * answer is, so a later answer that includes it never counts it twice.
 */
export type LocalMint = { groupId: number; holder: Address; count: number; block: number }

/** Revealed: the base URI is neither empty nor a placeholder; a custom link reads revealed. */
export function revealedOf(baseUri: string, placeholders: readonly string[]): boolean {
  return baseUri !== '' && !placeholders.includes(baseUri)
}

/** The Transfers row: locked at level 9, open at 0 and 1, restricted at any other level, and none to show otherwise. */
export function transfersOf(level: StateBody['transferLevel']): MintLive['transfers'] {
  if (level === 'none' || level === 'unread') return null
  if (level === 9) return 'locked'
  return level === 0 || level === 1 ? 'open' : 'restricted'
}

/** The page's view of a state body. */
export function liveOf(page: MintPageStatic, body: StateBody): MintLive {
  return {
    block: body.block,
    blockTimestamp: body.blockTimestamp,
    readAt: body.readAt,
    degraded: body.degraded,
    supply: { max: body.maxSupply, minted: body.totalMinted },
    publicMaxMintPerWallet: body.publicMaxMintPerWallet,
    fees: {
      mintFeeFlatWei: body.mintFeeFlatWei,
      mintFeeBps: body.mintFeeBps,
      airdropFeePerTokenWei: body.airdropFeePerTokenWei,
    },
    groups: joinPhases(body, page.phases),
    creator: body.owner,
    royaltyBps: body.royalty.bps,
    baseUri: body.baseUri,
    revealed: revealedOf(body.baseUri, page.placeholders),
    mintOnBehalfActive: body.mintOnBehalfActive,
    transfers: transfersOf(body.transferLevel),
    royaltyEnforced: body.transferLevel === 0,
  }
}

/**
 * A wallet answer as allowances: each group's quota and what it used, a whitelist group eligible when its quota
 * is above 0 (the public group always), and each vault's whitelist groups with a quota above 0; the model works
 * out what is left. A vault with no such group is left off.
 */
export function walletViewOf(body: WalletBody): WalletView {
  return {
    address: body.wallet,
    publicMinted: body.publicMinted,
    groups: body.groups.map((group) => ({
      groupId: group.id,
      quota: group.quota,
      used: group.claimed,
      eligible: group.id === 0 || group.quota > 0,
    })),
    delegatedVaults: body.vaults.flatMap((vault) => {
      const groups = vault.groups
        .filter((group) => group.id !== 0 && group.quota > 0)
        .map((group) => ({ groupId: group.id, quota: group.quota, used: group.claimed }))
      return groups.length ? [{ vault: vault.vault, groups }] : []
    }),
    block: body.block,
  }
}

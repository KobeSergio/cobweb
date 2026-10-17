import type { MintBody, StateActivity, StateBody, WalletBody } from '@cobweb/shared'
import type { Address } from 'viem'
import type { FeeSnapshot, MintGroup, WalletState } from '@/lib/demo/types'
import { joinPhases } from '@/lib/manage/phases-view'
import type { MintPageStatic } from './page-doc'

/** The most mints the page's Recent mints shows (the Overview's shows 12, its own `RECENT_MINTS_SHOWN`). */
const PAGE_RECENT_MINTS = 10

/** The indexer's activity as the page shows it: each mint with its phase's name, null for a hidden phase. */
export type MintActivity = { holders: number; recentMints: (MintBody & { phase: string | null })[] }

/**
 * The chain's state as the mint page reads it (docs/specs/2026-10-16-mint-page-live-data.md, section 7.4), pure:
 * the freshness server's state body joined with the document's phases, the reveal and the transfer rows, the
 * indexer's holders and latest mints (docs/specs/2026-10-16-indexer-overview.md, section 7.5); the wallet answer
 * as allowances; and the mints this page saw land. Liveness is each group's `active`.
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
  /** The holders and the latest mints; null while the indexer has none to give (the page then shows neither). */
  activity: MintActivity | null
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

/**
 * The body's activity as the page shows it: each mint's phase as the phase list names it ("Group N" for a group
 * registered outside Cobweb), null for a hidden phase, at most 10 mints.
 */
export function activityOfBody(
  activity: StateActivity | null,
  groups: readonly MintGroup[],
): MintActivity | null {
  if (!activity) return null
  return {
    holders: activity.holders,
    recentMints: activity.recentMints.slice(0, PAGE_RECENT_MINTS).map((mint) => {
      const group = groups.find((entry) => entry.id === mint.groupId)
      const phase = !group ? `Group ${mint.groupId}` : group.visible === false ? null : group.name
      return { ...mint, phase }
    }),
  }
}

/** The page's view of a state body. */
export function liveOf(page: MintPageStatic, body: StateBody): MintLive {
  const groups = joinPhases(body, page.phases)
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
    groups,
    creator: body.owner,
    royaltyBps: body.royalty.bps,
    baseUri: body.baseUri,
    revealed: revealedOf(body.baseUri, page.placeholders),
    mintOnBehalfActive: body.mintOnBehalfActive,
    transfers: transfersOf(body.transferLevel),
    royaltyEnforced: body.transferLevel === 0,
    activity: activityOfBody(body.activity, groups),
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

import 'server-only'
import {
  DEMO_COLLECTION,
  DEMO_CREATOR,
  DEMO_DEPLOYMENT,
  DEMO_TOKENS,
  MINT_PAGE_VARIANTS,
  getMintPageData,
  tokenLayerUrls,
  type MintPageData,
  type MintPageVariant,
  type WalletState,
} from '@/lib/demo'
import { RESERVED_SLUGS } from '@/lib/collections'
import type { MintFailureKind, MintPageProps } from '@/components/mint/types'

/*
 * The sample-mode data source for the mint page. Phase 6 replaces it with the freshness server's
 * collection endpoint. Query parameters pick what to show, so every state can be reviewed:
 *
 *   ?state=upcoming | allowlist-live | public-live | sold-out | closed   (default allowlist-live)
 *   ?wallet=connected     a sample wallet, connected without a real wallet
 *   ?wallet=not-listed    connected, but on no whitelist and with no vaults
 *   ?wallet=limit         connected, every allowance used
 *   ?wallet=wrong-chain   connected on another network
 *   ?fail=rejected | phase-closed | quota-exceeded | insufficient-balance | reverted
 *                         the first mint attempt fails this way; "Try again" then succeeds
 *   ?degraded=1           the freshness server could not read the chain recently
 *   ?start=<seconds>      move the next scheduled start this close, to watch a countdown reach zero
 */

type Query = Record<string, string | string[] | undefined>

const FAILURES: MintFailureKind[] = [
  'rejected',
  'phase-closed',
  'quota-exceeded',
  'insufficient-balance',
  'reverted',
]

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)

/**
 * In sample mode every creator's mint page link shows the sample collection, so "View mint page"
 * in Manage drop leads somewhere. Reserved words and malformed slugs are still not found.
 */
export function hasSampleCollection(slug: string): boolean {
  if (slug === DEMO_COLLECTION.slug) return true
  return (
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) && !RESERVED_SLUGS.includes(slug) && !slug.startsWith('no-such')
  )
}

export function sampleVariant(query: Query): MintPageVariant {
  const state = one(query.state)
  return MINT_PAGE_VARIANTS.find((variant) => variant === state) ?? 'allowlist-live'
}

function notListed(wallet: WalletState): WalletState {
  return {
    ...wallet,
    groups: wallet.groups.map((entry) =>
      entry.groupId === 0 ? entry : { ...entry, quota: 0, used: 0, eligible: false },
    ),
    delegatedVaults: [],
  }
}

function limitReached(wallet: WalletState, data: MintPageData): WalletState {
  return {
    ...wallet,
    publicMinted: data.publicMaxMintPerWallet,
    groups: wallet.groups.map((entry) => ({ ...entry, used: entry.quota })),
    delegatedVaults: wallet.delegatedVaults.map((vault) => ({
      ...vault,
      groups: vault.groups.map((entry) => ({ ...entry, used: entry.quota })),
    })),
  }
}

export function sampleMintPage(slug: string, query: Query): MintPageProps {
  const variant = sampleVariant(query)
  const data = getMintPageData(slug, variant)
  const mode = one(query.wallet)

  const start = Number(one(query.start))
  if (Number.isFinite(start) && start > 0) {
    const next = data.groups
      .filter((group) => !group.active && group.scheduledStart > data.blockTimestamp)
      .sort((a, b) => a.scheduledStart - b.scheduledStart)[0]
    if (next) {
      data.groups = data.groups.map((group) =>
        group.id === next.id ? { ...group, scheduledStart: data.blockTimestamp + Math.floor(start) } : group,
      )
    }
  }

  let wallet = data.wallet!
  if (mode === 'not-listed') wallet = notListed(wallet)
  if (mode === 'limit') wallet = limitReached(wallet, data)
  const forced = mode === 'connected' || mode === 'not-listed' || mode === 'limit' || mode === 'wrong-chain'

  const failure = one(query.fail)
  const firstNext = data.supply.minted + 1
  const tokenPreviews = DEMO_TOKENS.filter((token) => token.id >= firstNext && token.id < firstNext + 12).map(
    (token) => ({ id: token.id, layers: tokenLayerUrls(token.dna) }),
  )

  return {
    // The page decides what is connected; the data carries no wallet of its own.
    data: { ...data, wallet: null },
    extras: {
      creator: DEMO_CREATOR,
      royaltyBps: DEMO_DEPLOYMENT.royaltyBps,
      degraded: one(query.degraded) === '1',
      tokenPreviews,
    },
    sampleWallet: wallet,
    sample: {
      forcedWallet: forced ? wallet : null,
      wrongChain: mode === 'wrong-chain',
      failure: FAILURES.find((kind) => kind === failure) ?? null,
    },
  }
}

import { formatNative } from '@/lib/demo/helpers'
import type { Address, MintGroup } from '@/lib/demo/types'
import { sameAddress } from '@/lib/mint/fresh-client'
import type { LocalMint, MintLive, WalletView } from '@/lib/mint/live-data'
import { quoteOf, type MintParams, type Quote } from '@/lib/mint/mint-call'
import type { MintResult } from '@/lib/mint/mint-run'
import type { MintPageStatic } from '@/lib/mint/page-doc'
import { formatCountdown, shownStart } from './format'

/*
 * The mint page's rules, as pure functions of the chain's state (docs/specs/2026-10-16-mint-page-live-data.md,
 * section 7.4). Liveness is read from each group's `active` field (the contract's `mintGroupActive` view,
 * through the freshness server) and from nothing else. The chain clock passed in here only labels countdowns; it
 * never makes a phase live.
 */

export type PhaseStatus =
  /** The chain says the group is open. */
  | 'live'
  /** A start is scheduled and has not been reached. */
  | 'scheduled'
  /** The scheduled start has passed by our estimate, but the chain has not reported it live yet. */
  | 'starting'
  /** Every token of the group's allocation is minted. */
  | 'soldout'
  /** Not open and nothing scheduled, after minting happened. */
  | 'closed'
  /** Not open and nothing scheduled, and nothing minted: the creator has not opened it yet. */
  | 'unscheduled'

export type Allowance = { quota: number; used: number; remaining: number }

export type Phase = {
  group: MintGroup
  status: PhaseStatus
  remainingSupply: number
  /**
   * Seconds until the scheduled start, by the chain clock. Null when nothing is scheduled, the start is past the
   * end of the year 9999 (`shownStart`), or the clock is not set.
   */
  startsIn: number | null
  /** The connected wallet's own allowance in this phase; null until its answer arrives. */
  wallet: (Allowance & { eligible: boolean }) | null
  /** Allowances of vaults that delegated to this wallet, for this phase. */
  vaults: (Allowance & { vault: Address })[]
}

export type { Quote }

function allowance(quota: number, used: number, extra = 0): Allowance {
  const total = used + extra
  return { quota, used: total, remaining: Math.max(0, quota - total) }
}

/** Local mints the state has not read yet: those above its block. */
const unreadByState = (live: MintLive, local: readonly LocalMint[]) =>
  local.filter((mint) => mint.block > live.block)

/** Minted so far: the state's count and this page's mints it has not read yet. */
export function totalMinted(live: MintLive, local: readonly LocalMint[] = []): number {
  const extra = unreadByState(live, local).reduce((sum, mint) => sum + mint.count, 0)
  return Math.min(live.supply.max, live.supply.minted + extra)
}

/**
 * What a landed mint adds to the page's counts until the answers read it: its ids, against the allowance it used
 * (the vault's, else the wallet's). A mint always has its ids in the receipt; none is a replacement that minted
 * nothing, such as a cancel, and counts nothing.
 */
export function localMintOf(params: MintParams, result: MintResult): LocalMint | null {
  if (result.tokenIds.length === 0) return null
  return {
    groupId: params.groupId,
    holder: params.vault ?? params.account,
    count: result.tokenIds.length,
    block: result.block,
  }
}

/**
 * The phases the page shows, in the join's order: each visible group with its status, what is left, the
 * countdown and, once the wallet answered, what this wallet and its vaults can mint. A mint this page saw land
 * counts toward supply while the state is older than its receipt, and toward an allowance while the wallet
 * answer is, so it never counts twice.
 */
export function derivePhases(
  live: MintLive,
  wallet: WalletView | null,
  chainNow: number | null,
  local: readonly LocalMint[] = [],
): Phase[] {
  const collectionLeft = live.supply.max - totalMinted(live, local)
  const forState = unreadByState(live, local)
  const forWallet = wallet ? local.filter((mint) => mint.block > wallet.block) : []
  const usedBy = (groupId: number, holder: Address) =>
    forWallet
      .filter((mint) => mint.groupId === groupId && sameAddress(mint.holder, holder))
      .reduce((sum, mint) => sum + mint.count, 0)
  // A phase the creator hid (Phases, Edit details) is left off the page, as in legacy.
  return live.groups
    .filter((group) => group.visible !== false)
    .map((group) => {
      const localForGroup = forState
        .filter((mint) => mint.groupId === group.id)
        .reduce((sum, mint) => sum + mint.count, 0)
      const minted = group.minted + localForGroup
      const remainingSupply = Math.max(0, Math.min(group.maxSupply - minted, collectionLeft))
      // A start past the end of the year 9999 has no date to show or count down to, so it reads as none.
      const start = shownStart(group.scheduledStart)
      const startsIn = start > 0 && chainNow !== null ? start - chainNow : null

      let status: PhaseStatus
      if (remainingSupply === 0 && (group.active || minted >= group.maxSupply || collectionLeft === 0)) {
        status = 'soldout'
      } else if (group.active) status = 'live'
      else if (start > 0) status = startsIn === null || startsIn > 0 ? 'scheduled' : 'starting'
      else status = minted > 0 ? 'closed' : 'unscheduled'

      let walletAllowance: Phase['wallet'] = null
      const vaults: Phase['vaults'] = []
      if (wallet) {
        const own = usedBy(group.id, wallet.address)
        if (group.kind === 'public') {
          walletAllowance = {
            eligible: true,
            ...allowance(live.publicMaxMintPerWallet, wallet.publicMinted, own),
          }
        } else {
          const entry = wallet.groups.find((candidate) => candidate.groupId === group.id)
          const eligible = !!entry && entry.eligible && entry.quota > 0
          walletAllowance = { eligible, ...allowance(entry?.quota ?? 0, entry?.used ?? 0, own) }
          for (const delegated of wallet.delegatedVaults) {
            const vaultEntry = delegated.groups.find((candidate) => candidate.groupId === group.id)
            if (vaultEntry && vaultEntry.quota > 0) {
              vaults.push({
                vault: delegated.vault,
                ...allowance(vaultEntry.quota, vaultEntry.used, usedBy(group.id, delegated.vault)),
              })
            }
          }
        }
      }

      return { group, status, remainingSupply, startsIn, wallet: walletAllowance, vaults }
    })
}

/** Open now, Coming up and Finished, each in the join's order. */
const SECTION: Record<PhaseStatus, number> = {
  live: 0,
  starting: 1,
  scheduled: 1,
  unscheduled: 1,
  closed: 2,
  soldout: 2,
}

/** Live first, then what is coming, then what has finished, each section in the creator's order. */
export function sortPhases(phases: Phase[]): Phase[] {
  return [...phases].sort((a, b) => SECTION[a.status] - SECTION[b.status])
}

/** The phase the panel opens on: the cheapest live phase this wallet can mint from, else the next one to start. */
export function defaultPhaseId(phases: Phase[]): number | null {
  const live = phases.filter((phase) => phase.status === 'live')
  const mintable = live
    .filter((phase) => phase.wallet && (phase.wallet.eligible ? phase.wallet.remaining > 0 : false))
    .sort((a, b) => (BigInt(a.group.priceWei) < BigInt(b.group.priceWei) ? -1 : 1))
  if (mintable[0]) return mintable[0].group.id
  const eligibleLive = live.find((phase) => phase.wallet?.eligible)
  if (eligibleLive) return eligibleLive.group.id
  if (live[0]) return live[0].group.id
  const next = phases
    .filter((phase) => phase.status === 'starting' || phase.status === 'scheduled')
    .sort((a, b) => (a.startsIn ?? Infinity) - (b.startsIn ?? Infinity))[0]
  return next?.group.id ?? null
}

/**
 * The phase the panel shows: the visitor's choice while that phase reads live, else the default. The picker lists
 * live phases only and shows only while the shown phase is live, so a choice that sells out or closes gives way,
 * as a reload would, instead of keeping the panel on a phase nobody can mint from.
 */
export function selectedPhaseId(phases: Phase[], chosen: number | null): number | null {
  const kept = phases.find((phase) => phase.group.id === chosen)
  return kept?.status === 'live' ? kept.group.id : defaultPhaseId(phases)
}

/** Price and fee for a quantity: the contract's `quoteBatchMint` at the state's fees. */
export function quote(live: Pick<MintLive, 'fees'>, priceWei: string, quantity: number): Quote {
  return quoteOf(live.fees, priceWei, quantity)
}

/**
 * The vaults the panel offers on a phase: on a live phase, those with something left. A spent vault stays in
 * `phase.vaults` for its counts, but there is nothing to mint with it.
 */
export function offeredVaults(phase: Phase): Phase['vaults'] {
  return phase.status === 'live' ? phase.vaults.filter((entry) => entry.remaining > 0) : []
}

/** Who the tokens are minted against: the wallet itself or one of its delegated vaults. */
export function allowanceFor(phase: Phase, vault: Address | null): Allowance | null {
  if (vault) return phase.vaults.find((entry) => entry.vault === vault) ?? null
  return phase.wallet
}

export function maxQuantity(phase: Phase, vault: Address | null): number {
  const own = allowanceFor(phase, vault)
  return Math.max(0, Math.min(own?.remaining ?? 0, phase.remainingSupply))
}

export type MintAction =
  | { kind: 'connect'; label: string }
  | { kind: 'switch'; label: string }
  | { kind: 'mint'; label: string; quote: Quote }
  | { kind: 'blocked'; label: string }

export function deriveAction(input: {
  page: Pick<MintPageStatic, 'chain'>
  /** Null until the first state answer. */
  live: MintLive | null
  phase: Phase | null
  connected: boolean
  /** The connected wallet's answer has arrived. */
  walletRead: boolean
  wrongChain: boolean
  quantity: number
  vault: Address | null
  soldOut: boolean
}): MintAction {
  const { page, live, phase, connected, walletRead, wrongChain, quantity, vault, soldOut } = input
  if (!live) return { kind: 'blocked', label: 'Reading the chain' }
  if (soldOut) return { kind: 'blocked', label: 'Sold out' }
  if (!phase) return { kind: 'blocked', label: 'Minting is paused' }
  if (!connected) return { kind: 'connect', label: 'Connect wallet' }
  if (phase.status === 'scheduled') {
    return { kind: 'blocked', label: `Starts in ${formatCountdown(phase.startsIn ?? 0)}` }
  }
  if (phase.status === 'starting') return { kind: 'blocked', label: 'Starting, waiting for the chain' }
  if (phase.status === 'soldout') return { kind: 'blocked', label: 'Phase sold out' }
  if (phase.status !== 'live') return { kind: 'blocked', label: 'Phase closed' }
  if (!walletRead) return { kind: 'blocked', label: 'Checking this wallet' }
  if (!vault && phase.group.kind === 'whitelist' && !phase.wallet?.eligible) {
    return { kind: 'blocked', label: 'Not on the whitelist for this phase' }
  }
  if (maxQuantity(phase, vault) === 0) {
    return { kind: 'blocked', label: vault ? 'Vault limit reached' : 'Wallet limit reached' }
  }
  if (wrongChain) return { kind: 'switch', label: `Switch to ${page.chain.name}` }
  const q = quote(live, phase.group.priceWei, quantity)
  return {
    kind: 'mint',
    // A free phase with no flat fee totals nothing: "Mint 1 free" rather than "Mint 1 for 0 ETH".
    label:
      q.totalWei === 0n
        ? `Mint ${quantity} free`
        : `Mint ${quantity} for ${formatNative(q.totalWei, page.chain.nativeSymbol)}`,
    quote: q,
  }
}

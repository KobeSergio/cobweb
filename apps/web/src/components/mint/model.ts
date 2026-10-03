import { formatNative } from '@/lib/demo/helpers'
import type { Address, MintGroup, MintPageData, WalletState } from '@/lib/demo'
import { formatCountdown } from './format'

/*
 * The mint page's rules, as pure functions of the data. Liveness is read from each group's
 * `active` field (the contract's `mintGroupActive` view, through the freshness server) and from
 * nothing else. The chain clock passed in here only labels countdowns; it never makes a phase live.
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
  /** Seconds until the scheduled start, by the chain clock estimate. Null when nothing is scheduled. */
  startsIn: number | null
  /** The connected wallet's own allowance in this phase; null when no wallet is connected. */
  wallet: (Allowance & { eligible: boolean }) | null
  /** Allowances of vaults that delegated to this wallet, for this phase. */
  vaults: (Allowance & { vault: Address })[]
}

/** Tokens minted in this session, per phase and minter, so the page stays right until the next read. */
export type LocalMints = Record<string, number>
export const localKey = (groupId: number, minter: Address) => `${groupId}:${minter.toLowerCase()}`

function allowance(quota: number, used: number, extra = 0): Allowance {
  const total = used + extra
  return { quota, used: total, remaining: Math.max(0, quota - total) }
}

export function totalMinted(data: MintPageData, local: LocalMints): number {
  const extra = Object.values(local).reduce((sum, count) => sum + count, 0)
  return Math.min(data.supply.max, data.supply.minted + extra)
}

export function derivePhases(
  data: MintPageData,
  wallet: WalletState | null,
  chainNow: number,
  local: LocalMints = {},
): Phase[] {
  const collectionLeft = data.supply.max - totalMinted(data, local)
  return data.groups.map((group) => {
    const localForGroup = Object.entries(local)
      .filter(([key]) => key.startsWith(`${group.id}:`))
      .reduce((sum, [, count]) => sum + count, 0)
    const minted = group.minted + localForGroup
    const remainingSupply = Math.max(0, Math.min(group.maxSupply - minted, collectionLeft))
    const startsIn = group.scheduledStart > 0 ? group.scheduledStart - chainNow : null

    let status: PhaseStatus
    if (remainingSupply === 0 && (group.active || minted >= group.maxSupply || collectionLeft === 0)) {
      status = 'soldout'
    } else if (group.active) status = 'live'
    else if (startsIn !== null) status = startsIn > 0 ? 'scheduled' : 'starting'
    else status = minted > 0 ? 'closed' : 'unscheduled'

    let walletAllowance: Phase['wallet'] = null
    const vaults: Phase['vaults'] = []
    if (wallet) {
      const own = localKey(group.id, wallet.address)
      if (group.kind === 'public') {
        walletAllowance = {
          eligible: true,
          ...allowance(data.publicMaxMintPerWallet, wallet.publicMinted, local[own]),
        }
      } else {
        const entry = wallet.groups.find((candidate) => candidate.groupId === group.id)
        const eligible = !!entry && entry.eligible && entry.quota > 0
        walletAllowance = { eligible, ...allowance(entry?.quota ?? 0, entry?.used ?? 0, local[own]) }
      }
      for (const delegated of wallet.delegatedVaults) {
        const entry = delegated.groups.find((candidate) => candidate.groupId === group.id)
        if (entry && entry.quota > 0) {
          vaults.push({
            vault: delegated.vault,
            ...allowance(entry.quota, entry.used, local[localKey(group.id, delegated.vault)]),
          })
        }
      }
    }

    return { group, status, remainingSupply, startsIn, wallet: walletAllowance, vaults }
  })
}

const ORDER: Record<PhaseStatus, number> = {
  live: 0,
  starting: 1,
  scheduled: 2,
  unscheduled: 3,
  closed: 4,
  soldout: 5,
}

/** Live first, then what is coming (soonest first), then what has finished. */
export function sortPhases(phases: Phase[]): Phase[] {
  return [...phases].sort(
    (a, b) =>
      ORDER[a.status] - ORDER[b.status] ||
      (a.startsIn ?? Infinity) - (b.startsIn ?? Infinity) ||
      a.group.id - b.group.id,
  )
}

/** The phase the panel opens on: the cheapest live phase this wallet can mint from, else the next one. */
export function defaultPhaseId(phases: Phase[]): number | null {
  const live = phases.filter((phase) => phase.status === 'live')
  const mintable = live
    .filter((phase) => phase.wallet && (phase.wallet.eligible ? phase.wallet.remaining > 0 : false))
    .sort((a, b) => (BigInt(a.group.priceWei) < BigInt(b.group.priceWei) ? -1 : 1))
  if (mintable[0]) return mintable[0].group.id
  const eligibleLive = live.find((phase) => phase.wallet?.eligible)
  if (eligibleLive) return eligibleLive.group.id
  if (live[0]) return live[0].group.id
  const next = sortPhases(phases).find((phase) => phase.status === 'starting' || phase.status === 'scheduled')
  return next?.group.id ?? null
}

/** Platform fee for one token: the flat fee plus basis points of the price (contracts/README, Fees). */
export function feePerTokenWei(data: MintPageData, priceWei: string): bigint {
  return BigInt(data.fees.mintFeeFlatWei) + (BigInt(priceWei) * BigInt(data.fees.mintFeeBps)) / 10_000n
}

export type Quote = { priceWei: bigint; feeWei: bigint; totalWei: bigint; quantity: number }

export function quote(data: MintPageData, priceWei: string, quantity: number): Quote {
  const price = BigInt(priceWei) * BigInt(quantity)
  const fee = feePerTokenWei(data, priceWei) * BigInt(quantity)
  return { priceWei: price, feeWei: fee, totalWei: price + fee, quantity }
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
  data: MintPageData
  phase: Phase | null
  connected: boolean
  wrongChain: boolean
  quantity: number
  vault: Address | null
  soldOut: boolean
}): MintAction {
  const { data, phase, connected, wrongChain, quantity, vault, soldOut } = input
  const symbol = data.collection.chain.nativeSymbol
  if (soldOut) return { kind: 'blocked', label: 'Sold out' }
  if (!phase) return { kind: 'blocked', label: 'Minting is paused' }
  if (!connected) return { kind: 'connect', label: 'Connect wallet' }
  if (phase.status === 'scheduled') {
    return { kind: 'blocked', label: `Starts in ${formatCountdown(phase.startsIn ?? 0)}` }
  }
  if (phase.status === 'starting') return { kind: 'blocked', label: 'Starting, waiting for the chain' }
  if (phase.status === 'soldout') return { kind: 'blocked', label: 'Phase sold out' }
  if (phase.status !== 'live') return { kind: 'blocked', label: 'Phase closed' }
  if (!vault && phase.group.kind === 'whitelist' && !phase.wallet?.eligible) {
    return { kind: 'blocked', label: 'Not on the whitelist for this phase' }
  }
  if (maxQuantity(phase, vault) === 0) {
    return { kind: 'blocked', label: vault ? 'Vault limit reached' : 'Wallet limit reached' }
  }
  if (wrongChain) return { kind: 'switch', label: `Switch to ${data.collection.chain.name}` }
  const q = quote(data, phase.group.priceWei, quantity)
  return { kind: 'mint', label: `Mint ${quantity} for ${formatNative(q.totalWei, symbol)}`, quote: q }
}

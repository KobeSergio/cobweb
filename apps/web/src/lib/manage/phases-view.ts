import type { Address } from 'viem'
import type { MintGroup } from '@/lib/demo/types'
import type { ChainGroup, ChainState, PhaseRowCopy, PhasesView } from './phases-types'

/**
 * The Phases view, pure (docs/specs/2026-10-15-phases.md, section 6.2): the contract's groups joined with
 * the `mint_groups` rows, the copy when the chain does not answer, what a read copies back, and the
 * screen's local reorder. Status comes only from the chain's `active`.
 */

/** The largest value the copy's integer columns hold (`onchain_id`, `max_supply`, `public_max_per_wallet`). */
export const INT_MAX = 2_147_483_647

/** The last second of 9999-12-31 UTC: a start above it does not fit the copy's timestamptz column. */
export const TIMESTAMP_MAX = 253_402_300_799

const kindOf = (id: number): MintGroup['kind'] => (id === 0 ? 'public' : 'whitelist')

/** Rows in the creator's order: by position, then by id; a row parked inside a move sorts last. */
function byPosition(a: PhaseRowCopy, b: PhaseRowCopy): number {
  const left = a.position ?? Number.MAX_SAFE_INTEGER
  const right = b.position ?? Number.MAX_SAFE_INTEGER
  return left - right || a.onchain_id - b.onchain_id
}

/** What the chain says about a group: everything but the off-chain fields. */
function fromChain(group: ChainGroup): Omit<MintGroup, 'name' | 'description' | 'visible' | 'named'> {
  return {
    id: group.id,
    kind: kindOf(group.id),
    priceWei: group.priceWei,
    maxSupply: group.maxSupply,
    minted: group.minted,
    flag: group.flag,
    scheduledStart: group.startTimestamp,
    active: group.active,
  }
}

/**
 * The chain's groups with their rows: rows by position, then id, each group taking its row's name,
 * description and visibility; the groups without a row follow by id as "Group N" (`named: false`); a row
 * the chain does not list is left out.
 */
export function joinPhases(state: Pick<ChainState, 'groups'>, rows: PhaseRowCopy[]): MintGroup[] {
  const onChain = new Map(state.groups.map((group) => [group.id, group]))
  const named = [...rows].sort(byPosition).flatMap((row): MintGroup[] => {
    const group = onChain.get(row.onchain_id)
    if (!group) return []
    return [
      {
        ...fromChain(group),
        name: row.name,
        description: row.description,
        visible: row.visible,
        named: true,
      },
    ]
  })
  const rowIds = new Set(rows.map((row) => row.onchain_id))
  const unnamed = state.groups
    .filter((group) => !rowIds.has(group.id))
    .sort((a, b) => a.id - b.id)
    .map((group): MintGroup => ({
      ...fromChain(group),
      name: `Group ${group.id}`,
      description: '',
      visible: true,
      named: false,
    }))
  return [...named, ...unnamed]
}

/** Where the view's groups come from: the deployment's chain and contract, and the rows. */
export type ViewBase = { chainId: number; contract: Address; rows: PhaseRowCopy[] }

/** The view from a read that reached the chain. */
export function liveView(base: ViewBase, state: ChainState): PhasesView {
  return {
    chainId: base.chainId,
    contract: base.contract,
    groups: joinPhases(state, base.rows),
    publicMaxPerWallet: state.publicMaxMintPerWallet,
    totalMinted: state.totalMinted,
    maxSupply: state.maxSupply,
    blockTimestamp: state.blockTimestamp,
    readAt: state.blockTimestamp,
    chainReachable: true,
  }
}

/**
 * The view when the chain does not answer: the rows' copies of price, allocation and start, minted 0 and
 * never live (the screen says status and minted counts are not read), the collection's supply, and the
 * time of the read the copies came from as both `readAt` and `blockTimestamp`.
 */
export function copyView(
  base: ViewBase & { publicMaxPerWallet: number; maxSupply: number; readAt: number },
): PhasesView {
  const groups = [...base.rows].sort(byPosition).map((row): MintGroup => ({
    id: row.onchain_id,
    name: row.name,
    kind: kindOf(row.onchain_id),
    priceWei: row.price_wei,
    maxSupply: row.max_supply,
    minted: 0,
    flag: false,
    scheduledStart: row.start_at === null ? 0 : Math.floor(Date.parse(row.start_at) / 1000),
    active: false,
    description: row.description,
    visible: row.visible,
    named: true,
  }))
  return {
    chainId: base.chainId,
    contract: base.contract,
    groups,
    publicMaxPerWallet: base.publicMaxPerWallet,
    totalMinted: 0,
    maxSupply: base.maxSupply,
    blockTimestamp: base.readAt,
    readAt: base.readAt,
    chainReachable: false,
  }
}

/** What `mint_groups_refresh` copies from a read: `start` in Unix seconds, 0 for none. */
export type RefreshPayload = {
  publicMaxPerWallet: number
  groups: { onchain_id: number; price_wei: string; max_supply: number; start: number }[]
}

/**
 * The copies a read refreshes, or null when an id, an allocation or the public limit set outside Cobweb
 * does not fit the integer columns, or a start does not fit the timestamp column: then that read is not
 * copied at all (section 12).
 */
export function refreshPayload(state: ChainState): RefreshPayload | null {
  const fits = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= INT_MAX
  const fitsStart = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= TIMESTAMP_MAX
  if (
    !fits(state.publicMaxMintPerWallet) ||
    state.groups.some(
      (group) => !fits(group.id) || !fits(group.maxSupply) || !fitsStart(group.startTimestamp),
    )
  )
    return null
  return {
    publicMaxPerWallet: state.publicMaxMintPerWallet,
    groups: state.groups.map((group) => ({
      onchain_id: group.id,
      price_wei: group.priceWei,
      max_supply: group.maxSupply,
      start: group.startTimestamp,
    })),
  }
}

/**
 * Move up and Move down as the screen shows them before the server answers (section 7.4): a named phase
 * swaps with its named neighbour, as `mint_group_move` swaps their positions; phases without a row stay
 * last; past either end nothing moves.
 */
export function moveGroup(groups: MintGroup[], groupId: number, direction: 'up' | 'down'): MintGroup[] {
  const named = groups.filter((group) => group.named !== false)
  const unnamed = groups.filter((group) => group.named === false)
  const from = named.findIndex((group) => group.id === groupId)
  const to = from + (direction === 'up' ? -1 : 1)
  if (from < 0 || to < 0 || to >= named.length) return groups
  const moved = [...named]
  const [entry] = moved.splice(from, 1)
  if (!entry) return groups
  moved.splice(to, 0, entry)
  return [...moved, ...unnamed]
}

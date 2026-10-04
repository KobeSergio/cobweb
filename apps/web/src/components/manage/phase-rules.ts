/**
 * The checks a phase's settings go through before a transaction is built, shared by Deploy (the
 * initial phases in the constructor) and Manage drop (phases after deploy). They mirror the
 * contract where it has a rule and legacy where it had a sensible limit; see the spec, section 13.
 */

/** Phase names are stored by Cobweb (`mint_groups.name`), not on chain. Legacy allowed 20. */
export const PHASE_NAME_MAX = 40
/** The phase description shown on the mint page. Legacy's rich text editor stopped at 500. */
export const PHASE_DESCRIPTION_MAX = 500
/** Highest price per token, in the native token. Legacy's limit. */
export const PRICE_MAX = 1_000_000
/** The native token's decimals on every launch chain. */
export const NATIVE_DECIMALS = 18

/** Why a phase name cannot be used, or null. Names are compared without case or outer spaces. */
export function phaseNameError(name: string, others: string[]): string | null {
  const trimmed = name.trim()
  if (!trimmed) return 'Name the phase, for example "Holders".'
  if (trimmed.length > PHASE_NAME_MAX) return `Use at most ${PHASE_NAME_MAX} characters.`
  if (others.some((other) => other.trim().toLowerCase() === trimmed.toLowerCase()))
    return 'Another phase already has this name.'
  return null
}

/**
 * Why a typed price cannot be sent, or null. Prices are decimal amounts of the chain's native
 * token, 0 (a free mint) to 1,000,000, with at most 18 decimal places (one wei).
 */
export function priceError(text: string, symbol: string): string | null {
  const value = text.trim()
  if (!value) return 'Enter a price. Use 0 for a free mint.'
  if (!/^\d+(\.\d+)?$/.test(value)) return `Enter an amount of ${symbol} such as 0.0025.`
  const fraction = value.split('.')[1] ?? ''
  if (fraction.length > NATIVE_DECIMALS)
    return `Use at most ${NATIVE_DECIMALS} decimal places; ${symbol} has no smaller unit.`
  if (Number(value) > PRICE_MAX)
    return `The most a token can cost is ${PRICE_MAX.toLocaleString('en-US')} ${symbol}.`
  return null
}

export type Allocation = { id: number; maxSupply: number; minted?: number }

/** Room left for allocations if `groupId`'s allocation is replaced (null: a new phase). */
export function allocationRoom(groups: Allocation[], maxSupply: number, groupId: number | null): number {
  const others = groups
    .filter((group) => group.id !== groupId)
    .reduce((sum, group) => sum + group.maxSupply, 0)
  return maxSupply - others
}

/**
 * Checks a new allocation for one phase. `error` is what the contract would refuse
 * (`BelowMinted`, `AllocationsExceedMaxSupply`); `warning` is allowed on chain but will not sell:
 * airdrops use collection supply outside every phase, so allocations above what is left after them
 * cannot all be minted. Legacy refused that case outright; the contract does not.
 */
export function allocationCheck(input: {
  groups: Allocation[]
  maxSupply: number
  groupId: number | null
  value: string
  airdropped?: number
  min?: number
}): { error: string | null; warning: string | null; room: number; next: number } {
  const { groups, maxSupply, groupId, value, airdropped = 0, min = 0 } = input
  const room = allocationRoom(groups, maxSupply, groupId)
  const minted = groups.find((group) => group.id === groupId)?.minted ?? 0
  const next = Number(value)
  const fmt = (n: number) => n.toLocaleString('en-US')
  let error: string | null = null
  if (!/^\d+$/.test(value.trim())) error = 'Enter a whole number.'
  else if (next < minted)
    error = `It cannot go below ${fmt(minted)}, the tokens this phase has already minted.`
  else if (next < min) error = `Enter ${fmt(min)} or more.`
  else if (next > room)
    error = `Only ${fmt(Math.max(0, room))} fit: the other phases hold ${fmt(maxSupply - room)} of ${fmt(maxSupply)}.`
  const sellable = room - airdropped
  const warning =
    !error && airdropped > 0 && next > sellable
      ? `Airdrops used ${fmt(airdropped)} tokens of the collection's supply, so at most ${fmt(Math.max(0, sellable))} of this allocation can be minted.`
      : null
  return { error, warning, room, next }
}

/** The whole split: allocated, left over, and whether it fits the collection. */
export function supplySplit(groups: Allocation[], maxSupply: number) {
  const allocated = groups.reduce(
    (sum, group) => sum + (Number.isFinite(group.maxSupply) ? group.maxSupply : 0),
    0,
  )
  return {
    allocated,
    unallocated: Math.max(0, maxSupply - allocated),
    over: Math.max(0, allocated - maxSupply),
  }
}

/** Why a public per-wallet limit cannot be used, or null. At most the collection's supply. */
export function publicCapError(value: string, maxSupply: number): string | null {
  const cap = Number(value)
  if (!/^\d+$/.test(value.trim()) || cap < 1) return 'Enter a whole number of 1 or more.'
  if (maxSupply > 0 && cap > maxSupply)
    return `Enter at most ${maxSupply.toLocaleString('en-US')}, the collection's supply.`
  return null
}

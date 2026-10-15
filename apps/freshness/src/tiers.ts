import type { ChainState } from '@cobweb/shared'

/**
 * The tiers and `degraded` (docs/specs/2026-10-16-freshness-server.md, section 6.6), pure. The tiers only
 * decide when to read the chain: liveness is always the contract's `active`, never computed here.
 */

/** A chain's tick interval: around a scheduled start, while a phase is live, otherwise. */
export const TIER_MS = { fast: 1_000, live: 2_000, idle: 20_000 } as const
export type Tier = keyof typeof TIER_MS

/** The fast tier runs from 15 s before a scheduled start to 30 s after it, on the chain's time. */
export const FAST_BEFORE_S = 15
export const FAST_AFTER_S = 30
/** A collection never reads degraded sooner than 10 s after its last read. */
export const DEGRADED_FLOOR_MS = 10_000

/** Fastest first. */
const ORDER: readonly Tier[] = ['fast', 'live', 'idle']

/**
 * A collection's tier from its last read: fast when the read's block time lies from 15 s before to 30 s after
 * any scheduled start, both ends included; else live when any group is active and not sold out (by its
 * allocation or by the collection's supply); else idle. A collection with no read yet is live, so a failed
 * first read is tried again every 2 s.
 */
export function tierOf(
  state: Pick<ChainState, 'blockTimestamp' | 'maxSupply' | 'totalMinted' | 'groups'> | null,
): Tier {
  if (!state) return 'live'
  const nearStart = state.groups.some(
    (group) =>
      group.startTimestamp !== 0 &&
      state.blockTimestamp >= group.startTimestamp - FAST_BEFORE_S &&
      state.blockTimestamp <= group.startTimestamp + FAST_AFTER_S,
  )
  if (nearStart) return 'fast'
  const supplyLeft = state.totalMinted < state.maxSupply
  const live = state.groups.some((group) => group.active && group.minted < group.maxSupply && supplyLeft)
  return live ? 'live' : 'idle'
}

/** A chain ticks at the fastest tier any of its collections needs; idle with none. */
export function chainTier(states: readonly (ChainState | null)[]): Tier {
  let tier: Tier = 'idle'
  for (const state of states) {
    const own = tierOf(state)
    if (ORDER.indexOf(own) < ORDER.indexOf(tier)) tier = own
  }
  return tier
}

/**
 * The delay to the next tick: the tier's interval counted from this tick's start (0 when the tick ran
 * longer), shortened on an idle chain to the moment the nearest start's window opens, estimated as that
 * read's `readAt` plus the seconds from its block time to the start less 15. A moment at or before the
 * tick's start comes from a stale read and does not shorten the delay: a fresh read's moment always lies
 * after it, since its `readAt` is no earlier than the tick's start and the window opens at least 1 s after
 * its block. The early wake is never sooner than one fast interval after the tick's start either, so a read
 * that stays frozen cannot make the chain read back to back.
 */
export function nextDelayMs(
  tier: Tier,
  reads: readonly { state: ChainState; readAt: number }[],
  startedAt: number,
  now: number,
): number {
  let next = startedAt + TIER_MS[tier]
  if (tier === 'idle')
    for (const { state, readAt } of reads)
      for (const group of state.groups) {
        if (group.startTimestamp === 0) continue
        const opensIn = group.startTimestamp - FAST_BEFORE_S - state.blockTimestamp
        const opensAt = readAt + opensIn * 1_000
        if (opensIn > 0 && opensAt > startedAt)
          next = Math.min(next, Math.max(startedAt + TIER_MS.fast, opensAt))
      }
  return Math.max(0, next - now)
}

/** How old a last read may be before it reads degraded: the larger of three ticks of the tier and 10 s. */
export function degradedAfterMs(tier: Tier): number {
  return Math.max(3 * TIER_MS[tier], DEGRADED_FLOOR_MS)
}

/** Whether a collection read at `readAt` reads degraded at `now` on a chain at `tier`. */
export function isDegraded(readAt: number, now: number, tier: Tier): boolean {
  return now - readAt > degradedAfterMs(tier)
}

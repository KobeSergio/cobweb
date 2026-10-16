import type { MintBody } from '@cobweb/shared'
import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { ACTIVITY_LAG_MAX_S, activityOf, RECENT_MINTS, type Summary } from './activity.ts'

const CONTRACT: Address = '0x0409454c375c8a6ab05383bfb6d9fcde9ebb8f85'
const MINTER: Address = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8'
const CHECKSUMMED: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

/** Twelve mints newest first, as the database answers them: lowercase recipients, one block apart. */
const mints: MintBody[] = Array.from({ length: 12 }, (_, index) => ({
  txHash: `0x${(12 - index).toString(16).padStart(64, '0')}` as Hex,
  recipient: MINTER,
  groupId: 0,
  amount: 1,
  firstTokenId: 12 - index,
  blockTimestamp: 1_800_000_012 - index,
}))
const summary: Summary = {
  collectionId: '0a977c0b-7e53-476b-8c08-6c685315c3af',
  contract: CONTRACT,
  holders: 7,
  syncedAt: 1_800_000_000,
  recentMints: mints,
}

describe('activityOf (docs/specs/2026-10-16-indexer-overview.md, section 6.6)', () => {
  it('is null without a summary, before the first sync and at 301 s behind the state', () => {
    expect(ACTIVITY_LAG_MAX_S).toBe(300)
    expect(activityOf(undefined, 1_800_000_000, 1_800_000_000)).toBeNull()
    expect(activityOf(summary, null, 1_800_000_000)).toBeNull()
    expect(activityOf(summary, 1_800_000_000, 1_800_000_301)).toBeNull()
  })

  it('carries the holders at 300 s behind, and when the state reads an older block than the sync', () => {
    expect(activityOf(summary, 1_800_000_000, 1_800_000_300)?.holders).toBe(7)
    expect(activityOf(summary, 1_800_000_000, 1_799_999_000)?.holders).toBe(7)
  })

  it('carries at most 10 mints, newest first, recipients checksummed', () => {
    expect(RECENT_MINTS).toBe(10)
    const activity = activityOf(summary, 1_800_000_000, 1_800_000_010)
    expect(activity?.recentMints).toHaveLength(10)
    expect(activity?.recentMints.map((mint) => mint.firstTokenId)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3])
    expect(activity?.recentMints[0]).toEqual({ ...mints[0], recipient: CHECKSUMMED })
  })
})

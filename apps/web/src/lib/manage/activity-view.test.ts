import type { Address, Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  activityViewOf,
  BEHIND_AFTER_S,
  behindOf,
  paidByMintersOf,
  RECENT_MINTS_SHOWN,
  type ActivityView,
  type MintRow,
} from './activity-view'

const MINTER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
/** 1 November 2026 00:00 UTC, as the cursor's synced_at reads it. */
const SYNCED_AT = 1_793_491_200
const SYNCED = '2026-11-01T00:00:00+00:00'
/** Fourteen mints newest first, 12 s apart, as the core reads them: recipients lowercase. */
const rows: MintRow[] = Array.from({ length: 14 }, (_, index) => ({
  tx_hash: `0x${(14 - index).toString(16).padStart(64, '0')}`,
  recipient: MINTER.toLowerCase(),
  amount: 1 + (index % 2),
  group_id: index % 2,
  block_time: new Date((SYNCED_AT - index * 12) * 1_000).toISOString(),
  first_token_id: 30 - index * 2,
}))
const counted: ActivityView = activityViewOf({ synced_at: SYNCED, holders: 171 }, rows)

describe('activityViewOf (docs/specs/2026-10-16-indexer-overview.md, section 7.1)', () => {
  it('reads not counted without a cursor, or with one the indexer has not synced yet', () => {
    expect(activityViewOf(null, [])).toEqual({ counted: false, holders: 0, countedAt: null, recentMints: [] })
    expect(activityViewOf({ synced_at: null, holders: 0 }, []).counted).toBe(false)
  })

  it('reads counted with the holders and the 12 latest mints, newest first, minters checksummed', () => {
    expect(RECENT_MINTS_SHOWN).toBe(12)
    expect(counted).toMatchObject({ counted: true, holders: 171, countedAt: SYNCED_AT })
    expect(counted.recentMints).toHaveLength(12)
    expect(counted.recentMints[0]).toEqual({
      txHash: `0x${'e'.padStart(64, '0')}` as Hex,
      minter: MINTER,
      amount: 1,
      groupId: 0,
      at: SYNCED_AT,
      firstTokenId: 30,
    })
    expect(counted.recentMints.map((mint) => mint.at)).toEqual(
      Array.from({ length: 12 }, (_, index) => SYNCED_AT - index * 12),
    )
  })
})

describe('behindOf', () => {
  it('is behind at 301 s and not at 300 s', () => {
    expect(BEHIND_AFTER_S).toBe(300)
    expect(behindOf(counted, SYNCED_AT + 300, true)).toBe(false)
    expect(behindOf(counted, SYNCED_AT + 301, true)).toBe(true)
  })

  it('is never behind while the chain read is the copy, or before the indexer has counted', () => {
    expect(behindOf(counted, SYNCED_AT + 3_600, false)).toBe(false)
    expect(behindOf(activityViewOf(null, []), SYNCED_AT + 3_600, true)).toBe(false)
  })
})

describe('paidByMintersOf (docs/specs/2026-10-16-indexer-overview.md, decision 15)', () => {
  it("pays minters the creator's balance plus every withdrawal, to the wei", () => {
    expect(paidByMintersOf({ creatorBalanceWei: '700', withdrawnWei: '300' }, counted)).toEqual({
      kind: 'wei',
      wei: '1000',
    })
    expect(
      paidByMintersOf({ creatorBalanceWei: '1500000000000000000000', withdrawnWei: '2' }, counted),
    ).toEqual({ kind: 'wei', wei: '1500000000000000000002' })
  })

  it('reads counting before the indexer has counted, and not read without the view or the balance', () => {
    expect(
      paidByMintersOf({ creatorBalanceWei: '700', withdrawnWei: '0' }, activityViewOf(null, [])),
    ).toEqual({
      kind: 'counting',
    })
    expect(paidByMintersOf({ creatorBalanceWei: '700', withdrawnWei: '0' }, null)).toEqual({
      kind: 'not-read',
    })
    expect(paidByMintersOf({ creatorBalanceWei: null, withdrawnWei: '0' }, counted)).toEqual({
      kind: 'not-read',
    })
  })
})

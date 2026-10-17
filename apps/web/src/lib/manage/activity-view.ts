import { getAddress, type Hex } from 'viem'
import type { DropActivity } from '@/lib/demo'
import type { SettingsView } from './settings-types'

/**
 * The Overview's activity, pure (docs/specs/2026-10-16-indexer-overview.md, section 7.1): the holders and the
 * latest mints the indexer recorded, whether it has read every block since the deploy, how far behind the
 * chain read its count is, and "Paid by minters". For the browser and the server.
 */

/** The most mints Recent mints shows. */
export const RECENT_MINTS_SHOWN = 12
/** A count more than this many seconds of chain time behind the chain read shows the behind line. */
export const BEHIND_AFTER_S = 300

/** The `indexer_cursors` columns the view reads. */
export type CursorRow = { synced_at: string | null; holders: number }
/** The `mints` columns the view reads. */
export type MintRow = {
  tx_hash: string
  recipient: string
  amount: number
  group_id: number
  block_time: string
  first_token_id: number
}

export type ActivityView = {
  /** The indexer has read every block since the deploy: its counts are whole. */
  counted: boolean
  holders: number
  /** The chain's time at the indexer's last read to the confirmation depth (Unix seconds); null before one. */
  countedAt: number | null
  /** Newest first. */
  recentMints: DropActivity['recentMints']
}

const seconds = (time: string) => Math.floor(Date.parse(time) / 1_000)

/** The view from the collection's cursor (null without one) and its latest mints, newest first. */
export function activityViewOf(cursor: CursorRow | null, mints: MintRow[]): ActivityView {
  const countedAt = cursor?.synced_at ? seconds(cursor.synced_at) : null
  return {
    counted: countedAt !== null,
    holders: cursor?.holders ?? 0,
    countedAt,
    recentMints: mints.slice(0, RECENT_MINTS_SHOWN).map((row) => ({
      txHash: row.tx_hash as Hex,
      minter: getAddress(row.recipient),
      amount: row.amount,
      groupId: row.group_id,
      at: seconds(row.block_time),
      firstTokenId: row.first_token_id,
    })),
  }
}

/**
 * Whether the count trails the chain read by more than 300 s: only while the chain read is reachable (the copy's
 * time says nothing of the chain) and the view is counted.
 */
export function behindOf(activity: ActivityView, readAt: number, chainReachable: boolean): boolean {
  return (
    chainReachable &&
    activity.counted &&
    activity.countedAt !== null &&
    readAt - activity.countedAt > BEHIND_AFTER_S
  )
}

/** "Paid by minters": an amount, "Counting" or "Not read". */
export type PaidByMinters = { kind: 'wei'; wei: string } | { kind: 'counting' } | { kind: 'not-read' }

/**
 * Everything minters paid the creator, platform fees apart (decision 15): `creatorBalance()` plus every
 * `MintFundsWithdrawn`, since the balance grows only on mints and falls only to 0 on a withdrawal, which emits
 * what it paid out. Not read without an activity view or without the balance; counting until the indexer has
 * read every block since the deploy.
 */
export function paidByMintersOf(
  settings: Pick<SettingsView, 'creatorBalanceWei' | 'withdrawnWei'>,
  activity: ActivityView | null,
): PaidByMinters {
  if (!activity || settings.creatorBalanceWei === null) return { kind: 'not-read' }
  if (!activity.counted) return { kind: 'counting' }
  return { kind: 'wei', wei: (BigInt(settings.creatorBalanceWei) + BigInt(settings.withdrawnWei)).toString() }
}

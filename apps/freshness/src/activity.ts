import type { MintBody, StateActivity } from '@cobweb/shared'
import { getAddress, type Address } from 'viem'

/**
 * A collection's activity for the state body (docs/specs/2026-10-16-indexer-overview.md, section 6.6), pure:
 * the holders and the latest mints from the indexer's summary, while the indexer has read the collection to
 * the chain's confirmation depth within 300 s of chain time.
 */

/**
 * How far, in seconds of chain time, the indexer's last read to the safe block may trail the state's block.
 */
export const ACTIVITY_LAG_MAX_S = 300
/** The most mints the state body carries. */
export const RECENT_MINTS = 10

/**
 * A cursor's summary as `indexer_record` and `indexer_summaries` answer it: its holders and its latest mints,
 * newest first, recipients as the database holds them (lowercase); `syncedAt` in Unix seconds.
 */
export type Summary = {
  collectionId: string
  contract: Address
  holders: number
  syncedAt: number | null
  recentMints: MintBody[]
}

/**
 * The state body's `activity`: null without a summary, before the indexer's first read to the safe block
 * (`syncedAt` null, the cursor's in memory), and while that read is more than 300 s of chain time behind
 * `blockTimestamp`; otherwise the holders and the first 10 mints, recipients checksummed.
 */
export function activityOf(
  summary: Summary | undefined,
  syncedAt: number | null,
  blockTimestamp: number,
): StateActivity | null {
  if (!summary || syncedAt === null || blockTimestamp - syncedAt > ACTIVITY_LAG_MAX_S) return null
  return {
    holders: summary.holders,
    recentMints: summary.recentMints
      .slice(0, RECENT_MINTS)
      .map((mint) => ({ ...mint, recipient: getAddress(mint.recipient) })),
  }
}

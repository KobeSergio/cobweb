import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import { activityViewOf, RECENT_MINTS_SHOWN, type ActivityView } from './activity-view'
import type { PhasesContext } from './phases-core'

/**
 * The Overview's activity on the server (docs/specs/2026-10-16-indexer-overview.md, section 7.1): the
 * collection's `indexer_cursors` row and its 12 latest `mints` by block then log index, read with the creator's
 * client under row-level security, after the action's session and ownership check. No `server-only` marker, so
 * `verify:indexer` can import it; the browser never does. A read that fails throws, so the action logs it and
 * the Overview reads "Not read".
 */
export async function activityViewCore(ctx: PhasesContext): Promise<DeployOutcome<ActivityView>> {
  const [cursor, mints] = await Promise.all([
    ctx.supabase
      .from('indexer_cursors')
      .select('synced_at, holders')
      .eq('collection_id', ctx.collection.id)
      .maybeSingle(),
    ctx.supabase
      .from('mints')
      .select('tx_hash, recipient, amount, group_id, block_time, first_token_id')
      .eq('collection_id', ctx.collection.id)
      .order('block', { ascending: false })
      .order('log_index', { ascending: false })
      .limit(RECENT_MINTS_SHOWN),
  ])
  if (cursor.error) throw new Error(`The indexer's cursor could not be read: ${cursor.error.message}`)
  if (mints.error) throw new Error(`The mints could not be read: ${mints.error.message}`)
  return { data: activityViewOf(cursor.data, mints.data) }
}

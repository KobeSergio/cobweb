import 'server-only'
import { phasesWriteError, type DbError } from '@/lib/art/db-error'
import { errorSummary } from '@/lib/art/lock-core'
import { ownedCollection } from '@/lib/art/owned'
import { fail, THROWN, type ActionResult } from '@/lib/art/result'
import type { DeployOutcome } from '@/lib/deploy/deploy-core'
import { createServiceClient } from '@/lib/supabase/service'
import type { PhasesContext } from './phases-core'

/**
 * Runs a Phases step for the signed-in owner of a collection (deployWrite's counterpart for Phases;
 * docs/specs/2026-10-15-phases.md, section 6.4). Two clients: the creator's RLS client for the session
 * check, the owner read, every read and the off-chain edits, and the service client for
 * `mint_group_record` and `mint_groups_refresh`, whose arguments come from a verified receipt or the
 * server's own chain read, called with the verified user's id as `p_owner`. The service client is built
 * on first use, after the ownership check. A refusal is returned as its sentence; a database error becomes
 * the creator's sentence (`writeError`: `phasesWriteError` for Phases, `whitelistWriteError` for the Whitelist
 * actions, docs/specs/2026-10-15-whitelist.md, section 6.5); anything thrown is logged and reads "Try again".
 */
export async function phasesWrite<T>(
  collectionId: string,
  run: (ctx: PhasesContext) => Promise<DeployOutcome<T>>,
  writeError: (error: DbError) => string = phasesWriteError,
): Promise<ActionResult<T>> {
  try {
    const owned = await ownedCollection(collectionId)
    if (owned.error !== undefined) return fail(owned.error)
    const outcome = await run({
      supabase: owned.supabase,
      service: createServiceClient,
      owner: owned.user.id,
      wallet: owned.user.walletAddress,
      collection: owned.collection,
    })
    if ('refused' in outcome) return fail(outcome.refused)
    if ('error' in outcome) return fail(writeError(outcome.error))
    return { ok: true, data: outcome.data }
  } catch (error) {
    console.error(`A phases step threw. ${errorSummary(error)}`)
    return fail(THROWN)
  }
}

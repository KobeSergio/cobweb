import 'server-only'
import { createServiceClient } from '@/lib/supabase/service'
import { renderQueue } from '@/lib/render/queue'
import { lockWriteError } from './db-error'
import { errorSummary, type LockContext, type LockOutcome } from './lock-core'
import { ownedCollection } from './owned'
import { fail, THROWN, type ActionResult } from './result'

/**
 * Runs a lock or payment step for the signed-in owner of a collection, locked or not (artWrite's counterpart
 * for Lock and upload). Two clients: the creator's RLS client for the session check, the owner read and
 * everything else, and the service client for the three functions whose arguments come from the chain or a
 * verified receipt, called with the verified user's id as `p_owner`. The service client is built on first
 * use, after the ownership check, so a step that never needs it works without the key. A refusal is returned
 * as its sentence; a database error becomes the creator's sentence (`lockWriteError`); anything thrown is
 * logged and reads "Try again".
 */
export async function lockWrite<T>(
  collectionId: string,
  run: (ctx: LockContext) => Promise<LockOutcome<T>>,
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
      queue: renderQueue(),
    })
    if ('refused' in outcome) return fail(outcome.refused)
    if ('error' in outcome) return fail(lockWriteError(outcome.error))
    return { ok: true, data: outcome.data }
  } catch (error) {
    console.error(`A lock or payment step threw. ${errorSummary(error)}`)
    return fail(THROWN)
  }
}

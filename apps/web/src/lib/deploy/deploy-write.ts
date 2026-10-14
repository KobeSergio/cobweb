import 'server-only'
import { deployWriteError } from '@/lib/art/db-error'
import { errorSummary } from '@/lib/art/lock-core'
import { ownedCollection } from '@/lib/art/owned'
import { fail, THROWN, type ActionResult } from '@/lib/art/result'
import { createServiceClient } from '@/lib/supabase/service'
import type { DeployContext, DeployOutcome } from './deploy-core'

/**
 * Runs a deploy step for the signed-in owner of a collection (lockWrite's counterpart for Deploy). Two
 * clients: the creator's RLS client for the session check, the owner read and every read, and the
 * service client for `collection_record_deploy`, whose arguments come from a verified receipt, called
 * with the verified user's id as `p_owner`. The service client is built on first use, after the
 * ownership check, so a step that never needs it works without the key. A refusal is returned as its
 * sentence; a database error becomes the creator's sentence (`deployWriteError`); anything thrown is
 * logged and reads "Try again".
 */
export async function deployWrite<T>(
  collectionId: string,
  run: (ctx: DeployContext) => Promise<DeployOutcome<T>>,
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
    if ('error' in outcome) return fail(deployWriteError(outcome.error))
    return { ok: true, data: outcome.data }
  } catch (error) {
    console.error(`A deploy step threw. ${errorSummary(error)}`)
    return fail(THROWN)
  }
}

'use server'

import { errorSummary } from '@/lib/art/lock-core'
import { ownedCollection } from '@/lib/art/owned'
import { fail, SNAPSHOT_FAILED, type ActionResult } from '@/lib/art/result'
import { parse } from '@/lib/art/schemas'
import type { HolderSnapshot } from '@/lib/manage/holders'
import { fetchHoldersCore } from '@/lib/manage/snapshot-core'
import { snapshotShape } from '@/lib/manage/whitelist-schemas'

/**
 * The holder snapshot behind the shared recipients input of Whitelist and Airdrop
 * (docs/specs/2026-10-15-whitelist.md, section 6.4): the input is checked first, then the session and the
 * ownership of the collection the creator is editing (CLAUDE.md rule 4), then the chain is read on the server.
 * The pages that offer it export `maxDuration = 300`.
 */
export async function fetchHolders(
  collectionId: string,
  chainId: number,
  contract: string,
): Promise<ActionResult<HolderSnapshot>> {
  const input = parse(snapshotShape, { chainId, contract })
  if (!input.ok) return input
  try {
    const owned = await ownedCollection(collectionId)
    if (owned.error !== undefined) return fail(owned.error)
    const outcome = await fetchHoldersCore(input.data.chainId, input.data.contract)
    return 'refused' in outcome ? fail(outcome.refused) : { ok: true, data: outcome.data }
  } catch (error) {
    console.error(`A snapshot threw. ${errorSummary(error)}`)
    return fail(SNAPSHOT_FAILED)
  }
}

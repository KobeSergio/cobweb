'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getVerifiedUser } from '@/lib/auth'
import { supplyLimitError, supplySchema } from '@/lib/collections'
import { createClient } from '@/lib/supabase/server'

export type SetSupplyResult = { ok: true; supply: number } | { ok: false; error: string }

const inputSchema = z.object({
  collectionId: z.string().regex(/^[0-9a-f-]{36}$/i, 'This collection could not be found.'),
  supply: supplySchema,
})

const NOT_FOUND = 'This collection could not be found.'

/**
 * Sets a collection's supply (`max_supply`). A collection is created without one; this is where it
 * is set, for each project type:
 *   - Generative: at Generate, the sum of the per-collection sizes.
 *   - 1/1s: from the uploads, the number of files times their editions.
 *   - Single asset: the quantity on the asset screen (1 to 4,000).
 *
 * Checks the session with the auth server, that the signed-in creator owns the collection, that it
 * is still a draft, and the project type's limit. The database enforces the same rules
 * (`collections_guard_frozen_fields`, the range check and `single_asset_supply_cap`).
 */
export async function setCollectionSupply(collectionId: string, supply: number): Promise<SetSupplyResult> {
  const user = await getVerifiedUser()
  if (!user) return { ok: false, error: 'Your session has ended. Sign in again to continue.' }

  const parsed = inputSchema.safeParse({ collectionId, supply })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? NOT_FOUND }

  const supabase = await createClient()
  const { data: current } = await supabase
    .from('collections')
    .select('id, owner_id, status, project_type')
    .eq('id', parsed.data.collectionId)
    .maybeSingle()
  if (!current || current.owner_id !== user.id) return { ok: false, error: NOT_FOUND }
  if (current.status !== 'draft')
    return { ok: false, error: 'The supply cannot change after the art is locked.' }

  const overLimit = supplyLimitError(current.project_type, parsed.data.supply)
  if (overLimit) return { ok: false, error: overLimit }

  const { error } = await supabase
    .from('collections')
    .update({ max_supply: parsed.data.supply })
    .eq('id', parsed.data.collectionId)
  if (error) {
    // 23514: a check, or the frozen-field trigger if the art was locked meanwhile.
    if (error.code === '23514')
      return { ok: false, error: 'The supply can no longer change. Reload the page.' }
    return { ok: false, error: 'The supply could not be saved. Try again.' }
  }

  revalidatePath('/collections/[id]', 'layout')
  revalidatePath('/collections')
  return { ok: true, supply: parsed.data.supply }
}

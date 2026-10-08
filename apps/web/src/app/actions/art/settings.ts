'use server'

import type { TablesUpdate } from '@/lib/database.types'
import { done, type ActionResult } from '@/lib/art/result'
import { artSettings, parse, type ArtSettingsPatch } from '@/lib/art/schemas'
import { artWrite, one } from '@/lib/art/write'

/** The project's art settings: token name and description, blank traits, finishing the art later. */
export async function updateArtSettings(
  collectionId: string,
  patch: ArtSettingsPatch,
): Promise<ActionResult> {
  const input = parse(artSettings, patch)
  if (!input.ok) return input
  const change: TablesUpdate<'collections'> = {}
  if (input.data.tokenName !== undefined) change.token_name = input.data.tokenName
  if (input.data.tokenDescription !== undefined) change.token_description = input.data.tokenDescription
  if (input.data.showBlankTraits !== undefined) change.show_blank_traits = input.data.showBlankTraits
  if (input.data.artDeferred !== undefined) change.art_deferred = input.data.artDeferred
  if (Object.keys(change).length === 0) return done
  return artWrite(collectionId, ({ supabase }) =>
    one(supabase.from('collections').update(change).eq('id', collectionId).select('id')),
  )
}

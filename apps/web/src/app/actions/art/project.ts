'use server'

import type { ActionResult } from '@/lib/art/result'
import { artWrite } from '@/lib/art/write'
import { deleteObjects } from '@/lib/storage/objects'

/**
 * Empties the project's art and frees the canvas (`art_start_over`), then deletes the layer images'
 * objects. The rows are gone either way; an object left behind is collected by the orphan sweep.
 */
export async function startOver(collectionId: string): Promise<ActionResult> {
  return artWrite(collectionId, async ({ supabase }) => {
    const { data, error } = await supabase.rpc('art_start_over', { p_collection_id: collectionId })
    if (error) return { error }
    try {
      await deleteObjects(data ?? [])
    } catch {
      // Best effort: the rows are deleted, and the sweep owed to the lock sub-project removes strays.
    }
    return { data: undefined }
  })
}

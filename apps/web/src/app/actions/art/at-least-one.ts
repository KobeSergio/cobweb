'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/art/result'
import { groupTraits, parse, uuid } from '@/lib/art/schemas'
import { artWrite, created, one } from '@/lib/art/write'

/** "At least one" groups: plumbing only (spec section 2); no screen calls these yet. */
export async function addAtLeastOne(
  collectionId: string,
  artCollectionId: string,
  traitIds: string[],
): Promise<ActionResult<{ id: string }>> {
  const input = parse(z.object({ artCollectionId: uuid, traitIds: groupTraits }), {
    artCollectionId,
    traitIds,
  })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    created(
      supabase
        .from('at_least_one')
        .insert({
          collection_id: collectionId,
          art_collection_id: input.data.artCollectionId,
          trait_ids: input.data.traitIds,
        })
        .select('id')
        .single(),
    ),
  )
}

export async function updateAtLeastOne(
  collectionId: string,
  id: string,
  traitIds: string[],
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, traitIds: groupTraits }), { id, traitIds })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('at_least_one')
        .update({ trait_ids: input.data.traitIds })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

export async function deleteAtLeastOne(collectionId: string, id: string): Promise<ActionResult> {
  const input = parse(uuid, id)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('at_least_one')
        .delete()
        .eq('id', input.data)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

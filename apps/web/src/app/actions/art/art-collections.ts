'use server'

import { z } from 'zod'
import { NEW_COLLECTION_SIZE } from '@/components/art/state/collection-edits'
import type { ActionResult } from '@/lib/art/result'
import { artCollectionSize, artName, parse, uuid } from '@/lib/art/schemas'
import { artWrite, created, one, ran } from '@/lib/art/write'

/** Adds an art collection after the last one. */
export async function addArtCollection(
  collectionId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const input = parse(artName, name)
  if (!input.ok) return input
  return artWrite(collectionId, async ({ supabase }) => {
    const { data: last } = await supabase
      .from('art_collections')
      .select('position')
      .eq('collection_id', collectionId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    return created(
      supabase
        .from('art_collections')
        .insert({
          collection_id: collectionId,
          name: input.data,
          size: NEW_COLLECTION_SIZE,
          position: (last?.position ?? -1) + 1,
        })
        .select('id')
        .single(),
    )
  })
}

export async function renameArtCollection(
  collectionId: string,
  id: string,
  name: string,
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, name: artName }), { id, name })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('art_collections')
        .update({ name: input.data.name })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

export async function setArtCollectionSize(
  collectionId: string,
  id: string,
  size: number,
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, size: artCollectionSize }), { id, size })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('art_collections')
        .update({ size: input.data.size })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

/** Deletes an art collection with everything in it; the later token ids close up (`art_delete_art_collection`). */
export async function deleteArtCollection(collectionId: string, id: string): Promise<ActionResult> {
  const input = parse(uuid, id)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.rpc('art_delete_art_collection', {
        p_collection_id: collectionId,
        p_art_collection_id: input.data,
      }),
    ),
  )
}

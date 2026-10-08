'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/art/result'
import { artName, importPayload, parse, uuid, type ImportPayload, type ImportResult } from '@/lib/art/schemas'
import { artWrite, created, one, ran } from '@/lib/art/write'

/** Adds a layer on top of an art collection's stack. The database refuses while that collection has tokens. */
export async function addLayer(
  collectionId: string,
  artCollectionId: string,
  name: string,
): Promise<ActionResult<{ id: string }>> {
  const input = parse(z.object({ artCollectionId: uuid, name: artName }), { artCollectionId, name })
  if (!input.ok) return input
  return artWrite(collectionId, async ({ supabase }) => {
    const { data: top } = await supabase
      .from('layers')
      .select('position')
      .eq('art_collection_id', input.data.artCollectionId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    return created(
      supabase
        .from('layers')
        .insert({
          collection_id: collectionId,
          art_collection_id: input.data.artCollectionId,
          name: input.data.name,
          position: (top?.position ?? -1) + 1,
        })
        .select('id')
        .single(),
    )
  })
}

export async function renameLayer(
  collectionId: string,
  id: string,
  name: string,
  displayName: string | null,
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, name: artName, displayName: artName.nullable() }), {
    id,
    name,
    displayName,
  })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('layers')
        .update({ name: input.data.name, display_name: input.data.displayName })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

/** Moves a layer to `position` in its stack (`art_move_layer`); refused while the collection has tokens. */
export async function moveLayer(collectionId: string, id: string, position: number): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, position: z.number().int().min(0) }), { id, position })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.rpc('art_move_layer', {
        p_collection_id: collectionId,
        p_layer_id: input.data.id,
        p_position: input.data.position,
      }),
    ),
  )
}

/** Deletes a layer and prunes its rules and groups; `clearTokens` clears the project's tokens first. */
export async function deleteLayer(
  collectionId: string,
  id: string,
  clearTokens: boolean,
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, clearTokens: z.boolean() }), { id, clearTokens })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.rpc('art_delete_layer', {
        p_collection_id: collectionId,
        p_layer_id: input.data.id,
        p_clear_tokens: input.data.clearTokens,
      }),
    ),
  )
}

/** The folder upload's collections, layers and traits in one transaction (`art_import_layers`). */
export async function importLayers(
  collectionId: string,
  payload: ImportPayload,
): Promise<ActionResult<ImportResult>> {
  const input = parse(importPayload, payload)
  if (!input.ok) return input
  return artWrite<ImportResult>(collectionId, async ({ supabase }) => {
    const { data, error } = await supabase.rpc('art_import_layers', {
      p_collection_id: collectionId,
      p_payload: input.data,
    })
    if (error) return { error }
    return { data: data as unknown as ImportResult }
  })
}

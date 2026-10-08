'use server'

import { z } from 'zod'
import type { ActionResult } from '@/lib/art/result'
import type { WeightRow } from '@/lib/art/rows'
import { newTraits, parse, traitName, uuid, weightTable, type NewTraitInput } from '@/lib/art/schemas'
import { artWrite, created, one, ran } from '@/lib/art/write'

/** Adds stored images to a layer as traits at 0%, after its last trait. Returns their ids in order. */
export async function addTraits(
  collectionId: string,
  layerId: string,
  items: NewTraitInput[],
): Promise<ActionResult<{ ids: string[] }>> {
  const input = parse(z.object({ layerId: uuid, items: newTraits }), { layerId, items })
  if (!input.ok) return input
  return artWrite<{ ids: string[] }>(collectionId, async ({ supabase }) => {
    const { data: top } = await supabase
      .from('traits')
      .select('position')
      .eq('layer_id', input.data.layerId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    const first = (top?.position ?? -1) + 1
    const { data, error } = await supabase
      .from('traits')
      .insert(
        input.data.items.map((item, i) => ({
          collection_id: collectionId,
          layer_id: input.data.layerId,
          name: item.name,
          weight: 0,
          upload_id: item.uploadId,
          position: first + i,
        })),
      )
      .select('id, position')
    if (error) return { error }
    return { data: { ids: [...data].sort((a, b) => a.position - b.position).map((row) => row.id) } }
  })
}

export async function renameTrait(collectionId: string, id: string, name: string): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, name: traitName }), { id, name })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('traits')
        .update({ name: input.data.name })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

/** The layer's whole weight table, checked as one (`art_set_layer_weights`). */
export async function setLayerWeights(
  collectionId: string,
  layerId: string,
  rows: WeightRow[],
): Promise<ActionResult> {
  const input = parse(z.object({ layerId: uuid, rows: weightTable }), { layerId, rows })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(
      supabase.rpc('art_set_layer_weights', {
        p_collection_id: collectionId,
        p_layer_id: input.data.layerId,
        p_rows: input.data.rows,
      }),
    ),
  )
}

/** Adds the layer's blank trait at 0% (returning its id), or deletes it like any trait. */
export async function setBlank(
  collectionId: string,
  layerId: string,
  on: boolean,
): Promise<ActionResult<{ id: string | null }>> {
  const input = parse(z.object({ layerId: uuid, on: z.boolean() }), { layerId, on })
  if (!input.ok) return input
  return artWrite(collectionId, async ({ supabase }) => {
    const { data: blank } = await supabase
      .from('traits')
      .select('id')
      .eq('layer_id', input.data.layerId)
      .eq('blank', true)
      .maybeSingle()
    if (!input.data.on) {
      if (!blank) return { data: { id: null } }
      const { error } = await supabase.rpc('art_delete_trait', {
        p_collection_id: collectionId,
        p_trait_id: blank.id,
      })
      return error ? { error } : { data: { id: null } }
    }
    if (blank) return { data: { id: blank.id } }
    const { data: top } = await supabase
      .from('traits')
      .select('position')
      .eq('layer_id', input.data.layerId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle()
    return created(
      supabase
        .from('traits')
        .insert({
          collection_id: collectionId,
          layer_id: input.data.layerId,
          name: 'None',
          weight: 0,
          blank: true,
          position: (top?.position ?? -1) + 1,
        })
        .select('id')
        .single(),
    )
  })
}

export async function setTraitMetadata(
  collectionId: string,
  id: string,
  inMetadata: boolean,
): Promise<ActionResult> {
  const input = parse(z.object({ id: uuid, inMetadata: z.boolean() }), { id, inMetadata })
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('traits')
        .update({ in_metadata: input.data.inMetadata })
        .eq('id', input.data.id)
        .eq('collection_id', collectionId)
        .select('id'),
    ),
  )
}

/** Deletes a trait, prunes the rules and groups that named it and closes its layer's positions. */
export async function deleteTrait(collectionId: string, id: string): Promise<ActionResult> {
  const input = parse(uuid, id)
  if (!input.ok) return input
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.rpc('art_delete_trait', { p_collection_id: collectionId, p_trait_id: input.data })),
  )
}

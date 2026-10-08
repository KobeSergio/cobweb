'use server'

import { z } from 'zod'
import type { TablesUpdate } from '@/lib/database.types'
import { done, type ActionResult } from '@/lib/art/result'
import { assetOrder, assetPatch, parse, uuid, type AssetOrderRow, type AssetPatch } from '@/lib/art/schemas'
import { artWrite, one, ran } from '@/lib/art/write'

/** One file's editions and attributes. */
export async function updateAsset(
  collectionId: string,
  uploadId: string,
  patch: AssetPatch,
): Promise<ActionResult> {
  const input = parse(z.object({ uploadId: uuid, patch: assetPatch }), { uploadId, patch })
  if (!input.ok) return input
  const change: TablesUpdate<'uploads'> = {}
  if (input.data.patch.quantity !== undefined) change.quantity = input.data.patch.quantity
  if (input.data.patch.attributes !== undefined) change.attributes = input.data.patch.attributes
  if (Object.keys(change).length === 0) return done
  return artWrite(collectionId, ({ supabase }) =>
    one(
      supabase
        .from('uploads')
        .update(change)
        .eq('id', input.data.uploadId)
        .eq('collection_id', collectionId)
        .eq('kind', 'asset')
        .select('id'),
    ),
  )
}

/** The files' list order, which the token ids follow (`art_set_asset_order`). */
export async function setAssetOrder(collectionId: string, rows: AssetOrderRow[]): Promise<ActionResult> {
  const input = parse(assetOrder, rows)
  if (!input.ok) return input
  if (input.data.length === 0) return done
  return artWrite(collectionId, ({ supabase }) =>
    ran(supabase.rpc('art_set_asset_order', { p_collection_id: collectionId, p_rows: input.data })),
  )
}

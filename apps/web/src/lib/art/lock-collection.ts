import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Tables } from '@/lib/database.types'

/**
 * The Supabase client the lock code runs on: the signed-in creator's, so row-level security applies.
 * The server actions pass their session client; `verify:chain` passes a signed-in script client.
 */
export type LockClient = SupabaseClient<Database>

export const LOCK_COLLECTION_COLUMNS =
  'id, owner_id, name, symbol, slug, slug_reserved_at, project_type, status, art_deferred, art_locked_at, chain_id, max_supply, token_name, token_description, show_blank_traits, generation_seed, canvas_width, canvas_height'

/** The collection columns the lock, pay and deploy code reads. */
export type LockCollection = Pick<
  Tables<'collections'>,
  | 'id'
  | 'owner_id'
  | 'name'
  | 'symbol'
  | 'slug'
  | 'slug_reserved_at'
  | 'project_type'
  | 'status'
  | 'art_deferred'
  | 'art_locked_at'
  | 'chain_id'
  | 'max_supply'
  | 'token_name'
  | 'token_description'
  | 'show_blank_traits'
  | 'generation_seed'
  | 'canvas_width'
  | 'canvas_height'
>

/** The collection under row-level security, or null when the caller cannot see it. */
export async function readLockCollection(
  supabase: LockClient,
  collectionId: string,
): Promise<LockCollection | null> {
  const { data, error } = await supabase
    .from('collections')
    .select(LOCK_COLLECTION_COLUMNS)
    .eq('id', collectionId)
    .maybeSingle()
  if (error) throw new Error(`The collection could not be read: ${error.message}`)
  return data
}

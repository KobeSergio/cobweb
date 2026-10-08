import 'server-only'
import { getVerifiedUser } from '@/lib/auth'
import type { Tables } from '@/lib/database.types'
import type { Canvas } from '@/lib/storage/admission'
import { createClient } from '@/lib/supabase/server'
import { LOCKED, NOT_FOUND, SIGNED_OUT } from './result'

export type ArtClient = Awaited<ReturnType<typeof createClient>>

/** The collection columns an Art action may need besides ownership. */
export type OwnedCollection = Pick<
  Tables<'collections'>,
  | 'id'
  | 'project_type'
  | 'token_name'
  | 'token_description'
  | 'show_blank_traits'
  | 'generation_seed'
  | 'art_deferred'
>

export type Owned =
  { error: string } | { error?: undefined; supabase: ArtClient; canvas: Canvas; collection: OwnedCollection }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The collection, only if the signed-in creator owns it and its art is not locked. The session is
 * confirmed with the auth server, the row is read under row-level security, and the explicit owner
 * test is a second line of defence. The database checks both again on every write.
 */
export async function ownedUnlocked(collectionId: string): Promise<Owned> {
  const user = await getVerifiedUser()
  if (!user) return { error: SIGNED_OUT }
  if (!UUID.test(collectionId)) return { error: NOT_FOUND }
  const supabase = await createClient()
  const { data } = await supabase
    .from('collections')
    .select(
      'id, owner_id, art_locked_at, canvas_width, canvas_height, project_type, token_name, token_description, show_blank_traits, generation_seed, art_deferred',
    )
    .eq('id', collectionId)
    .maybeSingle()
  if (!data || data.owner_id !== user.id) return { error: NOT_FOUND }
  if (data.art_locked_at) return { error: LOCKED }
  const canvas =
    data.canvas_width && data.canvas_height ? { width: data.canvas_width, height: data.canvas_height } : null
  const collection: OwnedCollection = {
    id: data.id,
    project_type: data.project_type,
    token_name: data.token_name,
    token_description: data.token_description,
    show_blank_traits: data.show_blank_traits,
    generation_seed: data.generation_seed,
    art_deferred: data.art_deferred,
  }
  return { supabase, canvas, collection }
}

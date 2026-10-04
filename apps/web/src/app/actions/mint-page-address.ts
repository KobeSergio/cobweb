'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getVerifiedUser } from '@/lib/auth'
import { slugSchema } from '@/lib/collections'
import { createClient } from '@/lib/supabase/server'

export type ReserveSlugResult =
  { ok: true; slug: string; reservedAt: string | null } | { ok: false; error: string }

const inputSchema = z.object({
  collectionId: z.string().regex(/^[0-9a-f-]{36}$/i),
  slug: slugSchema,
})

/**
 * Reserves a mint page link for a collection the signed-in creator owns. Before deploy the
 * reservation lasts 3 days; on a deployed collection without a link it is kept at once.
 * The database function `reserve_slug` checks ownership again, takes over a lapsed reservation and
 * (until a migration allows it) refuses to change the link of a deployed collection.
 */
export async function reserveSlug(collectionId: string, slug: string): Promise<ReserveSlugResult> {
  const user = await getVerifiedUser()
  if (!user) return { ok: false, error: 'Your session has ended. Sign in again to continue.' }

  const parsed = inputSchema.safeParse({ collectionId, slug })
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      ok: false,
      error: issue?.path[0] === 'slug' ? issue.message : 'This collection could not be found.',
    }
  }

  const supabase = await createClient()
  const { data: current } = await supabase
    .from('collections')
    .select('id, owner_id')
    .eq('id', parsed.data.collectionId)
    .maybeSingle()
  if (!current || current.owner_id !== user.id)
    return { ok: false, error: 'This collection could not be found.' }

  const { error } = await supabase.rpc('reserve_slug', {
    p_collection_id: parsed.data.collectionId,
    p_slug: parsed.data.slug,
  })
  if (error) {
    // 23505: a live reservation or a deployed collection holds it. P0001: the link is fixed.
    if (error.code === '23505') return { ok: false, error: 'That link is taken. Choose another.' }
    if (error.code === 'P0001')
      return { ok: false, error: 'The link of a deployed collection cannot be changed yet.' }
    if (error.code === '23514') return { ok: false, error: 'That link cannot be used. Choose another.' }
    return { ok: false, error: 'The link could not be saved. Try again.' }
  }

  const { data: saved } = await supabase
    .from('collections')
    .select('slug, slug_reserved_at')
    .eq('id', parsed.data.collectionId)
    .maybeSingle()

  revalidatePath('/collections/[id]', 'layout')
  return { ok: true, slug: saved?.slug ?? parsed.data.slug, reservedAt: saved?.slug_reserved_at ?? null }
}

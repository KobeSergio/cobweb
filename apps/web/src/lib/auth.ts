import 'server-only'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/database.types'

export type SessionUser = {
  id: string
  /** Lowercase hex address of the wallet that signed in. */
  walletAddress: string
}

/**
 * The signed-in creator, or null. The token is verified, not just decoded, and the wallet address
 * comes from the `profiles` row the database created from the verified sign-in identity.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getClaims()
  const userId = data?.claims?.sub
  if (error || !userId) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('wallet_address')
    .eq('id', userId)
    .maybeSingle()
  if (!profile) return null

  return { id: userId, walletAddress: profile.wallet_address }
})

/**
 * For anything that changes data: the signed-in creator, confirmed with the auth server.
 * `getSessionUser` verifies the token's signature and expiry locally, which is right for reading,
 * but a token stays valid until it expires even after sign-out. This asks the server, so a
 * signed-out or revoked session is refused at once.
 */
export async function getVerifiedUser(): Promise<SessionUser | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.auth.getUser()
  if (error || !data.user) return null
  return getSessionUser()
}

/** For pages and layouts: the signed-in creator, or a redirect to the sign-in screen. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()
  if (!user) redirect('/')
  return user
}

/**
 * For anything that touches one collection: the collection, only if the signed-in creator owns
 * it. Row-level security already hides other creators' rows; the explicit owner check is a second
 * line of defence. A collection that does not exist and one that belongs to someone else both
 * end in the same 404, so ids cannot be probed.
 */
export const requireOwnedCollection = cache(async (collectionId: string): Promise<Tables<'collections'>> => {
  const user = await requireUser()
  if (!/^[0-9a-f-]{36}$/i.test(collectionId)) notFound()

  const supabase = await createClient()
  const { data: collection } = await supabase
    .from('collections')
    .select('*')
    .eq('id', collectionId)
    .maybeSingle()
  if (!collection || collection.owner_id !== user.id) notFound()

  return collection
})

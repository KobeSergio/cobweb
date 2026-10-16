import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { unstable_cache } from 'next/cache'
import { getSessionUser } from '@/lib/auth'
import type { Database } from '@/lib/database.types'
import { createClient as createSessionClient } from '@/lib/supabase/server'
import { pageDocSchema, pageStaticOf, type MintPageStatic } from './page-doc'
import { ipfsGateway, mediaUrl, mintPageTag } from './page-urls'

export { ipfsGateway, mediaBase, mediaUrl, mintPageTag } from './page-urls'

/**
 * The public page's read (docs/specs/2026-10-16-mint-page-live-data.md, section 6.1): the document of a
 * published page through a client with no session, cached under the link's tag for 60 s, so the database sees
 * one read per link a minute whatever the number of visitors; and the owner's preview through the session,
 * uncached. Keys become URLs on the public media base; token art is read through the IPFS gateway (both in
 * page-urls.ts, re-exported here).
 */

/** The publishable key's client, with no session: every visitor reads the same document. */
function publicClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  )
}

const pageOf = (raw: unknown) =>
  pageStaticOf(pageDocSchema.parse(raw), { media: mediaUrl, gateway: ipfsGateway() })

/** The links are lowercase, so `/Night-Owls` reads and is tagged as `night-owls`. */
const linkOf = (slug: string) => slug.trim().toLowerCase()

/**
 * The published page at a link, or null. A failed read throws, so the cached page keeps being served; a
 * document that does not parse throws too.
 */
export async function readMintPage(slug: string): Promise<MintPageStatic | null> {
  const link = linkOf(slug)
  const raw = await unstable_cache(
    async () => {
      const { data, error } = await publicClient().rpc('mint_page', { p_slug: link })
      if (error) throw new Error(`The mint page could not be read: ${error.code} ${error.message}`)
      return data
    },
    ['mint-page', link],
    { tags: [mintPageTag(link)], revalidate: 60 },
  )()
  return raw === null ? null : pageOf(raw)
}

/**
 * The page at a link for its signed-in owner, published or not, with the collection's id for the way back to the
 * Mint page tab; null for anyone else. Uncached.
 */
export async function readMintPagePreview(
  slug: string,
): Promise<(MintPageStatic & { published: boolean; collectionId: string }) | null> {
  // A signed-out visitor gets the not-found page: the function is granted to signed-in callers only.
  if (!(await getSessionUser())) return null
  const supabase = await createSessionClient()
  const link = linkOf(slug)
  const { data, error } = await supabase.rpc('mint_page_preview', { p_slug: link })
  if (error) throw new Error(`The mint page preview could not be read: ${error.code} ${error.message}`)
  if (data === null) return null
  const page = pageOf(data)
  const owned = await supabase.from('collections').select('id').eq('slug', link).maybeSingle()
  if (owned.error) throw new Error(`The collection could not be read: ${owned.error.message}`)
  if (!page || !owned.data) return null
  return { ...page, published: pageDocSchema.parse(data).published, collectionId: owned.data.id }
}

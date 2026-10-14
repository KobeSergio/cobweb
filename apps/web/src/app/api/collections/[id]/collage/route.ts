import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { renderBucket } from '@/lib/storage/config'
import { presignGet } from '@/lib/storage/objects'

/**
 * Serves a collection's preview collage (docs/specs/2026-10-14-render-screen-wiring.md, section 7), as
 * the uploads route serves a file: the session is checked (verified locally; row-level security does
 * the access control), the latest finished real job's collage key is read under the creator's client
 * (another creator's collection, a job without a collage and nothing finished are all a 404), and the
 * answer is a redirect to a signed URL on the render bucket, good for an hour.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 })
  const user = await getSessionUser()
  if (!user) return new NextResponse(null, { status: 404 })
  const supabase = await createClient()
  const { data: row } = await supabase
    .from('render_jobs')
    .select('collage_key')
    .eq('collection_id', id)
    .eq('kind', 'real')
    .eq('state', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!row?.collage_key) return new NextResponse(null, { status: 404 })
  const url = await presignGet(row.collage_key, 3600, { bucket: renderBucket() })
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=3000' } })
}

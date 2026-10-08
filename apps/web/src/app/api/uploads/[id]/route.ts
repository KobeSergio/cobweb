import { NextResponse, type NextRequest } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { storageKey } from '@/lib/storage/keys'
import { presignGet } from '@/lib/storage/objects'

/**
 * Serves a creator's stored file: checks the session (verified locally; row-level security does the
 * access control), reads the row under RLS (so another
 * creator's file is a 404, not a 403), and redirects to a signed URL good for an hour. With
 * `?variant=thumb` it serves the browser-made thumbnail when there is one, else the original.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse(null, { status: 404 })
  const user = await getSessionUser()
  if (!user) return new NextResponse(null, { status: 404 })
  const supabase = await createClient()
  const { data: row } = await supabase
    .from('uploads')
    .select('id, collection_id, kind, storage_key, content_hash, mime')
    .eq('id', id)
    .maybeSingle()
  if (!row) return new NextResponse(null, { status: 404 })

  let key = row.storage_key
  if (request.nextUrl.searchParams.get('variant') === 'thumb' && row.kind !== 'thumbnail') {
    const { data: thumb } = await supabase
      .from('uploads')
      .select('storage_key')
      .eq('collection_id', row.collection_id)
      .eq('kind', 'thumbnail')
      .eq('storage_key', storageKey(row.collection_id, 'thumbnail', row.content_hash, 'image/webp'))
      .maybeSingle()
    if (thumb) key = thumb.storage_key
  }
  const url = await presignGet(key, 3600)
  return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=3000' } })
}

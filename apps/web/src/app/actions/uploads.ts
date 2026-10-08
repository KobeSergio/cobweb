'use server'

import { getVerifiedUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { admissionProblem, capProblem, type Canvas } from '@/lib/storage/admission'
import { mediaTypeFor, storageKey } from '@/lib/storage/keys'
import { deleteObjects, headObject, presignPut } from '@/lib/storage/objects'
import {
  admissionInputProblem,
  toRecord,
  type AdmitInput,
  type AdmitResult,
  type ConfirmInput,
  type UploadRecord,
  type UploadRow,
} from '@/lib/storage/uploads-service'

const SIGNED_OUT = 'Your session has ended. Sign in again to continue.'
const NOT_FOUND = 'This collection could not be found.'
const LOCKED = 'The art is locked and cannot change.'
const ROW_COLUMNS = 'id, kind, file_name, mime, media_type, bytes, width, height, content_hash'

/** The collection, only if the signed-in creator owns it and its art is not locked. */
async function ownedUnlocked(
  collectionId: string,
): Promise<
  | { error: string }
  | { error?: undefined; supabase: Awaited<ReturnType<typeof createClient>>; canvas: Canvas }
> {
  const user = await getVerifiedUser()
  if (!user) return { error: SIGNED_OUT }
  const supabase = await createClient()
  const { data } = await supabase
    .from('collections')
    .select('id, owner_id, art_locked_at, canvas_width, canvas_height')
    .eq('id', collectionId)
    .maybeSingle()
  if (!data || data.owner_id !== user.id) return { error: NOT_FOUND }
  if (data.art_locked_at) return { error: LOCKED }
  const canvas =
    data.canvas_width && data.canvas_height ? { width: data.canvas_width, height: data.canvas_height } : null
  return { supabase, canvas }
}

async function thumbnailRowFor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  collectionId: string,
  hash: string,
) {
  const { data } = await supabase
    .from('uploads')
    .select('id')
    .eq('collection_id', collectionId)
    .eq('kind', 'thumbnail')
    .eq('storage_key', storageKey(collectionId, 'thumbnail', hash, 'image/webp'))
    .maybeSingle()
  return data
}

export async function admitUpload(input: AdmitInput): Promise<AdmitResult | { error: string }> {
  const shape = admissionInputProblem(input)
  if (shape) return { error: shape }
  const ctx = await ownedUnlocked(input.collectionId)
  if (ctx.error !== undefined) return { error: ctx.error }
  const { supabase, canvas } = ctx

  const problem = admissionProblem(input.kind, input, canvas)
  if (problem) return { error: problem }
  if (input.thumbnail) {
    const thumb = admissionProblem('thumbnail', input.thumbnail, null)
    if (thumb) return { error: `Thumbnail: ${thumb}` }
  }

  const { data: existing } = await supabase
    .from('uploads')
    .select(ROW_COLUMNS)
    .eq('collection_id', input.collectionId)
    .eq('content_hash', input.contentHash)
    .eq('kind', input.kind)
    .maybeSingle()
  if (existing) {
    const thumb = await thumbnailRowFor(supabase, input.collectionId, input.contentHash)
    return { existing: true, upload: toRecord(existing as UploadRow, !!thumb) }
  }

  const { data: used } = await supabase
    .from('uploads')
    .select('bytes')
    .eq('collection_id', input.collectionId)
  const usedBytes = (used ?? []).reduce((sum, row) => sum + Number(row.bytes), 0)
  const cap = capProblem(usedBytes, input.bytes + (input.thumbnail?.bytes ?? 0))
  if (cap) return { error: cap }

  const key = storageKey(input.collectionId, input.kind, input.contentHash, input.mime)
  const putUrl = await presignPut(key, input.mime, input.bytes)
  let thumbnail: { key: string; putUrl: string } | null = null
  if (input.thumbnail) {
    // The thumbnail is named after the original's hash so the two pair without a join.
    const thumbKey = storageKey(input.collectionId, 'thumbnail', input.contentHash, 'image/webp')
    thumbnail = { key: thumbKey, putUrl: await presignPut(thumbKey, 'image/webp', input.thumbnail.bytes) }
  }
  return { existing: false, key, putUrl, thumbnail }
}

const INCOMPLETE = 'The upload did not arrive in full. Try again.'
const CAP_SENTENCE = 'This project has reached its 5 GB of files. Delete some files to upload more.'
const CANVAS_SENTENCE = /^Every layer image must be \d+ x \d+ in this project\.$/

/** An error from `record_upload`, by SQLSTATE, in the creator's words. 23505 is handled by callers. */
function recordError(error: { code?: string; message: string }): string {
  if (error.code === '42501') return LOCKED
  if (error.code === '23514') {
    if (error.message.startsWith('This project has reached')) return CAP_SENTENCE
    if (CANVAS_SENTENCE.test(error.message)) return error.message
  }
  return INCOMPLETE
}

/**
 * Records an upload after its PUT. The server checks what it can see (the object exists with the
 * declared size and type); the content hash is the client's word, which only affects dedupe inside
 * this creator's own project. A row is written only through `record_upload`, which also enforces
 * the 5 GB cap and the shared canvas size under the collection's row lock.
 */
export async function confirmUpload(
  input: ConfirmInput,
): Promise<{ upload: UploadRecord } | { error: string }> {
  const shape = admissionInputProblem(input)
  if (shape) return { error: shape }
  const ctx = await ownedUnlocked(input.collectionId)
  if (ctx.error !== undefined) return { error: ctx.error }
  const { supabase, canvas } = ctx
  const problem = admissionProblem(input.kind, input, canvas)
  if (problem) return { error: problem }

  const expectedKey = storageKey(input.collectionId, input.kind, input.contentHash, input.mime)
  if (input.key !== expectedKey) return { error: INCOMPLETE }
  const head = await headObject(input.key)
  if (!head || head.bytes !== input.bytes || head.mime !== input.mime) return { error: INCOMPLETE }

  // A thumbnail that did not arrive in full is dropped; the original is still recorded without it.
  let thumbnail: ConfirmInput['thumbnail'] = null
  if (input.thumbnail && input.thumbnailKey) {
    const thumbKey = storageKey(input.collectionId, 'thumbnail', input.contentHash, 'image/webp')
    if (input.thumbnailKey === thumbKey) {
      const thumbHead = await headObject(thumbKey)
      if (thumbHead && thumbHead.bytes === input.thumbnail.bytes && thumbHead.mime === 'image/webp')
        thumbnail = input.thumbnail
    }
  }

  // The readable path; record_upload enforces the same cap under a lock.
  const { data: used } = await supabase
    .from('uploads')
    .select('bytes')
    .eq('collection_id', input.collectionId)
  const usedBytes = (used ?? []).reduce((sum, row) => sum + Number(row.bytes), 0)
  const cap = capProblem(usedBytes, input.bytes)
  if (cap) return { error: cap }

  const record = (
    kind: AdmitInput['kind'] | 'thumbnail',
    key: string,
    mime: string,
    bytes: number,
    width: number | null,
    height: number | null,
  ) =>
    supabase.rpc('record_upload', {
      p_collection_id: input.collectionId,
      p_kind: kind,
      p_storage_key: key,
      // The thumbnail shares its original's hash, so the unique index pairs the two.
      p_content_hash: input.contentHash,
      p_mime: mime,
      p_media_type: mediaTypeFor(mime),
      p_bytes: bytes,
      // The generated types mark these required; the function takes null for videos and GIFs.
      p_width: width as number,
      p_height: height as number,
      p_file_name: input.fileName,
    })

  const main = await record(input.kind, input.key, input.mime, input.bytes, input.width, input.height)
  let id = main.data as string | null
  if (main.error) {
    if (main.error.code !== '23505') return { error: recordError(main.error) }
    // Two tabs admitted the same file: the first one's row wins and this one reuses it.
    const { data } = await supabase
      .from('uploads')
      .select('id')
      .eq('collection_id', input.collectionId)
      .eq('content_hash', input.contentHash)
      .eq('kind', input.kind)
      .maybeSingle()
    id = data?.id ?? null
  }
  if (!id) return { error: INCOMPLETE }

  let hasThumbnail = false
  if (thumbnail && input.thumbnailKey) {
    const thumb = await record(
      'thumbnail',
      input.thumbnailKey,
      'image/webp',
      thumbnail.bytes,
      thumbnail.width,
      thumbnail.height,
    )
    hasThumbnail = !thumb.error || thumb.error.code === '23505'
  }
  const { data: row, error: rowError } = await supabase
    .from('uploads')
    .select(ROW_COLUMNS)
    .eq('id', id)
    .single()
  if (rowError || !row) return { error: INCOMPLETE }
  return { upload: toRecord(row as UploadRow, hasThumbnail) }
}

export async function deleteUpload(uploadId: string): Promise<{ ok: true } | { error: string }> {
  const user = await getVerifiedUser()
  if (!user) return { error: SIGNED_OUT }
  const supabase = await createClient()
  const { data: row } = await supabase
    .from('uploads')
    .select('id, collection_id, kind, storage_key, content_hash')
    .eq('id', uploadId)
    .maybeSingle()
  if (!row) return { error: 'This file could not be found.' }
  const thumb = await thumbnailRowFor(supabase, row.collection_id, row.content_hash)
  const { error } = await supabase.from('uploads').delete().eq('id', row.id)
  if (error) {
    if (error.code === '23503')
      return {
        error:
          row.kind === 'layer_image'
            ? 'This image is used by a trait. Remove the trait first.'
            : 'This file is still in use. Remove it from where it is used first.',
      }
    if (error.code === '42501') return { error: LOCKED }
    return { error: 'The file could not be deleted. Try again.' }
  }
  const keys = [row.storage_key]
  if (thumb) {
    const { error: thumbError } = await supabase.from('uploads').delete().eq('id', thumb.id)
    if (thumbError) return { error: 'The file could not be deleted. Try again.' }
    keys.push(storageKey(row.collection_id, 'thumbnail', row.content_hash, 'image/webp'))
  }
  try {
    await deleteObjects(keys)
  } catch {
    // The rows are gone; a later sweep collects orphaned objects.
  }
  return { ok: true }
}

import type { UploadKind } from './keys'

export type UploadRecord = {
  id: string
  kind: UploadKind
  fileName: string
  mime: string
  mediaType: 'image' | 'gif' | 'video'
  bytes: number
  width: number | null
  height: number | null
  /** Served through the app, which checks the session and redirects to a signed URL. */
  url: string
  thumbnailUrl: string | null
}

export type UploadRow = {
  id: string
  kind: UploadKind
  file_name: string
  mime: string
  media_type: 'image' | 'gif' | 'video'
  bytes: number
  width: number | null
  height: number | null
  content_hash: string
}

export type ThumbnailInput = {
  mime: 'image/webp'
  bytes: number
  width: number
  height: number
  contentHash: string
}

export type AdmitResult =
  | { existing: true; upload: UploadRecord }
  | { existing: false; key: string; putUrl: string; thumbnail: { key: string; putUrl: string } | null }

export type AdmitInput = {
  collectionId: string
  kind: 'layer_image' | 'asset' | 'placeholder'
  fileName: string
  mime: string
  bytes: number
  width: number | null
  height: number | null
  contentHash: string
  thumbnail: ThumbnailInput | null
}

export type ConfirmInput = AdmitInput & { key: string; thumbnailKey: string | null }

export function servedUrl(id: string, variant?: 'thumb'): string {
  return variant ? `/api/uploads/${id}?variant=thumb` : `/api/uploads/${id}`
}

export function toRecord(row: UploadRow, hasThumbnail: boolean): UploadRecord {
  return {
    id: row.id,
    kind: row.kind,
    fileName: row.file_name,
    mime: row.mime,
    mediaType: row.media_type,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    url: servedUrl(row.id),
    thumbnailUrl: hasThumbnail ? servedUrl(row.id, 'thumb') : null,
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/

/** Shape problems the admission rules do not cover, in the creator's words or null. */
export function admissionInputProblem(input: AdmitInput): string | null {
  if (!UUID.test(input.collectionId)) return 'This collection could not be found.'
  if ((input.kind as string) === 'thumbnail')
    return 'Thumbnails are uploaded with their image, not on their own.'
  if (!['layer_image', 'asset', 'placeholder'].includes(input.kind))
    return 'This kind of file is not accepted.'
  if (!input.fileName.trim()) return 'The file needs a name.'
  if (input.fileName.length > 255) return 'The file name is too long (255 characters at most).'
  if (!HASH.test(input.contentHash)) return 'The file could not be hashed. Try again.'
  if (input.thumbnail && !HASH.test(input.thumbnail.contentHash))
    return 'The file could not be hashed. Try again.'
  return null
}

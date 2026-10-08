/**
 * Object keys for a project's files: `<collection id>/<folder>/<sha256>.<ext>`. The database's
 * `uploads.storage_key` check enforces this exact shape, and `record_upload` pins the first
 * segment to the collection, so a key can never point outside its project.
 */

export type UploadKind = 'layer_image' | 'asset' | 'placeholder' | 'thumbnail'

const FOLDER: Record<UploadKind, string> = {
  layer_image: 'layers',
  asset: 'assets',
  placeholder: 'placeholders',
  thumbnail: 'thumbnails',
}

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
}

export const ACCEPTED_MIME = Object.keys(EXTENSION)

export function extensionFor(mime: string): string {
  const ext = EXTENSION[mime]
  if (!ext) throw new Error(`Unsupported file type: ${mime}`)
  return ext
}

export function mediaTypeFor(mime: string): 'image' | 'gif' | 'video' {
  if (mime === 'video/mp4') return 'video'
  if (mime === 'image/gif') return 'gif'
  return 'image'
}

export function storageKey(
  collectionId: string,
  kind: UploadKind,
  contentHash: string,
  mime: string,
): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error('A content hash is 64 lowercase hex characters.')
  return `${collectionId}/${FOLDER[kind]}/${contentHash}.${extensionFor(mime)}`
}

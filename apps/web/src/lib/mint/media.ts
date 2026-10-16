import type { FileFacts } from '@/lib/storage/admission'

/**
 * The mint page's media (docs/specs/2026-10-16-mint-page-live-data.md, section 4.4), pure, for the browser
 * and the server: what each slot takes and up to what size, the key of a file in the mint-page bucket, and
 * whether a key is the collection's. No SVG: a file on a public origin can carry script.
 */
export type MediaSlot = 'banner' | 'avatar' | 'about' | 'team' | 'slide' | 'music'

const MB = 1024 * 1024
const IMAGES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
const capOf = (types: readonly string[], bytes: number): Record<string, number> =>
  Object.fromEntries(types.map((type) => [type, bytes]))

export const MEDIA_SLOTS: Record<
  MediaSlot,
  { types: readonly string[]; maxBytes: Record<string, number>; minSide?: number }
> = {
  banner: { types: IMAGES, maxBytes: capOf(IMAGES, 5 * MB) },
  about: { types: IMAGES, maxBytes: capOf(IMAGES, 5 * MB) },
  avatar: { types: IMAGES, maxBytes: capOf(IMAGES, 2 * MB), minSide: 400 },
  team: { types: IMAGES, maxBytes: capOf(IMAGES, 2 * MB) },
  slide: {
    types: [...IMAGES, 'video/mp4'],
    maxBytes: { ...capOf(IMAGES, 5 * MB), 'video/mp4': 20 * MB },
  },
  music: { types: ['audio/mpeg'], maxBytes: { 'audio/mpeg': 20 * MB } },
}

/** The extension each type is stored under, as the database's key check expects it. */
const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'audio/mpeg': 'mp3',
}

const IMAGE_TYPES = 'Use a PNG, JPG, WebP or GIF image.'
const TYPE_SENTENCE: Record<MediaSlot, string> = {
  banner: IMAGE_TYPES,
  about: IMAGE_TYPES,
  avatar: IMAGE_TYPES,
  team: IMAGE_TYPES,
  slide: 'Use a PNG, JPG, WebP or GIF image, or an MP4 video.',
  music: 'Use an MP3 file.',
}

const mb = (bytes: number) => Math.ceil(bytes / MB)

/** Why a file cannot go in a slot, in the creator's words, or null. The browser and the signing action both ask. */
export function mintPageMediaProblem(slot: MediaSlot, file: FileFacts): string | null {
  const rule = MEDIA_SLOTS[slot]
  if (!rule.types.includes(file.mime)) return TYPE_SENTENCE[slot]
  if (file.bytes < 1) return 'The file is empty.'
  const max = rule.maxBytes[file.mime] ?? 0
  if (file.bytes > max) return `${mb(file.bytes)} MB is over the ${mb(max)} MB limit.`
  if (
    rule.minSide !== undefined &&
    (file.width === null || file.height === null || Math.min(file.width, file.height) < rule.minSide)
  )
    return `The avatar must be at least ${rule.minSide} by ${rule.minSide}.`
  return null
}

/** A file's key in the mint-page bucket: `<collection id>/<sha256>.<ext>`, so an object never changes its bytes. */
export function mintPageKey(collectionId: string, contentHash: string, mime: string): string {
  if (!/^[0-9a-f]{64}$/.test(contentHash)) throw new Error('A content hash is 64 lowercase hex characters.')
  const extension = EXTENSION[mime]
  if (!extension) throw new Error(`Unsupported file type: ${mime}`)
  return `${collectionId}/${contentHash}.${extension}`
}

/** Whether a key is one of the collection's in the mint-page bucket, of a type the slot takes. */
export function keyBelongs(collectionId: string, key: string, slot: MediaSlot): boolean {
  if (!/^[0-9a-f-]{36}$/.test(collectionId)) return false
  const extensions = MEDIA_SLOTS[slot].types.map((type) => EXTENSION[type]).join('|')
  return new RegExp(`^${collectionId}/[0-9a-f]{64}\\.(${extensions})$`).test(key)
}

/** The type a key's extension stands for, or null. */
export function mimeOfKey(key: string): string | null {
  const extension = key.slice(key.lastIndexOf('.') + 1)
  return Object.keys(EXTENSION).find((type) => EXTENSION[type] === extension) ?? null
}

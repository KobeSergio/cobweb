/**
 * Browser-side checks for a single-asset file or a pre-reveal placeholder (decision D28): an
 * image (PNG, JPG, WebP), a GIF or an MP4 video, each with its own size limit. 1/1s and metadata
 * projects take images only and use `ASSET_IMAGE_RULES` instead.
 *
 * Seam: when uploads go to storage (Phase 3), the server repeats these checks on the stored
 * object, and the render pipeline passes a video or GIF through without compositing (Phase 4).
 */
import type { MediaType } from '@/lib/demo/types'
import { formatBytes, MB } from '../lib/image-checks'
import { ASSET_MAX_BYTES } from './types'

type MediaLimit = { types: readonly string[]; maxBytes: number; label: string }

export const MEDIA_LIMITS: Record<MediaType, MediaLimit> = {
  image: { types: ['image/png', 'image/jpeg', 'image/webp'], maxBytes: ASSET_MAX_BYTES, label: 'Image' },
  gif: { types: ['image/gif'], maxBytes: 10 * MB, label: 'GIF' },
  video: { types: ['video/mp4'], maxBytes: 50 * MB, label: 'MP4 video' },
}

export const ACCEPT_MEDIA = 'image/png,image/jpeg,image/webp,image/gif,video/mp4'

/** The rules as one line, for drop zones and help text. */
export const MEDIA_RULES_COPY =
  'PNG, JPG or WebP up to 20 MB, GIF up to 10 MB, or MP4 video up to 50 MB. Any shape.'

/** How a media type reads in a summary. */
export function mediaLabel(type: MediaType): string {
  return MEDIA_LIMITS[type].label
}

export function mediaTypeOf(mime: string): MediaType | null {
  const entries = Object.entries(MEDIA_LIMITS) as [MediaType, MediaLimit][]
  return entries.find(([, limit]) => limit.types.includes(mime))?.[0] ?? null
}

export type CheckedMedia = {
  key: string
  file: File
  /** Object URL for the preview. Revoke it when the file is dropped. */
  url: string
  mediaType: MediaType | null
  errors: string[]
}

/** Whether the browser can open the file: an image decodes, a video reads its metadata. */
function readable(url: string, type: MediaType): Promise<boolean> {
  return new Promise((resolve) => {
    if (type === 'video') {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.onloadedmetadata = () => resolve(true)
      video.onerror = () => resolve(false)
      video.src = url
      return
    }
    const image = new Image()
    image.onload = () => resolve(true)
    image.onerror = () => resolve(false)
    image.src = url
  })
}

let counter = 0

/** Checks one file against the single-asset media rules. */
export async function checkMediaFile(file: File): Promise<CheckedMedia> {
  const url = URL.createObjectURL(file)
  const mediaType = mediaTypeOf(file.type)
  const errors: string[] = []
  if (!mediaType) {
    errors.push('Not a PNG, JPG, WebP, GIF or MP4 file.')
  } else {
    const limit = MEDIA_LIMITS[mediaType].maxBytes
    if (file.size > limit)
      errors.push(
        `${formatBytes(file.size)} is over the ${formatBytes(limit)} limit for ${mediaType === 'image' ? 'an image' : mediaType === 'gif' ? 'a GIF' : 'a video'}.`,
      )
    if (errors.length === 0 && !(await readable(url, mediaType)))
      errors.push(`This ${mediaType === 'video' ? 'video' : 'image'} could not be read. It may be damaged.`)
  }
  return { key: `media-${++counter}`, file, url, mediaType, errors }
}

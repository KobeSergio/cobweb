import type { MediaType } from '@/lib/demo/types'
import { MB, type ImageRules } from '../lib/image-checks'
import type { Attribute } from './token-list'

export type { Attribute }

/** One uploaded artwork in the list. */
export type AssetItem = {
  key: string
  fileName: string
  url: string
  /** Image for 1/1s; a single asset may also be a GIF or an MP4 video (MASTER_PLAN, Art: media types). */
  mediaType: MediaType
  /** Editions of this artwork. 1 unless the creator sets more. */
  quantity: number
  attributes: Attribute[]
  /** File size in bytes, or null for the sample data. */
  bytes: number | null
  /** The URL is an object URL made here, so it must be revoked on removal. */
  owned: boolean
}

/** A file that failed its checks and was not added. */
export type RejectedFile = { key: string; fileName: string; errors: string[] }

export const ASSET_MAX_BYTES = 20 * MB
/** Editions one 1/1 file may carry (legacy `Add1of1sModal` MAX_QUANTITY). */
export const MAX_EDITIONS_PER_FILE = 10_000

/**
 * Assets are not layers: any shape, up to 20 MB. 1/1s take still images only
 * (MASTER_PLAN, Art: media types); GIF and MP4 belong to single asset (`media.ts`).
 */
export const ASSET_IMAGE_RULES: ImageRules = {
  types: ['image/png', 'image/jpeg', 'image/webp'],
  typesLabel: 'PNG, JPG or WebP',
  maxBytes: ASSET_MAX_BYTES,
  maxSide: null,
  square: false,
}

export const ACCEPT_IMAGES = 'image/png,image/jpeg,image/webp'

import type { RenderPlaceholder } from '@/lib/demo/types'

/** Counts of the art being locked, worked out on the server from the project's art. */
export type ArtSummary = {
  layers: number
  traits: number
  rules: number
  /** Traits with a maximum count (a cap, MASTER_PLAN, Art: maximum counts) and that maximum. */
  constants: { name: string; count: number }[]
}

/**
 * The IPFS result of a finished render. The real set's CIDs are null when the art is deferred and
 * only the placeholder was rendered; `placeholder` is null without "Reveal later".
 */
export type RenderResult = {
  imagesCid: string | null
  metadataCid: string | null
  placeholder: RenderPlaceholder | null
}

/** A public gateway for the "open" links next to CIDs. */
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'

/**
 * The sample preview for a token id. Only 24 sample images exist, so ids past 24 reuse them.
 * Replaced by: the rendered image at `ipfs://<imagesCid>/<id>.png` through the gateway.
 */
export function tokenPreview(id: number): string {
  return `/demo/tokens/${((id - 1) % 24) + 1}.svg`
}

/** "about 12 minutes", "under a minute", "about 1 hour 5 minutes". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'}${rest ? ` ${rest} minutes` : ''}`
}

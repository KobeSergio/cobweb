import type { ActionResult } from '@/lib/art/result'
import type { Hex, RenderJob, RenderPlaceholder } from '@/lib/demo/types'

/** A placeholder file stored through the uploader, or why it was not. */
export type PlaceholderUpload = { uploadId: string; url: string } | { error: string }

/**
 * What the Lock and upload screen does, in one shape for both modes: `realActions`
 * (upload-actions.ts) calls the server, `sampleActions` (upload-sim.ts) simulates in the browser.
 */
export type UploadActions = {
  lock(input: { allowDuplicates: boolean; chainId: number }): Promise<ActionResult<RenderJob>>
  unlock(): Promise<ActionResult<null>>
  requote(): Promise<ActionResult<RenderJob>>
  confirm(jobId: string, txHash: Hex): Promise<ActionResult<RenderJob>>
  reload(): Promise<ActionResult<RenderJob | null>>
  lockPlaceholder(uploadId: string | null): Promise<ActionResult<RenderJob>>
  /** Stores a placeholder file (`uploads` kind placeholder). Null in sample mode, which keeps it in the browser. */
  uploadPlaceholder: ((file: File) => Promise<PlaceholderUpload>) | null
  removePlaceholder(uploadId: string): Promise<ActionResult>
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
 * Replaced by: the rendered image at `ipfs://<imagesCid>/<id>.png` through the gateway (Phase 4).
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

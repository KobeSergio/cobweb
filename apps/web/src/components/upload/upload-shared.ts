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
  /** Retries a failed render; the job comes back `rendering` (or `finalizing`), or the refusal's sentence. */
  retry(): Promise<ActionResult<RenderJob>>
  lockPlaceholder(uploadId: string | null): Promise<ActionResult<RenderJob>>
  /** Stores a placeholder file (`uploads` kind placeholder). Null in sample mode, which keeps it in the browser. */
  uploadPlaceholder: ((file: File) => Promise<PlaceholderUpload>) | null
  removePlaceholder(uploadId: string): Promise<ActionResult>
}

/**
 * The IPFS result of a finished render, as the done step shows it (docs/specs/2026-10-14-render-screen-wiring.md,
 * section 10). The real set's CIDs are empty or null when the art is deferred and only the placeholder was
 * rendered; `placeholder` is null without "Reveal later"; `collageUrl` is where the preview collage is served
 * from, or null when the job has none.
 */
export type RenderResult = {
  /** Each batch directory's CID, in batch order. */
  batchCids: string[]
  metadataCid: string | null
  /** What the contract is given: `ipfs://<cid>/`. */
  baseUri: string | null
  collageUrl: string | null
  placeholder: RenderPlaceholder | null
  /**
   * The base URI a finished placeholder job gives the contract (`ipfs://<cid>/metadata.json`), which
   * the done step shows for the placeholder in place of the image directory CID.
   */
  placeholderUri?: string | null
}

/**
 * A finished job as the done step shows it. A placeholder job rendered no real set, shows the base URI
 * the contract is given, and has no collage whatever the caller passes.
 */
export function resultOf(
  job: Extract<RenderJob, { state: 'done' }>,
  options: { collageUrl: string | null },
): RenderResult {
  if (job.placeholderImageCid !== null)
    return {
      batchCids: [],
      metadataCid: null,
      baseUri: null,
      collageUrl: null,
      placeholder: job.placeholder,
      placeholderUri: job.baseUri,
    }
  return {
    batchCids: job.batchCids,
    metadataCid: job.metadataCid,
    baseUri: job.baseUri,
    collageUrl: options.collageUrl,
    placeholder: job.placeholder,
  }
}

/** A public gateway for the "open" links next to CIDs. */
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'

/** "about 12 minutes", "under a minute", "about 1 hour 5 minutes". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `about ${hours} ${hours === 1 ? 'hour' : 'hours'}${rest ? ` ${rest} minutes` : ''}`
}

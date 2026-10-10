/**
 * Seam: rendering stays simulated until Phase 4 (MASTER_PLAN, Phase 4: render pipeline).
 * `followRender` stands in for following the paid job's batches as the render Lambdas update
 * `render_jobs` and `render_batches`, and `retryBatch` for the action that re-queues a failed batch.
 * Review, lock, quote, payment and unlock are real (upload-actions.ts, pay-machine.ts).
 */
import type { UploadOutcome } from './upload-sim'

/** Tokens per render batch for a fresh job (`render_jobs.batch_size`). */
export const RENDER_BATCH_SIZE = 100

/** Rough real-world time per batch, for the estimate shown to the creator. */
export const SECONDS_PER_BATCH = 95

/** Coarse render progress: whole batches, then the metadata. Nothing is reported per image. */
export type RenderProgress = {
  phase: 'images' | 'metadata' | 'done'
  total: number
  done: number
  size: number
  /** The batch number (1-based) that failed, while it waits for a retry. */
  failedBatch?: number
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    const abort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}

/**
 * Follows the render from `start` until the metadata is pinned. With the `batch-failed` sample
 * outcome, the batch after the starting point fails once and the run stops until `followRender` is
 * called again from `retryBatch`'s progress.
 */
export async function followRender(
  start: RenderProgress,
  onProgress: (progress: RenderProgress) => void,
  options: { outcome?: UploadOutcome; signal: AbortSignal },
): Promise<void> {
  const failAt = options.outcome === 'batch-failed' ? Math.min(start.done + 2, start.total) : null
  let progress = { ...start, failedBatch: undefined }
  while (progress.done < progress.total) {
    await sleep(750, options.signal)
    if (failAt !== null && progress.done + 1 === failAt) {
      onProgress({ ...progress, failedBatch: failAt })
      return
    }
    progress = { ...progress, done: progress.done + 1 }
    onProgress(progress)
  }
  progress = { ...progress, phase: 'metadata' }
  onProgress(progress)
  await sleep(2400, options.signal)
  onProgress({ ...progress, phase: 'done' })
}

/** Re-queues the failed batch: the run continues from where it stopped. */
export function retryBatch(progress: RenderProgress): RenderProgress {
  return { ...progress, failedBatch: undefined }
}

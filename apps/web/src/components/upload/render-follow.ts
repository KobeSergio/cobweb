import { ART_PROBLEM_CODES } from '@cobweb/shared/render-queue'
import { MAX_RENDER_RETRIES } from '@/lib/art/render-job'
import type { RenderJob, RenderJobState } from '@/lib/demo/types'

/**
 * Following a render job (docs/specs/2026-10-14-render-screen-wiring.md, section 8): when the screen
 * polls and how often, which face a failed job shows, and the view the render step draws from a job.
 * Pure and browser-safe; the flow (upload-flow.tsx) polls, this decides.
 */

/** Tokens per render batch for a fresh job (`render_jobs.batch_size`). */
export const RENDER_BATCH_SIZE = 100
/** The rough time a batch takes, in seconds, before a rate is observed. */
export const SECONDS_PER_BATCH = 95
/** The rough time the metadata step takes, in seconds. */
export const METADATA_SECONDS = 60
export const POLL_FAST_MS = 3_000
export const POLL_SLOW_MS = 15_000
export const POLL_SLOW_AFTER_MS = 120_000

const FOLLOWED: readonly RenderJobState[] = ['paid', 'waived', 'rendering', 'finalizing']

/** Whether a job in this state is still moving on the server, so the screen polls it. */
export function follows(state: RenderJobState): boolean {
  return FOLLOWED.includes(state)
}

/** How long until the next poll: 3 seconds for the first two minutes of the render stage, then 15; false when not following. */
export function pollInterval(state: RenderJobState, elapsedMs: number): number | false {
  if (!follows(state)) return false
  return elapsedMs < POLL_SLOW_AFTER_MS ? POLL_FAST_MS : POLL_SLOW_MS
}

/**
 * The one action that fits a failed job: `art` (unlock and fix the art), `retry` (try again),
 * `credit` (no retries left; unlock and lock again on the credit), `support` (the payment is in doubt).
 */
export type FailureFace = 'art' | 'retry' | 'credit' | 'support'

export type RenderView = {
  phase: 'queued' | 'images' | 'metadata' | 'done'
  total: number
  done: number
  size: number
  /** While rendering: the 1-based batch the worker is retrying on its own, or null. */
  retryingBatch: number | null
  /** Null once the job is done or failed. */
  timeLeftSeconds: number | null
  failure: {
    face: FailureFace
    sentence: string
    code: string | null
    failedBatch: number | null
    retriesLeft: number
  } | null
}

type FailedJob = Extract<RenderJob, { state: 'failed' }>

const ART_CODES: readonly string[] = ART_PROBLEM_CODES

/** The face of a failed job, in order: the payment in doubt, an unlock, an art problem, a retry left, the credit. */
export function faceOf(job: FailedJob): FailureFace {
  if (job.errorCode === 'payment-mismatch') return 'support'
  // Never on the screen (the latest-job filter hides it); answered all the same.
  if (job.errorCode === 'unlocked' || job.error === 'unlocked') return 'support'
  // A retry fails the same way, whatever `retryable` says: the art has to change.
  if (job.errorCode !== null && ART_CODES.includes(job.errorCode)) return 'art'
  if (job.retryable) return 'retry'
  return 'credit'
}

/** The images phase's estimate: the observed seconds a batch once one is done, else the rough one. */
function imagesTimeLeft(total: number, done: number, startedAt: number, nowSeconds: number): number {
  const rate = done >= 1 ? Math.max(0, nowSeconds - startedAt) / done : SECONDS_PER_BATCH
  return Math.round((total - done) * rate + METADATA_SECONDS)
}

/** What the render step shows for a job, at `nowSeconds` (unix seconds, for the observed rate). */
export function renderView(job: RenderJob, nowSeconds: number): RenderView {
  if (!('batches' in job)) {
    // Nothing locked, or locked and unpaid: the batches are not known until the claim.
    const total = Math.max(1, Math.ceil(job.tokenCount / RENDER_BATCH_SIZE))
    return {
      phase: 'queued',
      total,
      done: 0,
      size: RENDER_BATCH_SIZE,
      retryingBatch: null,
      timeLeftSeconds: total * SECONDS_PER_BATCH + METADATA_SECONDS,
      failure: null,
    }
  }
  const { total, done, size } = job.batches
  const shared = { total, done, size, retryingBatch: null, failure: null }
  switch (job.state) {
    case 'paid':
    case 'waived':
      return {
        ...shared,
        phase: 'queued',
        done: 0,
        timeLeftSeconds: total * SECONDS_PER_BATCH + METADATA_SECONDS,
      }
    case 'rendering':
      return {
        ...shared,
        phase: 'images',
        retryingBatch: job.failedBatch,
        timeLeftSeconds: imagesTimeLeft(total, done, job.startedAt, nowSeconds),
      }
    case 'finalizing':
      return { ...shared, phase: 'metadata', timeLeftSeconds: METADATA_SECONDS }
    case 'done':
      return { ...shared, phase: 'done', timeLeftSeconds: null }
    case 'failed':
      return {
        ...shared,
        phase: done < total ? 'images' : 'metadata',
        timeLeftSeconds: null,
        failure: {
          face: faceOf(job),
          sentence: job.error,
          code: job.errorCode,
          failedBatch: job.failedBatch,
          retriesLeft: Math.max(0, MAX_RENDER_RETRIES - job.retries),
        },
      }
  }
}

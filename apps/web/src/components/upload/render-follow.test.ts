import { ART_PROBLEM_CODES } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { MAX_RENDER_RETRIES } from '@/lib/art/render-job'
import type { RenderJob, RenderJobBase, RenderJobState } from '@/lib/demo/types'
import {
  faceOf,
  follows,
  METADATA_SECONDS,
  POLL_FAST_MS,
  POLL_SLOW_AFTER_MS,
  POLL_SLOW_MS,
  pollInterval,
  RENDER_BATCH_SIZE,
  renderView,
  SECONDS_PER_BATCH,
} from './render-follow'

const base: RenderJobBase = {
  id: '0f4a0f3e-2f5e-4e3a-9d1c-1b2c3d4e5f60',
  jobId: `0x${'1'.repeat(64)}`,
  tokenCount: 250,
  lockedAt: 1_000,
  tokenListHash: `0x${'2'.repeat(64)}`,
  quote: {
    chainId: 31337,
    perTokenWei: '1',
    tokenCount: 250,
    totalWei: '250',
    payer: `0x${'3'.repeat(40)}`,
    expiresAt: 2_000,
    factory: null,
  },
  lockOptions: { allowDuplicates: false },
  placeholder: null,
  credited: false,
}
const batches = { total: 5, done: 2, size: 50 }
const STARTED = 10_000

type Failed = Extract<RenderJob, { state: 'failed' }>

const paid: RenderJob = { ...base, state: 'paid', payment: null, batches: { ...batches, done: 0 } }
const rendering = (done: number, failedBatch: number | null = null): RenderJob => ({
  ...base,
  state: 'rendering',
  payment: null,
  batches: { ...batches, done },
  startedAt: STARTED,
  failedBatch,
})
const finalizing: RenderJob = {
  ...base,
  state: 'finalizing',
  payment: null,
  batches: { ...batches, done: 5 },
  startedAt: STARTED,
}
const done: RenderJob = {
  ...base,
  state: 'done',
  payment: null,
  batches: { ...batches, done: 5 },
  startedAt: STARTED,
  finishedAt: STARTED + 600,
  metadataCid: `b${'m'.repeat(58)}`,
  baseUri: `ipfs://b${'m'.repeat(58)}/`,
  batchCids: [],
  placeholderImageCid: null,
  collageKey: null,
}
const failed = (fields: Partial<Failed> = {}): Failed => ({
  ...base,
  state: 'failed',
  payment: null,
  batches: { ...batches, done: 2 },
  error: 'The pinning service answered with a different CID.',
  errorCode: 'cid-mismatch',
  retries: 1,
  failedBatch: 3,
  retryable: true,
  ...fields,
})

describe('follows', () => {
  it('is true while the job is paid, waived, rendering or finalizing', () => {
    for (const state of ['paid', 'waived', 'rendering', 'finalizing'] as RenderJobState[])
      expect(follows(state)).toBe(true)
  })

  it('is false for every state that is not followed', () => {
    for (const state of ['locked', 'payment_due', 'done', 'failed'] as RenderJobState[])
      expect(follows(state)).toBe(false)
  })
})

describe('pollInterval', () => {
  it('is false for every state that is not followed, whatever the elapsed time', () => {
    for (const state of ['locked', 'payment_due', 'done', 'failed'] as RenderJobState[]) {
      expect(pollInterval(state, 0)).toBe(false)
      expect(pollInterval(state, POLL_SLOW_AFTER_MS)).toBe(false)
    }
  })

  it('polls every 3 seconds for the first two minutes', () => {
    expect(POLL_FAST_MS).toBe(3_000)
    expect(pollInterval('rendering', 0)).toBe(POLL_FAST_MS)
    expect(pollInterval('paid', POLL_SLOW_AFTER_MS - 1)).toBe(POLL_FAST_MS)
  })

  it('slows to 15 seconds from two minutes exactly', () => {
    expect(POLL_SLOW_MS).toBe(15_000)
    expect(POLL_SLOW_AFTER_MS).toBe(120_000)
    expect(pollInterval('rendering', POLL_SLOW_AFTER_MS)).toBe(POLL_SLOW_MS)
    expect(pollInterval('finalizing', 60 * 60 * 1000)).toBe(POLL_SLOW_MS)
  })
})

describe('faceOf', () => {
  it('answers support for a payment mismatch, and for an unlocked job', () => {
    expect(faceOf(failed({ errorCode: 'payment-mismatch', retryable: false }))).toBe('support')
    expect(faceOf(failed({ errorCode: 'unlocked', error: 'x', retryable: false }))).toBe('support')
    expect(faceOf(failed({ errorCode: null, error: 'unlocked', retryable: false }))).toBe('support')
  })

  it('answers art for every art problem code, whatever retryable says, and before retry or credit', () => {
    for (const code of ART_PROBLEM_CODES) {
      expect(faceOf(failed({ errorCode: code, retryable: true }))).toBe('art')
      expect(faceOf(failed({ errorCode: code, retryable: false, retries: MAX_RENDER_RETRIES }))).toBe('art')
    }
  })

  it('answers retry for a retryable worker failure, and credit once the retries are used up', () => {
    expect(faceOf(failed({ errorCode: 'cid-mismatch', retryable: true }))).toBe('retry')
    expect(faceOf(failed({ errorCode: 'dead-letter', retryable: true, retries: 4 }))).toBe('retry')
    expect(faceOf(failed({ errorCode: 'dead-letter', retryable: false, retries: 5 }))).toBe('credit')
    expect(faceOf(failed({ errorCode: null, retryable: false, retries: 5 }))).toBe('credit')
  })
})

describe('renderView', () => {
  it('shows a paid or waived job as queued, nothing done, with the rough estimate', () => {
    const view = renderView(paid, STARTED)
    expect(view).toEqual({
      phase: 'queued',
      total: 5,
      done: 0,
      size: 50,
      retryingBatch: null,
      timeLeftSeconds: 5 * SECONDS_PER_BATCH + METADATA_SECONDS,
      failure: null,
    })
    expect(renderView({ ...paid, state: 'waived' }, STARTED).phase).toBe('queued')
  })

  it('shows a rendering job in the images phase with the rough estimate before a batch is done', () => {
    const view = renderView(rendering(0), STARTED + 30)
    expect(view.phase).toBe('images')
    expect(view.done).toBe(0)
    expect(view.timeLeftSeconds).toBe(5 * SECONDS_PER_BATCH + METADATA_SECONDS)
  })

  it('estimates from the observed rate once a batch is done', () => {
    // Two batches in 300 seconds: 150 a batch, three left.
    const view = renderView(rendering(2), STARTED + 300)
    expect(view.timeLeftSeconds).toBe(3 * 150 + METADATA_SECONDS)
    // A clock behind the start reads as no time passed: nothing below the metadata estimate.
    expect(renderView(rendering(2), STARTED - 5).timeLeftSeconds).toBe(METADATA_SECONDS)
  })

  it('carries the batch the worker is retrying on its own, and never a failure, while rendering', () => {
    const view = renderView(rendering(2, 3), STARTED)
    expect(view.retryingBatch).toBe(3)
    expect(view.failure).toBeNull()
    expect(renderView(rendering(2), STARTED).retryingBatch).toBeNull()
  })

  it('shows finalizing as the metadata phase with the metadata estimate, and done as done with none', () => {
    expect(renderView(finalizing, STARTED)).toMatchObject({
      phase: 'metadata',
      done: 5,
      timeLeftSeconds: METADATA_SECONDS,
      failure: null,
    })
    expect(renderView(done, STARTED)).toMatchObject({ phase: 'done', done: 5, timeLeftSeconds: null })
  })

  it('shows a failed job with its face, sentence, code, batch and retries left, in the phase it stopped in', () => {
    const images = renderView(failed(), STARTED)
    expect(images).toEqual({
      phase: 'images',
      total: 5,
      done: 2,
      size: 50,
      retryingBatch: null,
      timeLeftSeconds: null,
      failure: {
        face: 'retry',
        sentence: 'The pinning service answered with a different CID.',
        code: 'cid-mismatch',
        failedBatch: 3,
        retriesLeft: MAX_RENDER_RETRIES - 1,
      },
    })
    const metadata = renderView(
      failed({ batches: { ...batches, done: 5 }, failedBatch: null, retries: 5, retryable: false }),
      STARTED,
    )
    expect(metadata.phase).toBe('metadata')
    expect(metadata.failure).toMatchObject({ face: 'credit', failedBatch: null, retriesLeft: 0 })
  })

  it('shows a job without batches (nothing locked, or locked and unpaid) as queued over the default batch size', () => {
    expect(RENDER_BATCH_SIZE).toBe(100)
    const pending: RenderJob = { ...base, state: 'locked' }
    expect(renderView(pending, STARTED)).toEqual({
      phase: 'queued',
      total: 3,
      done: 0,
      size: RENDER_BATCH_SIZE,
      retryingBatch: null,
      timeLeftSeconds: 3 * SECONDS_PER_BATCH + METADATA_SECONDS,
      failure: null,
    })
    const empty: RenderJob = { ...base, tokenCount: 0, state: 'payment_due', payment: null }
    expect(renderView(empty, STARTED).total).toBe(1)
  })
})

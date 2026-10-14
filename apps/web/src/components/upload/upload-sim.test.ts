import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderJob, RenderJobBase } from '@/lib/demo/types'
import { SAMPLE_ART_PROBLEM, SAMPLE_BATCH_FAILURE, sampleActions, UPLOAD_OUTCOMES } from './upload-sim'

const base: RenderJobBase = {
  id: 'job-1',
  jobId: `0x${'1'.repeat(64)}`,
  tokenCount: 250,
  lockedAt: 1_000,
  tokenListHash: `0x${'2'.repeat(64)}`,
  quote: {
    chainId: 8453,
    perTokenWei: '1',
    tokenCount: 250,
    totalWei: '250',
    payer: `0x${'3'.repeat(40)}`,
    expiresAt: 2_000,
  },
  lockOptions: { allowDuplicates: false },
  placeholder: null,
  credited: false,
}
const payment = { txHash: `0x${'4'.repeat(64)}` as const, paidAt: 1_100, amountWei: '250' }
const paid: RenderJob = { ...base, state: 'paid', payment, batches: { total: 3, done: 0, size: 100 } }
const rendering: RenderJob = {
  ...base,
  state: 'rendering',
  payment,
  batches: { total: 16, done: 9, size: 50 },
  startedAt: 1_200,
  failedBatch: null,
}
const done: Extract<RenderJob, { state: 'done' }> = {
  ...base,
  state: 'done',
  payment,
  batches: { total: 3, done: 3, size: 100 },
  startedAt: 1_200,
  finishedAt: 1_900,
  metadataCid: `b${'m'.repeat(58)}`,
  baseUri: `ipfs://b${'m'.repeat(58)}/`,
  batchCids: [`b${'a'.repeat(58)}`],
  placeholderImageCid: null,
  collageKey: 'c/collage/j.png',
}

/** `reload` until the job is done or `limit` calls have been made; the states seen, in order. */
async function run(actions: ReturnType<typeof sampleActions>, limit = 20): Promise<RenderJob[]> {
  const seen: RenderJob[] = []
  for (let n = 0; n < limit; n++) {
    const result = await actions.reload()
    if (!result.ok || !result.data) throw new Error('reload failed')
    seen.push(result.data)
    if (result.data.state === 'done' || result.data.state === 'failed') break
  }
  return seen
}

const summary = (job: RenderJob) => ('batches' in job ? `${job.state}:${job.batches.done}` : job.state)

describe('sampleActions', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('lists the art problem among the outcomes', () => {
    expect(UPLOAD_OUTCOMES).toContain('art-problem')
    expect(UPLOAD_OUTCOMES).toContain('batch-failed')
  })

  it('steps a paid job to rendering, two batches a reload, then finalizing, then the done sample', async () => {
    const seen = await run(sampleActions(paid, { done }))
    expect(seen.map(summary)).toEqual(['rendering:0', 'rendering:2', 'rendering:3', 'finalizing:3', 'done:3'])
    const last = seen.at(-1)
    expect(last).toMatchObject({ state: 'done', metadataCid: done.metadataCid, lockedAt: base.lockedAt })
    // Once done, a reload answers the same job.
    const again = await sampleActions(paid, { done }).reload()
    expect(again.ok).toBe(true)
  })

  it('stops two batches after the start on the batch-failed outcome, and retry resumes with the outcome cleared', async () => {
    const actions = sampleActions(rendering, { outcome: 'batch-failed', done })
    const seen = await run(actions)
    expect(seen.map(summary)).toEqual(['failed:10'])
    expect(seen[0]).toMatchObject({
      error: SAMPLE_BATCH_FAILURE,
      errorCode: 'cid-mismatch',
      failedBatch: 11,
      retryable: true,
    })
    const retrying = actions.retry()
    await vi.runAllTimersAsync()
    const retried = await retrying
    expect(retried.ok && retried.data).toMatchObject({
      state: 'rendering',
      failedBatch: null,
      batches: { done: 10 },
    })
    const rest = await run(actions)
    expect(rest.map(summary)).toEqual([
      'rendering:12',
      'rendering:14',
      'rendering:16',
      'finalizing:16',
      'done:16',
    ])
  })

  it('stops on the layer problem with the art-problem outcome, and the unlock leaves a credit that one lock spends', async () => {
    const actions = sampleActions(paid, { outcome: 'art-problem', done })
    const seen = await run(actions)
    expect(seen.map(summary)).toEqual(['rendering:0', 'failed:1'])
    expect(seen[1]).toMatchObject({ error: SAMPLE_ART_PROBLEM, errorCode: 'layer-size', failedBatch: 2 })
    const unlocking = actions.unlock()
    await vi.runAllTimersAsync()
    expect((await unlocking).ok).toBe(true)
    // The failed render left a credit: the next lock is waived and follows the paid job's path.
    const locking = actions.lock({ allowDuplicates: false, chainId: 8453 })
    await vi.runAllTimersAsync()
    const locked = await locking
    expect(locked.ok && locked.data).toMatchObject({ state: 'waived', credited: true, payment: null })
    const started = await actions.reload()
    expect(started.ok && started.data && summary(started.data)).toBe('rendering:0')
    // The credit is spent: a plain unlock and a new lock ask for payment again.
    const again = actions.unlock()
    await vi.runAllTimersAsync()
    expect((await again).ok).toBe(true)
    const relocking = actions.lock({ allowDuplicates: false, chainId: 8453 })
    await vi.runAllTimersAsync()
    const relocked = await relocking
    expect(relocked.ok && relocked.data.state).toBe('payment_due')
    const confirmed = await actions.confirm('job-1', `0x${'5'.repeat(64)}`)
    expect(confirmed.ok && confirmed.data.state).toBe('paid')
    const rest = await run(actions)
    expect(rest.map(summary)).toEqual(['rendering:0', 'rendering:2', 'rendering:3', 'finalizing:3', 'done:3'])
  })

  it('leaves a job that is not followed where it is', async () => {
    const locked: RenderJob = { ...base, state: 'locked' }
    const result = await sampleActions(locked, { done }).reload()
    expect(result.ok && result.data).toBe(locked)
    const retrying = sampleActions(locked, { done }).retry()
    await vi.runAllTimersAsync()
    const retry = await retrying
    expect(retry.ok).toBe(false)
  })
})

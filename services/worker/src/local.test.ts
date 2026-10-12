import { enqueueRender } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { memoryQueue } from './doubles/memory-queue.ts'
import { failingPinner } from './doubles/pinners.ts'
import { runLocal } from './local.ts'
import { JOB_ID } from './testing/fixtures.ts'
import { harness } from './testing/harness.ts'

const job = { id: JOB_ID, retries: 0 }

describe('runLocal', () => {
  it('takes a paid job to done: start, three batches, metadata', async () => {
    const h = await harness()
    await enqueueRender(h.queue, job)
    expect(await runLocal(h.deps)).toEqual({ handled: 5, thrown: 0, dead: 0 })
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.rows.every((row) => row.state === 'done')).toBe(true)
    expect(h.queue.size()).toBe(0)
  })

  it('ends in the same state when every message is delivered twice', async () => {
    const once = await harness()
    await enqueueRender(once.queue, job)
    await runLocal(once.deps)

    const twice = await harness()
    const queue = memoryQueue({ copies: 2 })
    const deps = { ...twice.deps, queue }
    await enqueueRender(queue, job)
    const run = await runLocal(deps)
    expect(run.thrown).toBe(0)
    expect(run.handled).toBeGreaterThan(5)
    expect(twice.jobs.record.state).toBe('done')
    expect(twice.jobs.finished).toEqual(once.jobs.finished)
    expect(twice.jobs.rows.map((row) => row.imagesCid)).toEqual(once.jobs.rows.map((row) => row.imagesCid))
    expect(twice.jobs.failures).toEqual([])
  })

  it('redelivers a batch whose pin failed once, and the job finishes', async () => {
    const h = await harness()
    const pinner = failingPinner(h.deps.pinner, { nth: 1, times: 1 })
    await enqueueRender(h.queue, job)
    const run = await runLocal({ ...h.deps, pinner })
    expect(run).toEqual({ handled: 5, thrown: 1, dead: 0 })
    expect(pinner.failures).toBe(1)
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.rows[1]!.attempts).toBe(2)
  })

  it('dead-letters a batch that fails three times and fails the job, keeping the finished batches', async () => {
    const h = await harness()
    const pinner = failingPinner(h.deps.pinner, { nth: 1, times: Infinity })
    await enqueueRender(h.queue, job)
    const run = await runLocal({ ...h.deps, pinner })
    expect(run).toEqual({ handled: 3, thrown: 3, dead: 1 })
    expect(h.jobs.record.state).toBe('failed')
    expect(h.jobs.record.errorCode).toBe('dead-letter')
    expect(h.jobs.failures).toMatchObject([{ index: 1, code: 'dead-letter', final: true }])
    expect(h.jobs.rows.map((row) => row.state)).toEqual(['done', 'failed', 'done'])
  })

  it('after a retry, renders only the batch that failed', async () => {
    const h = await harness()
    await enqueueRender(h.queue, job)
    await runLocal({ ...h.deps, pinner: failingPinner(h.deps.pinner, { nth: 1, times: Infinity }) })
    // What art_render_retry does: failed batches back to queued, the job rendering, retries raised.
    h.jobs.rows[1]!.state = 'queued'
    h.jobs.record.state = 'rendering'
    h.jobs.record.retries = 1
    h.jobs.calls.length = 0
    await enqueueRender(h.queue, { id: JOB_ID, retries: 1 })
    await runLocal(h.deps)
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.calls.filter((call) => call.startsWith('batchDone'))).toEqual(['batchDone:1'])
    expect(h.queue.sent.at(-1)).toEqual({ jobId: JOB_ID, step: 'metadata', retries: 1 })
  })

  it('honours maxReceives', async () => {
    const h = await harness()
    const pinner = failingPinner(h.deps.pinner, { nth: 0, times: Infinity })
    await enqueueRender(h.queue, job)
    const run = await runLocal({ ...h.deps, pinner }, { maxReceives: 1 })
    expect(run.thrown).toBe(1)
    expect(run.dead).toBe(1)
  })

  it('stops with an error instead of looping for ever', async () => {
    const h = await harness()
    await enqueueRender(h.queue, job)
    await expect(runLocal(h.deps, { maxDeliveries: 2 })).rejects.toThrow(
      'The local runner stopped after 2 deliveries.',
    )
  })
})

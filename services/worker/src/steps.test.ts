import { RenderProblem } from '@cobweb/render'
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { flatPng, sizeOf } from './doubles/draw.ts'
import { memoryStore } from './doubles/memory-store.ts'
import { wrongCidPinner } from './doubles/pinners.ts'
import { isBatchTooLarge, JobRefusal, MissingObject, ObjectTooLarge } from './ports.ts'
import {
  BATCH_TOO_LARGE,
  boundedLoad,
  CID_MISMATCH,
  DEAD_LETTER,
  MAX_BATCH_BYTES,
  handle,
  handleDead,
  PAYMENT_MISMATCH,
  RESULT_DIFFERS,
  STUCK_MINUTES,
  STUCK_MINUTES_BUSY,
  sweep,
} from './steps.ts'
import {
  assetKey,
  COLLECTION_ID,
  GIF_BYTES,
  JOB_ID,
  layerKey,
  MP4_BYTES,
  PLACEHOLDER_KEY,
} from './testing/fixtures.ts'
import { batchMessage, harness, metadataMessage, startMessage } from './testing/harness.ts'

const CID = /^[a-z2-7]{59}$/

describe('in-process retries', () => {
  const sleeps = () => {
    const waited: number[] = []
    return {
      waited,
      retry: { delaysMs: [1000, 3000, 6000], sleep: async (ms: number) => void waited.push(ms) },
    }
  }

  it('retries the payment read after 1, 3 and 6 seconds and then throws the last error', async () => {
    const h = await harness()
    const { waited, retry } = sleeps()
    let calls = 0
    h.deps.retry = retry
    h.deps.chain = {
      jobPayment: async () => {
        calls += 1
        throw new Error(`rpc down ${calls}`)
      },
    }
    await expect(handle(startMessage(), h.deps)).rejects.toThrow('rpc down 4')
    expect(calls).toBe(4)
    expect(waited).toEqual([1000, 3000, 6000])
    expect(h.jobs.failures).toEqual([])
  })

  it('goes on with the start when a later try of the payment read succeeds', async () => {
    const h = await harness()
    const { waited, retry } = sleeps()
    let calls = 0
    h.deps.retry = retry
    h.deps.chain = {
      jobPayment: async (job) => {
        calls += 1
        if (calls < 3) throw new Error('PaymentUnproven')
        return job.quoteTotalWei
      },
    }
    await handle(startMessage(), h.deps)
    expect(waited).toEqual([1000, 3000])
    expect(h.jobs.record.state).toBe('rendering')
  })

  it('retries a pinning error and records the batch when a later try succeeds', async () => {
    const h = await harness('generative', { claimed: true })
    const { waited, retry } = sleeps()
    let calls = 0
    h.deps.retry = retry
    const inner = h.deps.pinner
    h.deps.pinner = {
      pin: async (car, cid) => {
        calls += 1
        if (calls === 1) throw new Error('pin down')
        return inner.pin(car, cid)
      },
    }
    await handle(batchMessage(0), h.deps)
    expect(calls).toBe(2)
    expect(waited).toEqual([1000])
    expect(h.jobs.rows[0]!.state).toBe('done')
  })

  it('retries a pinning error in the metadata step and throws the last one', async () => {
    const h = await harness('generative', { claimed: true })
    for (const i of [0, 1, 2]) await handle(batchMessage(i), h.deps)
    const { waited, retry } = sleeps()
    h.deps.retry = retry
    h.deps.pinner = { pin: () => Promise.reject(new Error('pin down')) }
    await expect(handle(metadataMessage(), h.deps)).rejects.toThrow('pin down')
    expect(waited).toEqual([1000, 3000, 6000])
  })

  it('does not retry a wrong CID: it is a verdict, not a throw', async () => {
    const h = await harness('generative', { claimed: true })
    const { waited, retry } = sleeps()
    let calls = 0
    h.deps.retry = retry
    h.deps.pinner = {
      pin: async () => {
        calls += 1
        return wrongCidPinner().pin(new Uint8Array(), '')
      },
    }
    await handle(batchMessage(0), h.deps)
    expect(calls).toBe(1)
    expect(waited).toEqual([])
    expect(h.jobs.failures[0]?.code).toBe('cid-mismatch')
  })

  it('makes a single try when no retry is configured', async () => {
    const h = await harness()
    let calls = 0
    h.deps.chain = {
      jobPayment: async () => {
        calls += 1
        throw new Error('rpc down')
      },
    }
    await expect(handle(startMessage(), h.deps)).rejects.toThrow('rpc down')
    expect(calls).toBe(1)
  })
})

describe('start', () => {
  it('checks the payment, claims the job and sends one batch message per batch', async () => {
    const h = await harness()
    await handle(startMessage(), h.deps)
    expect(h.paymentReads).toHaveLength(1)
    expect(h.jobs.record.state).toBe('rendering')
    expect(h.queue.sent).toEqual([batchMessage(0), batchMessage(1), batchMessage(2)])
    expect(h.jobs.calls.indexOf('claim')).toBeGreaterThan(h.jobs.calls.indexOf('job'))
  })

  it('returns without a claim for a missing, done or failed job', async () => {
    for (const state of ['done', 'failed'] as const) {
      const h = await harness('generative', { job: { state } })
      await handle(startMessage(), h.deps)
      expect(h.jobs.calls).toEqual(['job'])
      expect(h.queue.sent).toEqual([])
    }
    const h = await harness()
    await handle({ ...startMessage(), jobId: '00000000-0000-4000-8000-000000000000' }, h.deps)
    expect(h.jobs.calls).toEqual(['job'])
    expect(h.paymentReads).toEqual([])
  })

  it('fails a job whose payment is short with payment-mismatch and never claims it', async () => {
    const h = await harness('generative', { paid: 124n })
    await handle(startMessage(), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: null, code: 'payment-mismatch', message: PAYMENT_MISMATCH, final: true, retries: 0 },
    ])
    expect(h.jobs.calls).not.toContain('claim')
    expect(h.jobs.record.state).toBe('failed')
    expect(h.queue.sent).toEqual([])
  })

  it('accepts a payment above the quote', async () => {
    const h = await harness('generative', { paid: 126n })
    await handle(startMessage(), h.deps)
    expect(h.jobs.record.state).toBe('rendering')
    expect(h.jobs.failures).toEqual([])
  })

  it('throws on a chain read error, so the message is redelivered, and changes nothing', async () => {
    const h = await harness()
    h.deps.chain = { jobPayment: () => Promise.reject(new Error('rpc down')) }
    await expect(handle(startMessage(), h.deps)).rejects.toThrow('rpc down')
    expect(h.jobs.record.state).toBe('paid')
    expect(h.jobs.failures).toEqual([])
    expect(h.jobs.calls).not.toContain('claim')
  })

  it('skips the payment check for a waived job and for a quote of zero', async () => {
    const waived = await harness('generative', { job: { state: 'waived' } })
    await handle(startMessage(), waived.deps)
    expect(waived.paymentReads).toEqual([])
    expect(waived.jobs.record.state).toBe('rendering')
    const free = await harness('generative', { job: { quoteTotalWei: 0n } })
    await handle(startMessage(), free.deps)
    expect(free.paymentReads).toEqual([])
    expect(free.jobs.record.state).toBe('rendering')
  })

  it('skips the payment check for a paid job marked waived, whatever its quote', async () => {
    const h = await harness('generative', { job: { state: 'paid', quoteTotalWei: 125n, waived: true } })
    await handle(startMessage(), h.deps)
    expect(h.paymentReads).toEqual([])
    expect(h.jobs.record.state).toBe('rendering')
  })

  it('does not read the chain again for a job already rendering, and re-sends only open batches', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.rows[0]!.state = 'done'
    h.jobs.rows[0]!.imagesCid = 'a'.repeat(59)
    h.jobs.rows[1]!.state = 'failed'
    h.jobs.rows[2]!.state = 'running'
    await handle(startMessage(), h.deps)
    expect(h.paymentReads).toEqual([])
    expect(h.queue.sent).toEqual([batchMessage(1), batchMessage(2)])
  })

  it('sends metadata when every batch is already done', async () => {
    const h = await harness('generative', { claimed: true })
    for (const row of h.jobs.rows) Object.assign(row, { state: 'done', imagesCid: 'a'.repeat(59) })
    h.jobs.record.state = 'finalizing'
    await handle(startMessage(), h.deps)
    expect(h.queue.sent).toEqual([metadataMessage()])
  })

  it('gives the metadata message the job retries when every batch is done', async () => {
    const h = await harness('generative', { claimed: true, job: { retries: 2 } })
    for (const row of h.jobs.rows) Object.assign(row, { state: 'done', imagesCid: 'a'.repeat(59) })
    h.jobs.record.state = 'finalizing'
    await handle(startMessage(0), h.deps)
    expect(h.queue.sent).toEqual([metadataMessage(2)])
  })

  it('gives the messages it sends the job retries, not the retries of the message it handled', async () => {
    const h = await harness('generative', { claimed: true, job: { retries: 2 } })
    await handle(startMessage(1), h.deps)
    expect(h.queue.sent.map((message) => message.retries)).toEqual([2, 2, 2])
  })

  it('delivered twice, leaves the same state and sends the same batches again', async () => {
    const h = await harness()
    await handle(startMessage(), h.deps)
    await handle(startMessage(), h.deps)
    expect(h.jobs.record.state).toBe('rendering')
    expect(h.jobs.rows).toHaveLength(3)
    expect(h.paymentReads).toHaveLength(1)
    expect(h.queue.sent).toHaveLength(6)
  })

  it('logs and returns for a job that is not ready to render', async () => {
    const h = await harness('generative', { job: { state: 'payment_due' } })
    await handle(startMessage(), h.deps)
    expect(h.lines).toContain('refused:JOB_NOT_READY')
    expect(h.jobs.failures).toEqual([])
    expect(h.queue.sent).toEqual([])
  })

  it('throws when the queue refuses the batch messages, so the start is redelivered', async () => {
    const h = await harness()
    h.deps.queue = { ...h.queue, send: () => Promise.reject(new Error('queue down')) }
    await expect(handle(startMessage(), h.deps)).rejects.toThrow('queue down')
    expect(h.jobs.record.state).toBe('rendering')
  })
})

describe('batch', () => {
  it('renders, pins and records the batch', async () => {
    const h = await harness('generative', { claimed: true })
    await handle(batchMessage(1), h.deps)
    const row = h.jobs.rows[1]!
    expect(row.state).toBe('done')
    expect(row.imagesCid).toMatch(CID)
    expect(h.pins).toEqual([row.imagesCid])
    expect(h.jobs.calls).toContain('tokens:1')
    expect(h.jobs.record.batchesDone).toBe(1)
    expect(h.queue.sent).toEqual([])
  })

  it('sends metadata after the last batch', async () => {
    const h = await harness('generative', { claimed: true })
    for (const index of [0, 1, 2]) await handle(batchMessage(index), h.deps)
    expect(h.jobs.record.state).toBe('finalizing')
    expect(h.queue.sent).toEqual([metadataMessage()])
  })

  it('renders the same batch to the same CID twice', async () => {
    const first = await harness('generative', { claimed: true })
    const second = await harness('generative', { claimed: true })
    await handle(batchMessage(0), first.deps)
    await handle(batchMessage(0), second.deps)
    expect(first.jobs.rows[0]!.imagesCid).toBe(second.jobs.rows[0]!.imagesCid)
  })

  it('skips the work for a batch already done and still sends metadata when the count is full', async () => {
    const h = await harness('generative', { claimed: true })
    for (const index of [0, 1, 2]) await handle(batchMessage(index), h.deps)
    const pinsBefore = h.pins.length
    await handle(batchMessage(2), h.deps)
    expect(h.pins).toHaveLength(pinsBefore)
    expect(h.lines).toContain('batch already done')
    expect(h.queue.sent).toEqual([metadataMessage(), metadataMessage()])
  })

  it('sends metadata when the count is full although the database did not report the last batch', async () => {
    const h = await harness('generative', { claimed: true })
    for (const index of [0, 1]) await handle(batchMessage(index), h.deps)
    // The flip happened in another delivery whose send was lost: this call sees a full count, last false.
    h.jobs.batchDone = async () => ({ batchesDone: 3, last: false })
    await handle(batchMessage(2), h.deps)
    expect(h.queue.sent).toEqual([metadataMessage()])
  })

  it('returns when the job moved on', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.record.state = 'failed'
    await handle(batchMessage(0), h.deps)
    expect(h.lines).toContain('refused:JOB_NOT_RENDERING')
    expect(h.pins).toEqual([])
    expect(h.jobs.failures).toEqual([])
  })

  it('returns for a batch index the job does not have', async () => {
    const h = await harness('generative', { claimed: true })
    await handle(batchMessage(9), h.deps)
    expect(h.lines).toContain('refused:NO_SUCH_BATCH')
    expect(h.jobs.failures).toEqual([])
  })

  it('fails the job with cid-mismatch when the pinning service answers with another CID', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.pinner = wrongCidPinner()
    await handle(batchMessage(0, 0), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: 0, code: 'cid-mismatch', message: CID_MISMATCH, final: true, retries: 0 },
    ])
    expect(h.jobs.rows[0]!.state).toBe('failed')
    expect(h.jobs.calls).not.toContain('batchDone:0')
  })

  it('fails the job at once for a render problem, with its code and sentence', async () => {
    const h = await harness('generative', { claimed: true })
    const small = await flatPng({ r: 1, g: 2, b: 3, alpha: 1 }, 32)
    h.deps.store = {
      ...h.store,
      load: async (ref) => (ref.key === layerKey('wide') ? small : h.store.load(ref)),
    }
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures).toHaveLength(1)
    expect(h.jobs.failures[0]).toMatchObject({ index: 0, code: 'layer-size', final: true, retries: 0 })
    expect(h.jobs.failures[0]!.message).toContain('is 32 by 32 pixels; the canvas is 64 by 64.')
    expect(h.jobs.record.state).toBe('failed')
  })

  it('fails the job for a layer image missing from storage', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.store = { ...h.store, load: () => Promise.reject(new MissingObject('art/x.png')) }
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures[0]).toMatchObject({ index: 0, code: 'missing-image', final: true })
  })

  it('fails the job with a final missing-image when the store has no such object', async () => {
    const h = await harness('generative', { claimed: true })
    h.store.remove(layerKey('wide'))
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures).toMatchObject([{ index: 0, code: 'missing-image', final: true }])
    expect(h.jobs.record.state).toBe('failed')
  })

  it('fails the job as bad art, code decode, for a file above the upload limit, with no retry', async () => {
    const h = await harness('generative', { claimed: true })
    let loads = 0
    h.deps.store = {
      ...h.store,
      load: () => {
        loads += 1
        return Promise.reject(new ObjectTooLarge('art/x.png'))
      },
    }
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures).toMatchObject([
      { index: 0, code: 'decode', message: 'A file is larger than the upload limit.', final: true },
    ])
    expect(loads).toBeGreaterThan(0)
    expect(h.jobs.record.state).toBe('failed')
  })

  it('throws a transient storage error and reports no failure, leaving the batch running', async () => {
    const h = await harness('generative', { claimed: true })
    h.store.failTransiently(layerKey('wide'), 1)
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('storage is not answering')
    expect(h.jobs.failures).toEqual([])
    expect(h.jobs.rows[0]!.state).toBe('running')
    expect(h.jobs.record.state).toBe('rendering')
    // The redelivery finds the store back and finishes the batch.
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.rows[0]!.state).toBe('done')
  })

  it('throws a transient storage error that the render library turned into missing-image', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.store = {
      ...h.store,
      load: () => Promise.reject(Object.assign(new Error('socket hang up'), { name: 'TimeoutError' })),
    }
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('socket hang up')
    expect(h.jobs.failures).toEqual([])
  })

  it('delivers a second copy of a batch message while the first is in flight, and ends with one done batch', async () => {
    const h = await harness('generative', { claimed: true })
    for (const index of [0, 1]) await handle(batchMessage(index), h.deps)
    await Promise.all([handle(batchMessage(2), h.deps), handle(batchMessage(2), h.deps)])
    expect(h.jobs.rows[2]).toMatchObject({ state: 'done', attempts: 2 })
    // Both copies reached batchDone; the second found the batch done with the same CID and changed nothing.
    expect(h.jobs.calls.filter((call) => call === 'batchDone:2')).toHaveLength(2)
    expect(h.jobs.record.batchesDone).toBe(3)
    expect(h.jobs.record.state).toBe('finalizing')
    expect(h.jobs.failures).toEqual([])
    expect(new Set(h.pins).size).toBe(3)
  })

  it('starts the batch again on the delivery after a pin throw, and completes it', async () => {
    const h = await harness('generative', { claimed: true })
    const real = h.deps.pinner
    let thrown = false
    h.deps.pinner = {
      pin: async (car, cid) => {
        if (!thrown) {
          thrown = true
          throw new Error('pin down')
        }
        return real.pin(car, cid)
      },
    }
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('pin down')
    expect(h.jobs.rows[0]).toMatchObject({ state: 'running', attempts: 1 })
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.rows[0]).toMatchObject({ state: 'done', attempts: 2 })
    expect(h.jobs.failures).toEqual([])
  })

  it('throws when the metadata send fails after the batch was recorded, and the redelivery only sends', async () => {
    const h = await harness('generative', { claimed: true })
    for (const index of [0, 1]) await handle(batchMessage(index), h.deps)
    const queue = h.deps.queue
    h.deps.queue = { ...queue, send: () => Promise.reject(new Error('queue down')) }
    await expect(handle(batchMessage(2), h.deps)).rejects.toThrow('queue down')
    expect(h.jobs.record.state).toBe('finalizing')
    expect(h.jobs.rows[2]!.state).toBe('done')
    const pins = h.pins.length
    const loads = h.store.loads.length
    const renders = h.jobs.calls.filter((call) => call === 'renderData').length
    h.deps.queue = queue
    await handle(batchMessage(2), h.deps)
    expect(h.queue.sent).toEqual([metadataMessage()])
    expect(h.pins).toHaveLength(pins)
    expect(h.store.loads).toHaveLength(loads)
    expect(h.jobs.calls.filter((call) => call === 'renderData')).toHaveLength(renders)
    expect(h.lines).toContain('batch already done')
  })

  it('logs and acknowledges a failure report the database refuses in the batch step', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.pinner = wrongCidPinner()
    h.jobs.fail = () => Promise.reject(new JobRefusal('JOB_NOT_RENDERING'))
    await handle(batchMessage(0), h.deps)
    expect(h.lines).toContain('failure report refused:JOB_NOT_RENDERING')
  })

  it('logs a vanished job after the batch was started instead of returning silently', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.job = async () => null
    await handle(batchMessage(0), h.deps)
    expect(h.lines).toContain('job vanished')
    expect(h.pins).toEqual([])
  })

  it('throws on a pinning error, so the message is redelivered, and records nothing', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.pinner = { pin: () => Promise.reject(new Error('pin down')) }
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('pin down')
    expect(h.jobs.failures).toEqual([])
    expect(h.jobs.rows[0]!.state).toBe('running')
  })

  it('passes the retries of the message to the failure report', async () => {
    const h = await harness('generative', { claimed: true, job: { retries: 3 } })
    h.deps.pinner = wrongCidPinner()
    await handle(batchMessage(0, 2), h.deps)
    expect(h.jobs.failures[0]).toMatchObject({ retries: 2 })
  })

  it('records a batch result that differs from the one stored as a job-level cid-mismatch', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.batchDone = () => Promise.reject(new JobRefusal('BATCH_RESULT_DIFFERS'))
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: null, code: 'cid-mismatch', message: RESULT_DIFFERS, final: true, retries: 0 },
    ])
  })

  it('passes 1/1 files through and records the batch', async () => {
    const h = await harness('assets', { claimed: true })
    await handle(batchMessage(0), h.deps)
    await handle(batchMessage(1), h.deps)
    expect(h.jobs.rows.map((row) => row.state)).toEqual(['done', 'done'])
    expect(h.jobs.record.state).toBe('finalizing')
  })

  it('separates a missing placeholder object from a transient read in the batch step', async () => {
    const missing = await harness('placeholder', { claimed: true })
    missing.store.remove(PLACEHOLDER_KEY)
    await handle(batchMessage(0), missing.deps)
    expect(missing.jobs.failures).toMatchObject([{ index: 0, code: 'missing-image', final: true }])
    const transient = await harness('placeholder', { claimed: true })
    transient.store.failTransiently(PLACEHOLDER_KEY, 1)
    await expect(handle(batchMessage(0), transient.deps)).rejects.toThrow('storage is not answering')
    expect(transient.jobs.failures).toEqual([])
    expect(transient.jobs.rows[0]!.state).toBe('running')
  })

  it('renders a placeholder job batch as the placeholder image directory', async () => {
    const h = await harness('placeholder', { claimed: true })
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.rows[0]!.imagesCid).toMatch(CID)
    expect(h.jobs.calls).not.toContain('tokens:0')
    expect(h.queue.sent).toEqual([metadataMessage()])
  })
})

describe('the batch ceiling', () => {
  const ref = (key: string) => ({ key, ext: 'png' as const })

  it('is 1.2 GB, with a plain sentence', () => {
    expect(MAX_BATCH_BYTES).toBe(1_200_000_000)
    expect(BATCH_TOO_LARGE).toBe(
      'This batch of files is larger than the worker can hold. Tell support about it.',
    )
  })

  it('counts a key once however many editions load it, and throws BatchTooLarge past the ceiling', async () => {
    const load = boundedLoad(async () => new Uint8Array(10), 25)
    for (let edition = 0; edition < 50; edition++) await load(ref('a'))
    await load(ref('b'))
    const error = await load(ref('c')).catch((thrown: unknown) => thrown)
    expect(isBatchTooLarge(error)).toBe(true)
  })

  it('fails the job for good, with batch-too-large and its sentence, and pins nothing', async () => {
    const h = await harness('assets', { claimed: true })
    const sizes = [assetKey('one'), assetKey('two')].map((key) => h.store.sizeOf(key))
    h.deps.maxBatchBytes = sizes[0]! + sizes[1]! - 1
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures).toMatchObject([
      { index: 0, code: 'batch-too-large', message: BATCH_TOO_LARGE, final: true },
    ])
    expect(h.pins).toEqual([])
    expect(h.jobs.record.state).toBe('failed')
  })

  it('lets the same batch through when the ceiling covers its real sizes', async () => {
    const h = await harness('assets', { claimed: true })
    const sizes = [assetKey('one'), assetKey('two')].map((key) => h.store.sizeOf(key))
    h.deps.maxBatchBytes = sizes[0]! + sizes[1]!
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures).toEqual([])
    expect(h.jobs.rows[0]!.state).toBe('done')
  })

  it('does not apply to a generative batch, which composites its layers', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.maxBatchBytes = 1
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures).toEqual([])
    expect(h.jobs.rows[0]!.state).toBe('done')
  })
})

describe('the creator-facing missing-image sentence', () => {
  it('names the token and not the storage key, which goes to the log', async () => {
    const h = await harness('generative', { claimed: true })
    const logged: Record<string, string | number | boolean | null>[] = []
    h.deps.log = (event, fields = {}) => void (event === 'image missing' && logged.push(fields))
    h.store.remove(layerKey('wide'))
    await handle(batchMessage(0), h.deps)
    const [failure] = h.jobs.failures
    expect(failure?.code).toBe('missing-image')
    expect(failure?.message).toMatch(/^Token \d+: an image file is missing\.$/)
    expect(failure?.message).not.toContain(COLLECTION_ID)
    expect(logged).toMatchObject([{ jobId: JOB_ID, key: layerKey('wide') }])
  })

  it('says "An image file is missing." when no token is named (the placeholder)', async () => {
    const h = await harness('placeholder', { claimed: true })
    h.store.remove(PLACEHOLDER_KEY)
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures).toMatchObject([
      { code: 'missing-image', message: 'An image file is missing.', final: true },
    ])
  })
})

describe('the metadata step reads the render data fresh', () => {
  it('asks for the data fresh, and only in the metadata step', async () => {
    const h = await harness('generative', { claimed: true })
    for (const index of [0, 1, 2]) await handle(batchMessage(index), h.deps)
    expect(h.jobs.calls).not.toContain('renderData:fresh')
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.calls.filter((call) => call === 'renderData:fresh')).toHaveLength(1)
    expect(h.jobs.record.state).toBe('done')
  })

  it('does not ask for a fresh read in the batch step', async () => {
    const h = await harness('generative', { claimed: true })
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.calls).toContain('renderData')
    expect(h.jobs.calls).not.toContain('renderData:fresh')
  })
})

describe('failures', () => {
  it('throws anything that is not a render problem or a refusal', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.batchStart = () => Promise.reject(new Error('connection reset'))
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('connection reset')
    expect(h.jobs.failures).toEqual([])
  })

  it('logs the state the database returned, so a report it ignored is not logged as a failed job', async () => {
    const logged: Record<string, string | number | boolean | null>[] = []
    const failed = await harness('generative', { claimed: true })
    failed.deps.log = (event, fields = {}) => void (event === 'job failed' && logged.push(fields))
    failed.deps.pinner = wrongCidPinner()
    await handle(batchMessage(0), failed.deps)
    expect(logged).toMatchObject([{ state: 'failed' }])
    // A report older than the creator's latest retry is ignored by the database.
    const stale = await harness('generative', { claimed: true, job: { retries: 3 } })
    stale.deps.log = (event, fields = {}) => void (event === 'job failed' && logged.push(fields))
    stale.deps.pinner = wrongCidPinner()
    await handle(batchMessage(0, 2), stale.deps)
    expect(logged[1]).toMatchObject({ state: 'rendering' })
  })

  it('throws when the failure report itself fails for another reason', async () => {
    const h = await harness('generative', { claimed: true })
    h.deps.pinner = wrongCidPinner()
    h.jobs.fail = () => Promise.reject(new Error('connection reset'))
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('connection reset')
  })

  it('does not treat an error that only looks like a render problem by its message as one', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.renderData = () => Promise.reject(new Error('layer-size'))
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('layer-size')
  })

  it('fails the job for a render problem thrown by the token read', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.tokens = () =>
      Promise.reject(new RenderProblem('batch-range', 'Batch 0 has 1 token stored; 2 are expected.'))
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures[0]).toMatchObject({ index: 0, code: 'batch-range', final: true })
  })

  it.each(['BATCH_COUNT_MISMATCH', 'BATCH_ALREADY_DONE', 'JOB_FAILURE_NEEDS_FINAL'] as const)(
    'logs the unexpected refusal %s under its own event and acknowledges the message',
    async (code) => {
      const h = await harness('generative', { claimed: true })
      h.jobs.batchStart = () => Promise.reject(new JobRefusal(code))
      await handle(batchMessage(0), h.deps)
      expect(h.lines).toContain(`refused-unexpected:${code}`)
      expect(h.lines.filter((line) => line === `refused:${code}`)).toEqual([])
      expect(h.jobs.failures).toEqual([])
    },
  )

  it.each(['JOB_NOT_RENDERING', 'JOB_NOT_READY', 'NO_SUCH_BATCH', 'BATCHES_STILL_RENDERING'] as const)(
    'logs the expected refusal %s as refused',
    async (code) => {
      const h = await harness('generative', { claimed: true })
      h.jobs.batchStart = () => Promise.reject(new JobRefusal(code))
      await handle(batchMessage(0), h.deps)
      expect(h.lines).toContain(`refused:${code}`)
    },
  )
})

async function finalizing(project: 'generative' | 'assets' | 'placeholder' = 'generative') {
  const h = await harness(project, { claimed: true })
  for (const row of [...h.jobs.rows]) await handle(batchMessage(row.index), h.deps)
  expect(h.jobs.record.state).toBe('finalizing')
  return h
}

describe('metadata', () => {
  it('pins the metadata set, writes the collage and finishes the job', async () => {
    const h = await finalizing()
    await handle(metadataMessage(), h.deps)
    const key = `${COLLECTION_ID}/collage/${JOB_ID}.png`
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.finished).toEqual({
      metadataCid: h.pins.at(-1),
      baseUri: `ipfs://${h.pins.at(-1)}/`,
      placeholderImageCid: null,
      collageKey: key,
    })
    expect(h.jobs.finished?.metadataCid).toMatch(CID)
    // Batch 0 holds tokens 1 and 2 at this batch size: one row of four 256 pixel cells.
    expect(await sizeOf(h.store.collages.get(key)!)).toEqual({ width: 1024, height: 256 })
  })

  it('shows at most the first 16 tokens of batch 0 in the collage', async () => {
    const key = `${COLLECTION_ID}/collage/${JOB_ID}.png`
    const five = await harness('generative', { claimed: true, job: { batchSize: 100, batchesTotal: 1 } })
    await handle(batchMessage(0), five.deps)
    await handle(metadataMessage(), five.deps)
    expect(await sizeOf(five.store.collages.get(key)!)).toEqual({ width: 1024, height: 512 })
    const twenty = await harness('generative', {
      claimed: true,
      job: { tokenCount: 20, batchSize: 100, batchesTotal: 1 },
    })
    await handle(batchMessage(0), twenty.deps)
    await handle(metadataMessage(), twenty.deps)
    expect(twenty.jobs.record.state).toBe('done')
    expect(await sizeOf(twenty.store.collages.get(key)!)).toEqual({ width: 1024, height: 1024 })
  })

  it('reads every batch of tokens for the set', async () => {
    const h = await finalizing()
    h.jobs.calls.length = 0
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.calls.filter((call) => call.startsWith('tokens:')).sort()).toEqual([
      'tokens:0',
      'tokens:0',
      'tokens:1',
      'tokens:2',
    ])
  })

  it('returns for a job that is not finalizing', async () => {
    for (const state of ['rendering', 'done', 'failed'] as const) {
      const h = await harness('generative', { claimed: true })
      h.jobs.record.state = state
      await handle(metadataMessage(), h.deps)
      expect(h.lines).toEqual(['metadata skipped'])
      expect(h.jobs.calls).toEqual(['job'])
    }
  })

  it('delivered twice, finishes once and leaves the same result', async () => {
    const h = await finalizing()
    await handle(metadataMessage(), h.deps)
    const finished = h.jobs.finished
    const pins = h.pins.length
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.finished).toBe(finished)
    expect(h.pins).toHaveLength(pins)
  })

  it('renders the same metadata CID for the same project', async () => {
    const first = await finalizing()
    const second = await finalizing()
    await handle(metadataMessage(), first.deps)
    await handle(metadataMessage(), second.deps)
    expect(first.jobs.finished?.metadataCid).toBe(second.jobs.finished?.metadataCid)
  })

  it('fails the job at job level when the pinning service answers with another CID', async () => {
    const h = await finalizing()
    h.deps.pinner = wrongCidPinner()
    await handle(metadataMessage(1), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: null, code: 'cid-mismatch', message: CID_MISMATCH, final: true, retries: 1 },
    ])
    expect(h.jobs.finished).toBeNull()
  })

  it('fails the job at job level for a render problem', async () => {
    const h = await finalizing()
    h.jobs.rows[1]!.imagesCid = null
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.failures[0]).toMatchObject({ index: null, code: 'missing-batch', final: true })
  })

  it('finishes without a collage when the collage cannot be written', async () => {
    const h = await finalizing()
    h.deps.store = { ...h.store, putCollage: () => Promise.reject(new Error('bucket down')) }
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.finished?.collageKey).toBeNull()
    expect(h.lines).toContain('collage skipped')
    expect(h.jobs.failures).toEqual([])
  })

  it('finishes without a collage when its images cannot be composited', async () => {
    const h = await finalizing()
    h.deps.store = { ...h.store, load: () => Promise.reject(new Error('NoSuchKey')) }
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.finished?.collageKey).toBeNull()
  })

  it('throws on a pinning error and leaves the job finalizing', async () => {
    const h = await finalizing()
    h.deps.pinner = { pin: () => Promise.reject(new Error('pin down')) }
    await expect(handle(metadataMessage(), h.deps)).rejects.toThrow('pin down')
    expect(h.jobs.record.state).toBe('finalizing')
  })

  it('logs and returns when the database says batches are still rendering', async () => {
    const h = await finalizing()
    h.jobs.finish = () => Promise.reject(new JobRefusal('BATCHES_STILL_RENDERING'))
    await handle(metadataMessage(), h.deps)
    expect(h.lines).toContain('refused:BATCHES_STILL_RENDERING')
    expect(h.jobs.failures).toEqual([])
  })

  it('records a different finish result as a cid-mismatch and does not loop when that is refused too', async () => {
    const h = await finalizing()
    h.jobs.finish = () => Promise.reject(new JobRefusal('JOB_RESULT_DIFFERS'))
    h.jobs.fail = async (_job, index, code, message, final, retries) => {
      h.jobs.failures.push({ index, code, message, final, retries })
      throw new JobRefusal('JOB_NOT_RENDERING')
    }
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: null, code: 'cid-mismatch', message: RESULT_DIFFERS, final: true, retries: 0 },
    ])
    expect(h.lines).toContain('failure report refused:JOB_NOT_RENDERING')
  })

  it('makes the collage from the stills only when a GIF is among the first 16 tokens, never reading the GIF', async () => {
    // Three tokens in one batch: two PNGs and a GIF, all among the first 16.
    const h = await harness('assets', { claimed: true, job: { batchSize: 3, batchesTotal: 1 } })
    await handle(batchMessage(0), h.deps)
    expect(h.store.loads).toContain(assetKey('three', 'gif'))
    h.store.loads.length = 0
    await handle(metadataMessage(), h.deps)
    const key = `${COLLECTION_ID}/collage/${JOB_ID}.png`
    expect(h.jobs.finished?.collageKey).toBe(key)
    expect(h.jobs.finished?.baseUri).toBe(`ipfs://${h.jobs.finished?.metadataCid}/`)
    // Only the two stills are read and packed: one row of four cells.
    expect(h.store.loads).toEqual([assetKey('one'), assetKey('two')])
    expect(await sizeOf(h.store.collages.get(key)!)).toEqual({ width: 1024, height: 256 })
  })

  it('makes a collage of a 1/1 job whose only file is a JPG', async () => {
    const h = await harness('assets', {
      claimed: true,
      job: { tokenCount: 1, batchSize: 1, batchesTotal: 1 },
    })
    const data = await h.jobs.renderData(h.jobs.record)
    const key = assetKey('one', 'jpg')
    data.uploads[0]!.storageKey = key
    const jpg = new Uint8Array(
      await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 9, g: 99, b: 199 } } })
        .jpeg()
        .toBuffer(),
    )
    const store = memoryStore({ [key]: jpg })
    h.deps.store = store
    await handle(batchMessage(0), h.deps)
    await handle(metadataMessage(), h.deps)
    const collageKey = `${COLLECTION_ID}/collage/${JOB_ID}.png`
    expect(h.jobs.finished?.collageKey).toBe(collageKey)
    expect(await sizeOf(store.collages.get(collageKey)!)).toEqual({ width: 1024, height: 256 })
  })

  it('skips the collage, without a storage read, when the first 16 files are all GIF or MP4', async () => {
    const h = await harness('assets', { claimed: true, job: { batchSize: 3, batchesTotal: 1 } })
    const data = await h.jobs.renderData(h.jobs.record)
    const keys = [assetKey('one', 'gif'), assetKey('two', 'mp4'), assetKey('three', 'gif')]
    data.uploads.forEach((upload, at) => (upload.storageKey = keys[at]!))
    const store = memoryStore({
      [keys[0]!]: GIF_BYTES,
      [keys[1]!]: MP4_BYTES,
      [keys[2]!]: GIF_BYTES,
    })
    h.deps.store = store
    await handle(batchMessage(0), h.deps)
    expect(store.loads).toHaveLength(3)
    store.loads.length = 0
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.finished?.collageKey).toBeNull()
    expect(store.loads).toEqual([])
    expect(store.collages.size).toBe(0)
  })

  it('writes one shared file and no collage for a single asset, reading only batch 0', async () => {
    const h = await harness('assets', { claimed: true })
    for (const row of [...h.jobs.rows]) await handle(batchMessage(row.index), h.deps)
    const data = await h.jobs.renderData(h.jobs.record)
    data.collection.projectType = 'single_asset'
    h.jobs.renderData = async (job) => ({ ...data, job })
    h.jobs.calls.length = 0
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.finished?.baseUri).toBe(`ipfs://${h.jobs.finished?.metadataCid}/metadata.json`)
    expect(h.jobs.finished?.collageKey).toBeNull()
    expect(h.jobs.calls.filter((call) => call.startsWith('tokens:'))).toEqual(['tokens:0'])
    expect(h.store.collages.size).toBe(0)
  })

  it('finishes with the same four values and the same collage key when the first finish threw after the pin', async () => {
    const h = await finalizing()
    const finish = h.jobs.finish
    h.jobs.finish = () => Promise.reject(new Error('database down'))
    await expect(handle(metadataMessage(), h.deps)).rejects.toThrow('database down')
    expect(h.jobs.record.state).toBe('finalizing')
    const key = `${COLLECTION_ID}/collage/${JOB_ID}.png`
    const written = h.store.collages.get(key)!
    const pinsBefore = h.pins.at(-1)
    h.jobs.finish = finish
    await handle(metadataMessage(), h.deps)
    expect(h.jobs.record.state).toBe('done')
    expect(h.jobs.finished).toEqual({
      metadataCid: pinsBefore,
      baseUri: `ipfs://${pinsBefore}/`,
      placeholderImageCid: null,
      collageKey: key,
    })
    expect(h.store.collages.get(key)).toEqual(written)
    expect(h.jobs.failures).toEqual([])
  })

  it('throws a transient token read in the metadata step and records nothing', async () => {
    const h = await finalizing()
    h.jobs.tokens = () => Promise.reject(new Error('database down'))
    await expect(handle(metadataMessage(), h.deps)).rejects.toThrow('database down')
    expect(h.jobs.failures).toEqual([])
    expect(h.jobs.finished).toBeNull()
    expect(h.jobs.record.state).toBe('finalizing')
    expect(h.pins).toHaveLength(3)
    expect(h.store.collages.size).toBe(0)
  })

  it('fails a placeholder job for a missing object and throws for a transient read in the metadata step', async () => {
    const missing = await finalizing('placeholder')
    missing.store.remove(PLACEHOLDER_KEY)
    await handle(metadataMessage(), missing.deps)
    expect(missing.jobs.failures).toMatchObject([{ index: null, code: 'missing-image', final: true }])
    const transient = await finalizing('placeholder')
    transient.store.failTransiently(PLACEHOLDER_KEY, 1)
    await expect(handle(metadataMessage(), transient.deps)).rejects.toThrow('storage is not answering')
    expect(transient.jobs.failures).toEqual([])
    expect(transient.jobs.record.state).toBe('finalizing')
  })

  it('finishes a placeholder job with both CIDs and a slash-less base URI', async () => {
    const h = await finalizing('placeholder')
    await handle(metadataMessage(), h.deps)
    const finished = h.jobs.finished!
    expect(finished.placeholderImageCid).toBe(h.jobs.rows[0]!.imagesCid)
    expect(finished.baseUri).toBe(`ipfs://${finished.metadataCid}/metadata.json`)
    expect(finished.collageKey).toBeNull()
    expect(h.pins.slice(-2)).toEqual([finished.placeholderImageCid, finished.metadataCid])
  })
})

describe('handleDead', () => {
  it('fails the job with dead-letter, naming the batch of a batch message', async () => {
    const h = await harness('generative', { claimed: true })
    await handleDead(batchMessage(1, 0), h.deps)
    expect(h.jobs.failures).toEqual([
      { index: 1, code: 'dead-letter', message: DEAD_LETTER, final: true, retries: 0 },
    ])
    expect(h.jobs.record.state).toBe('failed')
    expect(h.jobs.record.errorCode).toBe('dead-letter')
  })

  it('fails the job at job level for a start and a metadata message', async () => {
    for (const message of [startMessage(2), metadataMessage(2)]) {
      const h = await harness('generative', { claimed: true, job: { retries: 2 } })
      await handleDead(message, h.deps)
      expect(h.jobs.failures).toEqual([
        { index: null, code: 'dead-letter', message: DEAD_LETTER, final: true, retries: 2 },
      ])
    }
  })

  it('acknowledges a dead message whose job cannot be failed', async () => {
    const h = await harness('generative', { job: { state: 'done' } })
    await handleDead(startMessage(), h.deps)
    expect(h.lines).toContain('failure report refused:JOB_NOT_RENDERING')
    const done = await harness('generative', { claimed: true })
    await handle(batchMessage(0), done.deps)
    await handleDead(batchMessage(0), done.deps)
    expect(done.lines).toContain('failure report refused:BATCH_ALREADY_DONE')
    expect(done.jobs.record.state).toBe('rendering')
  })

  it('acknowledges a dead start message for a job that was never claimed, which the sweep picks up', async () => {
    for (const state of ['paid', 'waived'] as const) {
      const h = await harness('generative', { job: { state } })
      await handleDead(startMessage(), h.deps)
      expect(h.lines).toContain('failure report refused:JOB_NOT_RENDERING')
      expect(h.jobs.record.state).toBe(state)
    }
  })

  it('throws when the database cannot be reached, so the dead message is kept', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.fail = () => Promise.reject(new Error('connection reset'))
    await expect(handleDead(startMessage(), h.deps)).rejects.toThrow('connection reset')
  })
})

describe('sweep and the queue backlog', () => {
  /** A harness whose `stuck` records the threshold it was asked for. */
  const asked = async (backlog: (() => Promise<number>) | undefined) => {
    const h = await harness()
    const minutes: number[] = []
    const lines: string[] = []
    h.deps.log = (event) => void lines.push(event)
    h.jobs.stuck = async (threshold) => {
      minutes.push(threshold)
      return []
    }
    h.deps.queue = { ...h.queue, backlog }
    await sweep(h.deps)
    return { minutes, lines }
  }

  it('names its two thresholds: 15 minutes, and 120 while the queue is busy', () => {
    expect(STUCK_MINUTES).toBe(15)
    expect(STUCK_MINUTES_BUSY).toBe(120)
  })

  it('uses 15 minutes with no backlog', async () => {
    expect((await asked(async () => 0)).minutes).toEqual([15])
  })

  it('uses 120 minutes while the queue has messages, and never skips', async () => {
    const { minutes, lines } = await asked(async () => 3)
    expect(minutes).toEqual([120])
    expect(lines).toContain('sweep busy')
  })

  it('re-enqueues a job untouched for 130 minutes and leaves one untouched for 30, while busy', async () => {
    const h = await harness()
    const ages = new Map([
      [JOB_ID, 130],
      ['11111111-2222-4333-8444-555555555555', 30],
    ])
    h.jobs.stuck = async (threshold) =>
      [...ages].filter(([, age]) => age >= threshold).map(([id]) => ({ id, retries: 0 }))
    h.deps.queue = { ...h.queue, backlog: async () => 5 }
    expect(await sweep(h.deps)).toBe(1)
    expect(h.queue.sent).toEqual([startMessage(0)])
  })

  it('falls back to 15 minutes, and logs one line, when the backlog cannot be read', async () => {
    const { minutes, lines } = await asked(() => Promise.reject(new Error('queue down')))
    expect(minutes).toEqual([15])
    expect(lines.filter((line) => line === 'backlog unknown')).toHaveLength(1)
  })

  it('uses 15 minutes for a queue port with no backlog', async () => {
    expect((await asked(undefined)).minutes).toEqual([15])
  })
})

describe('sweep', () => {
  it('lets the Jobs port narrow stuck to one job id, which the fake honours', async () => {
    const h = await harness()
    const other = '11111111-2222-4333-8444-555555555555'
    h.jobs.stuckJobs = [
      { id: JOB_ID, retries: 1 },
      { id: other, retries: 0 },
    ]
    expect(await h.jobs.stuck(15, other)).toEqual([{ id: other, retries: 0 }])
    expect(await h.jobs.stuck(15)).toHaveLength(2)
  })

  it('throws when the queue is down, so the next run tries again', async () => {
    const h = await harness()
    h.jobs.stuckJobs = [{ id: JOB_ID, retries: 0 }]
    h.deps.queue = { ...h.queue, send: () => Promise.reject(new Error('queue down')) }
    await expect(sweep(h.deps)).rejects.toThrow('queue down')
  })

  it('sends a start message for each stuck job, with its retries', async () => {
    const h = await harness()
    const other = '11111111-2222-4333-8444-555555555555'
    h.jobs.stuckJobs = [
      { id: JOB_ID, retries: 1 },
      { id: other, retries: 0 },
    ]
    expect(await sweep(h.deps)).toBe(2)
    expect(h.queue.sent).toEqual([startMessage(1), { jobId: other, step: 'start', retries: 0 }])
  })

  it('sends a start message for a paid or waived job that was never claimed, and the job then starts', async () => {
    for (const state of ['paid', 'waived'] as const) {
      const h = await harness('generative', { job: { state, retries: 2 } })
      h.jobs.stuckJobs = [{ id: JOB_ID, retries: 2 }]
      expect(await sweep(h.deps)).toBe(1)
      expect(h.queue.sent).toEqual([startMessage(2)])
      await handle(startMessage(2), h.deps)
      expect(h.jobs.record.state).toBe('rendering')
      expect(h.queue.sent.slice(1)).toEqual([batchMessage(0, 2), batchMessage(1, 2), batchMessage(2, 2)])
    }
  })

  it('asks for jobs untouched for 15 minutes and sends nothing when there are none', async () => {
    const h = await harness()
    const asked: number[] = []
    h.jobs.stuck = async (minutes) => {
      asked.push(minutes)
      return []
    }
    expect(await sweep(h.deps)).toBe(0)
    expect(asked).toEqual([15])
    expect(h.queue.sent).toEqual([])
  })
})

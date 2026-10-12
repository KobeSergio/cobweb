import { RenderProblem } from '@cobweb/render'
import { describe, expect, it } from 'vitest'
import { flatPng } from './doubles/draw.ts'
import { wrongCidPinner } from './doubles/pinners.ts'
import { JobRefusal } from './ports.ts'
import { CID_MISMATCH, handle, PAYMENT_MISMATCH, RESULT_DIFFERS } from './steps.ts'
import { layerKey } from './testing/fixtures.ts'
import { batchMessage, harness, metadataMessage, startMessage } from './testing/harness.ts'

const CID = /^[a-z2-7]{59}$/

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

  it('does not read the chain again for a job already rendering, and re-sends only open batches', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.rows[0]!.state = 'done'
    h.jobs.rows[0]!.imagesCid = 'a'.repeat(59)
    h.jobs.rows[1]!.state = 'failed'
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
    h.deps.store = { ...h.store, load: () => Promise.reject(new Error('NoSuchKey')) }
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.failures[0]).toMatchObject({ index: 0, code: 'missing-image', final: true })
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

  it('renders a placeholder job batch as the placeholder image directory', async () => {
    const h = await harness('placeholder', { claimed: true })
    await handle(batchMessage(0), h.deps)
    expect(h.jobs.rows[0]!.imagesCid).toMatch(CID)
    expect(h.jobs.calls).not.toContain('tokens:0')
    expect(h.queue.sent).toEqual([metadataMessage()])
  })
})

describe('failures', () => {
  it('throws anything that is not a render problem or a refusal', async () => {
    const h = await harness('generative', { claimed: true })
    h.jobs.batchStart = () => Promise.reject(new Error('connection reset'))
    await expect(handle(batchMessage(0), h.deps)).rejects.toThrow('connection reset')
    expect(h.jobs.failures).toEqual([])
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

  it('fails the job for a render problem thrown by the mapper', async () => {
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

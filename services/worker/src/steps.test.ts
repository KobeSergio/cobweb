import { describe, expect, it } from 'vitest'
import { handle, PAYMENT_MISMATCH } from './steps.ts'
import { batchMessage, harness, metadataMessage, startMessage } from './testing/harness.ts'

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

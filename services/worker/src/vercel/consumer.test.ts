import { messageKey } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import type { Log } from '../log.ts'
import { DEAD_LETTER } from '../steps.ts'
import type { Deps } from '../steps.ts'
import { batchMessage, harness, startMessage } from '../testing/harness.ts'
import {
  FIRST_RETRY_SECONDS,
  LATER_RETRY_SECONDS,
  MAX_DELIVERIES,
  MessageFailed,
  queueConsumer,
  retryAfter,
} from './consumer.ts'

const meta = (deliveryCount: number) => ({ messageId: `m-${deliveryCount}`, deliveryCount })

/** A consumer over a claimed generative job, recording its log lines and how often it built its ports. */
async function setUp() {
  const h = await harness('generative', { claimed: true })
  const lines: string[] = []
  const fields: Record<string, unknown>[] = []
  const log: Log = (event, more = {}) => {
    lines.push(event)
    fields.push(more)
  }
  let builds = 0
  const consume = queueConsumer(async (): Promise<Deps> => {
    builds += 1
    return h.deps
  }, log)
  return { h, lines, fields, consume, builds: () => builds }
}

describe('retryAfter', () => {
  const failedOnce = new Error('x')
  it('waits 120 seconds after the first failed delivery and an hour after any later one', () => {
    expect(FIRST_RETRY_SECONDS).toBe(120)
    expect(LATER_RETRY_SECONDS).toBe(3600)
    expect(retryAfter(MessageFailed.from(failedOnce, 1))).toEqual({ afterSeconds: 120 })
    expect(retryAfter(MessageFailed.from(failedOnce, 2))).toEqual({ afterSeconds: 3600 })
    expect(retryAfter(MessageFailed.from(failedOnce, 3))).toEqual({ afterSeconds: 3600 })
  })

  it('counts an error that is not a MessageFailed as a first failure', () => {
    expect(retryAfter(new Error('x'))).toEqual({ afterSeconds: 120 })
    expect(retryAfter(undefined)).toEqual({ afterSeconds: 120 })
  })
})

describe('queueConsumer', () => {
  it('dead-letters on the third failed delivery (the constant)', () => {
    expect(MAX_DELIVERIES).toBe(3)
  })

  it('acknowledges a body that is not a render message, without building its ports', async () => {
    const { consume, lines, builds } = await setUp()
    for (const body of [{ hello: 'world' }, 'start', undefined, null, { ...startMessage(), extra: 1 }])
      await expect(consume(body, meta(1))).resolves.toBeUndefined()
    expect(lines).toEqual(Array(5).fill('message ignored'))
    expect(builds()).toBe(0)
  })

  it('runs the step for a render message and resolves, so it is acknowledged', async () => {
    const { h, consume } = await setUp()
    await consume(batchMessage(0), meta(1))
    expect(h.jobs.rows[0]!.state).toBe('done')
  })

  it('rethrows a masked MessageFailed below the third failure, never the original error', async () => {
    const { h, consume, lines, fields } = await setUp()
    h.jobs.batchStart = () => Promise.reject(new Error('request to https://user:key@rpc.example/v2 failed'))
    for (const failed of [1, 2]) {
      const thrown = (await consume(batchMessage(0), meta(failed)).catch(
        (error: unknown) => error,
      )) as MessageFailed
      expect(thrown.name).toBe('MessageFailed')
      expect(thrown.message).toBe('Error: request to [url] failed')
      expect(thrown.failedDeliveries).toBe(failed)
    }
    expect(lines).toEqual(['message failed', 'message failed'])
    expect(JSON.stringify(fields)).not.toContain('https://')
    expect(h.jobs.failures).toEqual([])
  })

  it('on the third failed run hands the message to handleDead and resolves, so it is acknowledged', async () => {
    const { h, consume, lines } = await setUp()
    h.jobs.batchStart = () => Promise.reject(new Error('storage down'))
    for (const failed of [1, 2])
      await expect(consume(batchMessage(0), meta(failed))).rejects.toThrow('storage down')
    await expect(consume(batchMessage(0), meta(3))).resolves.toBeUndefined()
    expect(h.jobs.failures).toEqual([
      { index: 0, code: 'dead-letter', message: DEAD_LETTER, final: true, retries: 0 },
    ])
    expect(h.jobs.record.state).toBe('failed')
    expect(lines).toEqual(['message failed', 'message failed', 'message failed', 'message dead'])
  })

  it('decides from the database count, not from the delivery count the request carried', async () => {
    const { h, consume, lines } = await setUp()
    h.jobs.batchStart = () => Promise.reject(new Error('storage down'))
    // A forged delivery claims to be the fourth with no failure recorded: the step runs, it throws, one
    // failure is counted and the job is untouched.
    const thrown = (await consume(batchMessage(0), meta(4)).catch((error: unknown) => error)) as MessageFailed
    expect(thrown.name).toBe('MessageFailed')
    expect(thrown.failedDeliveries).toBe(1)
    expect(h.jobs.failures).toEqual([])
    expect(h.jobs.record.state).toBe('rendering')
    expect(lines).toEqual(['message failed'])
    // And a forged claim to be the first, when the database holds three failures, still dead-letters.
    h.jobs.deliveryFailureCounts.set(`${batchMessage(0).jobId}:batch:0:0`, 3)
    await expect(consume(batchMessage(0), meta(1))).resolves.toBeUndefined()
    expect(h.jobs.record.errorCode).toBe('dead-letter')
  })

  it('a forged high delivery count does not stop a step that succeeds', async () => {
    const { h, consume } = await setUp()
    await consume(batchMessage(0), meta(99))
    expect(h.jobs.rows[0]!.state).toBe('done')
    expect(h.jobs.failures).toEqual([])
    expect(h.jobs.deliveryFailureCounts.size).toBe(0)
  })

  it('counts each message key apart, and a creator retry starts again', async () => {
    const { h, consume } = await setUp()
    h.jobs.batchStart = () => Promise.reject(new Error('storage down'))
    await consume(batchMessage(0), meta(1)).catch(() => {})
    await consume(batchMessage(1), meta(1)).catch(() => {})
    await consume(batchMessage(0, 1), meta(1)).catch(() => {})
    expect([...h.jobs.deliveryFailureCounts.values()]).toEqual([1, 1, 1])
  })

  it('rethrows when handleDead throws, and the next delivery reports without running the step again', async () => {
    const { h, consume, lines } = await setUp()
    let starts = 0
    h.jobs.batchStart = () => {
      starts += 1
      return Promise.reject(new Error('storage down'))
    }
    await consume(batchMessage(0), meta(1)).catch(() => {})
    await consume(batchMessage(0), meta(2)).catch(() => {})
    const fail = h.jobs.fail
    h.jobs.fail = () => Promise.reject(new Error('connection reset'))
    const thrown = (await consume(batchMessage(0), meta(3)).catch((error: unknown) => error)) as Error
    expect(thrown.name).toBe('MessageFailed')
    expect(thrown.message).toBe('Error: connection reset')
    h.jobs.fail = fail
    await expect(consume(batchMessage(0), meta(4))).resolves.toBeUndefined()
    expect(starts).toBe(3)
    expect(h.jobs.record.errorCode).toBe('dead-letter')
    expect(lines).toEqual([
      'message failed',
      'message failed',
      'message failed',
      'dead letter failed',
      'message dead',
    ])
  })

  it('rethrows without dead-lettering when the failure cannot be counted', async () => {
    const { h, consume, lines } = await setUp()
    h.jobs.batchStart = () => Promise.reject(new Error('storage down'))
    h.jobs.deliveryFailed = () => Promise.reject(new Error('connection reset'))
    await expect(consume(batchMessage(0), meta(3))).rejects.toThrow('storage down')
    expect(h.jobs.failures).toEqual([])
    expect(lines).toEqual(['message failed', 'failure count failed'])
  })

  describe('a forged start for a job that is not runnable', () => {
    const forged = startMessage()
    for (const state of ['locked', 'payment_due', 'done', 'failed'] as const) {
      it(`changes nothing when the job is ${state}`, async () => {
        const h = await harness('generative', { job: { state } })
        const before = { ...h.jobs.record }
        const lines: string[] = []
        const consume = queueConsumer(
          async () => h.deps,
          (event) => lines.push(event),
        )
        await expect(consume(forged, meta(4))).resolves.toBeUndefined()
        expect(h.jobs.record).toEqual(before)
        expect(h.jobs.rows).toEqual([])
        expect(h.jobs.failures).toEqual([])
        expect(h.jobs.deliveryFailureCounts.size).toBe(0)
        expect(h.queue.sent).toEqual([])
        expect(h.paymentReads).toEqual([])
        // The database refuses the claim of an unpaid job; a finished one is skipped before it.
        if (state === 'done' || state === 'failed') expect(h.jobs.calls).not.toContain('claim')
        expect(lines).not.toContain('message dead')
      })
    }

    it('changes nothing when the job does not exist', async () => {
      const h = await harness('generative')
      const consume = queueConsumer(
        async () => h.deps,
        () => {},
      )
      const before = { ...h.jobs.record }
      const ghost = { ...forged, jobId: '00000000-0000-4000-8000-000000000000' }
      await expect(consume(ghost, meta(4))).resolves.toBeUndefined()
      expect(h.jobs.record).toEqual(before)
      expect(h.queue.sent).toEqual([])
      expect(h.jobs.failures).toEqual([])
    })

    it('moves no state when the job is rendering: it only sends its open batches again, under their keys', async () => {
      const h = await harness('generative', { claimed: true })
      const consume = queueConsumer(
        async () => h.deps,
        () => {},
      )
      const before = { ...h.jobs.record }
      const rows = h.jobs.rows.map((row) => ({ ...row }))
      await consume(forged, meta(4))
      const first = h.queue.sent.map(messageKey)
      await consume(forged, meta(4))
      expect(h.jobs.record).toEqual(before)
      expect(h.jobs.rows).toEqual(rows)
      expect(h.jobs.failures).toEqual([])
      expect(first.length).toBeGreaterThan(0)
      expect(h.queue.sent.map(messageKey)).toEqual([...first, ...first])
      expect(h.queue.sent.every((message) => message.step === 'batch')).toBe(true)
    })
  })

  it('builds its ports once for many messages', async () => {
    const { consume, builds } = await setUp()
    await consume(batchMessage(0), meta(1))
    await consume(batchMessage(1), meta(1))
    expect(builds()).toBe(1)
  })

  it('builds its ports again after a failed build', async () => {
    const h = await harness('generative', { claimed: true })
    let calls = 0
    const consume = queueConsumer(
      async () => {
        calls += 1
        if (calls === 1) throw new Error('SUPABASE_URL is not set.')
        return h.deps
      },
      () => {},
    )
    await expect(consume(batchMessage(0), meta(1))).rejects.toThrow('SUPABASE_URL is not set.')
    await consume(batchMessage(0), meta(2))
    expect(calls).toBe(2)
    expect(h.jobs.rows[0]!.state).toBe('done')
  })
})

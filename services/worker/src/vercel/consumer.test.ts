import { describe, expect, it } from 'vitest'
import type { Log } from '../log.ts'
import { DEAD_LETTER } from '../steps.ts'
import type { Deps } from '../steps.ts'
import { batchMessage, harness, startMessage } from '../testing/harness.ts'
import {
  FIRST_RETRY_SECONDS,
  LATER_RETRY_SECONDS,
  MAX_DELIVERIES,
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
  it('waits 120 seconds after the first delivery and an hour after any later one', () => {
    expect(FIRST_RETRY_SECONDS).toBe(120)
    expect(LATER_RETRY_SECONDS).toBe(3600)
    expect(retryAfter({ deliveryCount: 1 })).toEqual({ afterSeconds: 120 })
    expect(retryAfter({ deliveryCount: 2 })).toEqual({ afterSeconds: 3600 })
    expect(retryAfter({ deliveryCount: 3 })).toEqual({ afterSeconds: 3600 })
  })
})

describe('queueConsumer', () => {
  it('dead-letters on the third delivery (the constant)', () => {
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

  it('rethrows a masked MessageFailed below the third delivery, never the original error', async () => {
    const { h, consume, lines, fields } = await setUp()
    h.jobs.batchStart = () => Promise.reject(new Error('request to https://user:key@rpc.example/v2 failed'))
    for (const delivery of [1, 2]) {
      const thrown = (await consume(batchMessage(0), meta(delivery)).catch(
        (error: unknown) => error,
      )) as Error
      expect(thrown.name).toBe('MessageFailed')
      expect(thrown.message).toBe('Error: request to [url] failed')
    }
    expect(lines).toEqual(['message failed', 'message failed'])
    expect(JSON.stringify(fields)).not.toContain('https://')
    expect(h.jobs.failures).toEqual([])
  })

  it('on the third delivery hands the message to handleDead and resolves, so it is acknowledged', async () => {
    const { h, consume, lines } = await setUp()
    h.jobs.batchStart = () => Promise.reject(new Error('storage down'))
    await expect(consume(batchMessage(0), meta(3))).resolves.toBeUndefined()
    expect(h.jobs.failures).toEqual([
      { index: 0, code: 'dead-letter', message: DEAD_LETTER, final: true, retries: 0 },
    ])
    expect(h.jobs.record.state).toBe('failed')
    expect(lines).toEqual(['message failed', 'message dead'])
  })

  it('rethrows when handleDead throws, and the next delivery reports without running the step again', async () => {
    const { h, consume, lines } = await setUp()
    let starts = 0
    h.jobs.batchStart = () => {
      starts += 1
      return Promise.reject(new Error('storage down'))
    }
    const fail = h.jobs.fail
    h.jobs.fail = () => Promise.reject(new Error('connection reset'))
    const thrown = (await consume(batchMessage(0), meta(3)).catch((error: unknown) => error)) as Error
    expect(thrown.name).toBe('MessageFailed')
    expect(thrown.message).toBe('Error: connection reset')
    h.jobs.fail = fail
    await expect(consume(batchMessage(0), meta(4))).resolves.toBeUndefined()
    expect(starts).toBe(1)
    expect(h.jobs.record.errorCode).toBe('dead-letter')
    expect(lines).toEqual(['message failed', 'dead letter failed', 'message dead'])
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

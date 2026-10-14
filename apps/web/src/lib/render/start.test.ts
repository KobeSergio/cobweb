import { messageKey, type RenderMessage, type RenderQueue } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { startIfReady, startRender } from './start'

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'

/** A queue that keeps what is sent. */
function recording() {
  const sent: RenderMessage[][] = []
  const queue: RenderQueue = { send: async (messages) => void sent.push(messages) }
  return { sent, queue }
}

describe('startRender', () => {
  it('sends one start message with retries 0 for a fresh job', async () => {
    const { sent, queue } = recording()
    await startRender(queue, { id: JOB, retries: 0 }, () => {})
    expect(sent).toEqual([[{ jobId: JOB, step: 'start', retries: 0 }]])
  })

  it("sends one start message carrying the job's retries, so a retry is never a duplicate of the first start", async () => {
    const { sent, queue } = recording()
    await startRender(queue, { id: JOB, retries: 3 }, () => {})
    expect(sent).toEqual([[{ jobId: JOB, step: 'start', retries: 3 }]])
    const [first] = sent[0] ?? []
    expect(first && messageKey(first)).toBe(`${JOB}:start:3`)
    expect(messageKey({ jobId: JOB, step: 'start', retries: 0 })).not.toBe(`${JOB}:start:3`)
  })

  it('swallows a failed send and logs the job id with the error name only', async () => {
    const lines: string[] = []
    const queue: RenderQueue = {
      send: () => Promise.reject(new TypeError('fetch failed https://queue.example/?token=abc')),
    }
    await expect(
      startRender(queue, { id: JOB, retries: 1 }, (line) => lines.push(line)),
    ).resolves.toBeUndefined()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(JOB)
    expect(lines[0]).toContain('TypeError')
    expect(lines[0]).not.toContain('https://')
    expect(lines[0]).not.toContain('token')
  })
})

describe('startIfReady', () => {
  it('starts a job the lock returned paid or waived with retries 0, and nothing else', async () => {
    for (const state of ['paid', 'waived']) {
      const ready = recording()
      await startIfReady(ready.queue, { id: JOB, state }, () => {})
      expect(ready.sent).toEqual([[{ jobId: JOB, step: 'start', retries: 0 }]])
    }
    for (const state of ['payment_due', 'locked', 'rendering', 'failed']) {
      const other = recording()
      await startIfReady(other.queue, { id: JOB, state }, () => {})
      expect(other.sent).toEqual([])
    }
  })

  it('returns normally when the send at lock fails, and logs the job id', async () => {
    const lines: string[] = []
    const queue: RenderQueue = { send: () => Promise.reject(new Error('queue down')) }
    await expect(
      startIfReady(queue, { id: JOB, state: 'paid' }, (line) => lines.push(line)),
    ).resolves.toBeUndefined()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(JOB)
  })
})

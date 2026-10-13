import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'
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
  it('sends one start message with retries 0', async () => {
    const sent: RenderMessage[][] = []
    await startRender({ send: async (messages) => void sent.push(messages) }, JOB, () => {})
    expect(sent).toEqual([[{ jobId: JOB, step: 'start', retries: 0 }]])
  })

  it('swallows a failed send and logs the job id with the error name only', async () => {
    const lines: string[] = []
    const queue: RenderQueue = {
      send: () => Promise.reject(new TypeError('fetch failed https://queue.example/?token=abc')),
    }
    await expect(startRender(queue, JOB, (line) => lines.push(line))).resolves.toBeUndefined()
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(JOB)
    expect(lines[0]).toContain('TypeError')
    expect(lines[0]).not.toContain('https://')
    expect(lines[0]).not.toContain('token')
  })
})

describe('startIfReady', () => {
  it('starts a job the lock returned paid or waived, and nothing else', async () => {
    for (const state of ['paid', 'waived']) {
      const ready = recording()
      await startIfReady(ready.queue, { id: JOB, state }, () => {})
      expect(ready.sent).toEqual([[{ jobId: JOB, step: 'start', retries: 0 }]])
    }
    for (const state of ['payment_due', 'locked', 'rendering']) {
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

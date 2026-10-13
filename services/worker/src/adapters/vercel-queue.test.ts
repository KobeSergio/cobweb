import { readFileSync } from 'node:fs'
import { messageKey, RENDER_RETENTION_SECONDS, RENDER_TOPIC } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { describe, expect, it } from 'vitest'
import { vercelRenderQueue } from './vercel-queue.ts'
import type { QueueSender } from './vercel-queue.ts'

const JOB = '3f0c2f5e-8a51-4c0e-9d7b-0d0f5a3b9c11'

type Sent = {
  topic: string
  body: unknown
  options: { idempotencyKey: string; retentionSeconds: number }
}

/** A sender that records each call, and throws instead of recording the call numbered `failAt` (from 0). */
function recorder(failAt?: number) {
  const sent: Sent[] = []
  let calls = 0
  const sender: QueueSender = {
    async send(topic, body, options) {
      const call = calls++
      if (call === failAt) throw new Error('queue down')
      sent.push({ topic, body, options })
      return { messageId: `m-${call}` }
    },
  }
  return { sent, sender }
}

const messages: RenderMessage[] = [
  { jobId: JOB, step: 'batch', index: 0, retries: 1 },
  { jobId: JOB, step: 'batch', index: 1, retries: 1 },
  { jobId: JOB, step: 'metadata', retries: 1 },
]

/** The module specifiers a source file imports or re-exports from. */
const specifiers = (file: string): string[] => [
  ...new Set(
    [
      ...readFileSync(new URL(file, import.meta.url), 'utf8').matchAll(
        /^(?:import|export)[^'"]*from\s+'([^']+)'/gm,
      ),
    ].map((match) => match[1]!),
  ),
]

describe('vercelRenderQueue', () => {
  it('sends each message to the render topic, in order, with its key and the retention', async () => {
    const { sent, sender } = recorder()
    await vercelRenderQueue(sender).send(messages)
    expect(sent).toEqual(
      messages.map((message) => ({
        topic: RENDER_TOPIC,
        body: message,
        options: { idempotencyKey: messageKey(message), retentionSeconds: RENDER_RETENTION_SECONDS },
      })),
    )
  })

  it('sends nothing for an empty list', async () => {
    const { sent, sender } = recorder()
    await vercelRenderQueue(sender).send([])
    expect(sent).toEqual([])
  })

  it('passes a failed send on to the caller and sends nothing after it', async () => {
    const { sent, sender } = recorder(1)
    await expect(vercelRenderQueue(sender).send(messages)).rejects.toThrow('queue down')
    expect(sent.map((call) => call.options.idempotencyKey)).toEqual([messageKey(messages[0]!)])
  })

  it('sends the same keys again on a rerun after a failed send, so the queue drops the repeats', async () => {
    const first = recorder(2)
    await expect(vercelRenderQueue(first.sender).send(messages)).rejects.toThrow('queue down')
    const second = recorder()
    await vercelRenderQueue(second.sender).send(messages)
    const keys = (calls: Sent[]) => calls.map((call) => call.options.idempotencyKey)
    expect(keys(second.sent).slice(0, 2)).toEqual(keys(first.sent))
    expect(keys(second.sent)).toEqual(messages.map(messageKey))
  })
})

describe('the queue entry', () => {
  it('imports only the shared contract, so the web app can use it without sharp or the queue SDK', () => {
    expect(specifiers('./vercel-queue.ts')).toEqual(['@cobweb/shared/render-queue'])
    expect(specifiers('../queue.ts')).toEqual(['./adapters/vercel-queue.ts'])
  })
})

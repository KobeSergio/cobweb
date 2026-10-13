/**
 * The `RenderQueue` port on Vercel Queues (docs/specs/2026-10-13-render-worker-vercel.md, section 5).
 * It imports nothing from `@vercel/queue`: the caller passes the SDK's `send`, so the worker never
 * depends on the SDK and its tests never reach Vercel.
 */
import { messageKey, RENDER_RETENTION_SECONDS, RENDER_TOPIC } from '@cobweb/shared/render-queue'
import type { RenderMessage, RenderQueue } from '@cobweb/shared/render-queue'

/** The part of the SDK's `send` the adapter uses. */
export type QueueSender = {
  send(
    topic: string,
    body: unknown,
    options: { idempotencyKey: string; retentionSeconds: number },
  ): Promise<unknown>
}

/**
 * Sends messages one at a time, in order, each with its idempotency key and the longest retention. A
 * throw stops the rest and reaches the caller, whose step is then retried; the messages that went
 * through before it carry the same keys on the rerun, so the queue drops them.
 */
export function vercelRenderQueue(sender: QueueSender): RenderQueue {
  return {
    async send(messages: RenderMessage[]) {
      for (const message of messages)
        await sender.send(RENDER_TOPIC, message, {
          idempotencyKey: messageKey(message),
          retentionSeconds: RENDER_RETENTION_SECONDS,
        })
    },
  }
}

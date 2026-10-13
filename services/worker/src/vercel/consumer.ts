/**
 * The render queue's consumer on Vercel Queues (docs/specs/2026-10-13-render-worker-vercel.md,
 * section 6). The web app's route hands the function `queueConsumer` returns to the SDK's
 * `handleCallback`: a message is acknowledged when it returns and delivered again when it throws.
 * Vercel Queues has no dead-letter queue, so the third failed delivery is dead-lettered here.
 */
import { parseRenderMessage } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { consoleLog, errorSummary } from '../log.ts'
import type { Log } from '../log.ts'
import { handle, handleDead } from '../steps.ts'
import type { Deps } from '../steps.ts'

/** The delivery on which a message whose run throws is handed to `handleDead`. */
export const MAX_DELIVERIES = 3
/** The wait after a first failed delivery: a transient fault is tried again soon. */
export const FIRST_RETRY_SECONDS = 120
/**
 * The wait after any later failure. A fault that outlasted the quick retry is an outage or a bad
 * setting, and quick tries would dead-letter every message in flight and spend creators' retries.
 */
export const LATER_RETRY_SECONDS = 3600

/** The part of the SDK's message metadata the consumer reads. */
export type DeliveryMetadata = { messageId: string; deliveryCount: number }

/**
 * What the consumer throws: the failure's name and masked line only. The SDK and the runtime may print
 * a thrown error whole, and viem and storage errors can carry a URL with a key in it.
 */
export class MessageFailed extends Error {
  static from(error: unknown): MessageFailed {
    return new MessageFailed(errorSummary(error))
  }

  private constructor(summary: string) {
    super(summary)
    this.name = 'MessageFailed'
  }
}

/** The SDK's `retry` answer: 120 seconds after the first delivery, an hour after any later one. */
export function retryAfter(metadata: { deliveryCount: number }): { afterSeconds: number } {
  return { afterSeconds: metadata.deliveryCount <= 1 ? FIRST_RETRY_SECONDS : LATER_RETRY_SECONDS }
}

/** A body the SDK decoded, as a render message, or null for anything else. */
function asMessage(body: unknown): RenderMessage | null {
  let text: string | undefined
  try {
    text = JSON.stringify(body)
  } catch {
    return null
  }
  return typeof text === 'string' ? parseRenderMessage(text) : null
}

/**
 * The function the queue route hands to `handleCallback`. Its ports are built once per instance, on
 * the first render message; a failed build is tried again on the next message.
 */
export function queueConsumer(
  getDeps: () => Promise<Deps>,
  log: Log = consoleLog,
): (body: unknown, metadata: DeliveryMetadata) => Promise<void> {
  let pending: Promise<Deps> | null = null
  const deps = (): Promise<Deps> => {
    pending ??= getDeps().catch((error: unknown) => {
      pending = null
      throw error
    })
    return pending
  }
  return async (body, metadata) => {
    const message = asMessage(body)
    if (!message) {
      log('message ignored', { messageId: metadata.messageId })
      return
    }
    const fields = {
      messageId: metadata.messageId,
      jobId: message.jobId,
      step: message.step,
      delivery: metadata.deliveryCount,
    }
    // A delivery past the third comes back only because the dead-letter report threw: report again.
    if (metadata.deliveryCount <= MAX_DELIVERIES) {
      try {
        await handle(message, await deps())
        return
      } catch (error) {
        log('message failed', { ...fields, error: errorSummary(error) })
        if (metadata.deliveryCount < MAX_DELIVERIES) throw MessageFailed.from(error)
      }
    }
    try {
      await handleDead(message, await deps())
    } catch (error) {
      // The database could not be reached: the message comes back and the report is made then.
      log('dead letter failed', { ...fields, error: errorSummary(error) })
      throw MessageFailed.from(error)
    }
    log('message dead', fields)
  }
}

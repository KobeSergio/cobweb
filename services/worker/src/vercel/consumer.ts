/**
 * The render queue's consumer on Vercel Queues (docs/specs/2026-10-13-render-worker-vercel.md,
 * section 6). The web app's route hands the function `queueConsumer` returns to the SDK's
 * `handleCallback`: a message is acknowledged when it returns and delivered again when it throws.
 * Vercel Queues has no dead-letter queue, so the third failed delivery is dead-lettered here. The
 * failed deliveries are counted on the database (`Jobs.deliveryFailed`), never read from the request:
 * the SDK takes a delivery count from a header, and a request that is not the queue's could set it.
 */
import { messageKey, parseRenderMessage } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import { consoleLog, errorSummary } from '../log.ts'
import type { Log } from '../log.ts'
import { handle, handleDead } from '../steps.ts'
import type { Deps } from '../steps.ts'

/** The failed run, counted on the database, on which a message is handed to `handleDead`. */
export const MAX_DELIVERIES = 3
/** The wait after a first failed delivery: a transient fault is tried again soon. */
export const FIRST_RETRY_SECONDS = 120
/**
 * The wait after any later failure. A fault that outlasted the quick retry is an outage or a bad
 * setting, and quick tries would dead-letter every message in flight and spend creators' retries.
 */
export const LATER_RETRY_SECONDS = 3600

/**
 * The part of the SDK's message metadata the consumer reads. The delivery count is logged only: on a
 * pushed delivery it comes from a request header and decides nothing.
 */
export type DeliveryMetadata = { messageId: string; deliveryCount: number }

/**
 * What the consumer throws: the failure's name and masked line only. The SDK and the runtime may print
 * a thrown error whole, and viem and storage errors can carry a URL with a key in it.
 */
export class MessageFailed extends Error {
  /** How many failed runs of this message the database holds, this one included. */
  readonly failedDeliveries: number

  static from(error: unknown, failedDeliveries: number): MessageFailed {
    return new MessageFailed(errorSummary(error), failedDeliveries)
  }

  private constructor(summary: string, failedDeliveries: number) {
    super(summary)
    this.name = 'MessageFailed'
    this.failedDeliveries = failedDeliveries
  }
}

/**
 * The SDK's `retry` answer: 120 seconds after the first failed delivery, an hour after any later one.
 * The count is the database's, carried by the `MessageFailed` the consumer threw; any other error
 * counts as a first failure.
 */
export function retryAfter(error: unknown): { afterSeconds: number } {
  const failed = error instanceof MessageFailed ? error.failedDeliveries : 1
  return { afterSeconds: failed <= 1 ? FIRST_RETRY_SECONDS : LATER_RETRY_SECONDS }
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
    const key = messageKey(message)
    const fields = {
      messageId: metadata.messageId,
      jobId: message.jobId,
      step: message.step,
      delivery: metadata.deliveryCount,
    }
    // Nothing below can count a failure without the ports or the database: the message comes back.
    let ports: Deps
    let failed: number
    try {
      ports = await deps()
      failed = await ports.jobs.deliveryFailures(message.jobId, key)
    } catch (error) {
      log('message failed', { ...fields, error: errorSummary(error) })
      throw MessageFailed.from(error, 1)
    }
    // A message already at the limit comes back only because the dead-letter report threw: report again.
    if (failed < MAX_DELIVERIES) {
      try {
        await handle(message, ports)
        return
      } catch (error) {
        log('message failed', { ...fields, error: errorSummary(error) })
        let count: number | null
        try {
          count = await ports.jobs.deliveryFailed(message.jobId, key)
        } catch (countError) {
          log('failure count failed', { ...fields, error: errorSummary(countError) })
          throw MessageFailed.from(error, failed + 1)
        }
        // A job that is gone has nothing left to retry (null): it is reported like an exhausted one.
        if (count !== null && count < MAX_DELIVERIES) throw MessageFailed.from(error, count)
      }
    }
    try {
      await handleDead(message, ports)
    } catch (error) {
      // The database could not be reached: the message comes back and the report is made then.
      log('dead letter failed', { ...fields, error: errorSummary(error) })
      throw MessageFailed.from(error, MAX_DELIVERIES)
    }
    log('message dead', fields)
  }
}

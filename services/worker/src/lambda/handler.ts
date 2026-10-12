import { parseRenderMessage } from '@cobweb/shared/render-queue'
import type { RenderMessage } from '@cobweb/shared/render-queue'
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda'
import { consoleLog, errorSummary } from '../log.ts'
import type { Log } from '../log.ts'
import type { Deps } from '../steps.ts'

/**
 * An SQS handler around one of the worker's entry points. A body that is not a render message is
 * logged and acknowledged, never retried. A message whose run throws is reported as a partial batch
 * failure, so SQS redelivers that message alone. Anything unexpected outside a message's run marks
 * every record of the event as failed.
 */
export function sqsHandler(
  getDeps: () => Promise<Deps>,
  run: (message: RenderMessage, deps: Deps) => Promise<void>,
  log: Log = consoleLog,
): (event: SQSEvent) => Promise<SQSBatchResponse> {
  return async (event) => {
    const records = Array.isArray(event?.Records) ? event.Records : []
    try {
      const batchItemFailures: SQSBatchItemFailure[] = []
      for (const record of records) {
        const message = parseRenderMessage(record.body)
        if (!message) {
          log('message ignored', { messageId: record.messageId })
          continue
        }
        try {
          await run(message, await getDeps())
        } catch (error) {
          log('message failed', {
            messageId: record.messageId,
            jobId: message.jobId,
            step: message.step,
            error: errorSummary(error),
          })
          batchItemFailures.push({ itemIdentifier: record.messageId })
        }
      }
      return { batchItemFailures }
    } catch (error) {
      // Anything unexpected outside the step: every record goes back to the queue. The logger may be
      // what threw, so it is guarded; the error object itself is never logged.
      try {
        log('handler failed', { error: errorSummary(error) })
      } catch {
        // Nothing more can be said safely.
      }
      return { batchItemFailures: records.map((record) => ({ itemIdentifier: record.messageId })) }
    }
  }
}
